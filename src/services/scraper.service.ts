// ─────────────────────────────────────────────────────────
//  ScraperService
//  Persiste les résultats d'un scraper en base via Prisma.
//
//  Stratégie upsert :
//    - Film     → upsert sur (titre normalisé) — insensible casse + accents + ponctuation
//    - Cinema   → upsert sur (nom, ville)
//    - Salle    → upsert sur (nom, cinemaId)
//    - Seance   → upsert sur (filmId, salleId, dateHeure)
//      → évite les doublons si le job tourne plusieurs fois dans la journée
// ─────────────────────────────────────────────────────────

import { Version } from "@prisma/client";
import { normalizeGenres } from "../lib/genres.js";

// ── Normalisation des titres ──────────────────────────────
// Utilisée pour comparer des titres venant de sources différentes :
//   "SUPER MARIO GALAXY, LE FILM"  →  "super mario galaxy le film"
//   "Super Mario Galaxy Le Film"   →  "super mario galaxy le film"
//   "C'EST QUOI L'AMOUR ?"         →  "c est quoi l amour"
//   "La Vénus électrique"          →  "la venus electrique"
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")  // supprime les accents
    .replace(/[^a-z0-9\s]/g, " ")     // remplace ponctuation par espace
    .replace(/\s+/g, " ")             // réduit les espaces multiples
    .trim();
}

// Mots-outils à ignorer pour la recherche par mot-clé
const STOP_WORDS = new Set([
  "le", "la", "les", "l", "de", "du", "des", "un", "une",
  "et", "en", "au", "aux", "a", "est", "sur", "par",
]);

/**
 * Retourne le premier mot significatif (≥ 3 lettres, hors stop-words)
 * pour servir de filtre SQL approximatif lors du fallback de correspondance.
 */
function firstSignificantWord(normalized: string): string | null {
  const words = normalized.split(" ").filter(w => w.length >= 3 && !STOP_WORDS.has(w));
  return words[0] ?? null;
}
import { prisma } from "../lib/prisma.js";
import {
  ScraperResult,
  ScrapedCinema,
  ScrapedCinemaFilm,
  ScrapedFilm,
} from "../scrapers/types.js";

// ── Types internes ────────────────────────────────────────

interface SaveStats {
  cinemasCreated: number;
  cinemasUpdated: number;
  filmsCreated: number;
  filmsUpdated: number;
  seancesCreated: number;
  seancesUpdated: number;
}

// ── Service ───────────────────────────────────────────────

export class ScraperService {
  /**
   * Point d'entrée principal.
   * Persiste l'intégralité d'un ScraperResult en base.
   */
  async save(result: ScraperResult): Promise<SaveStats> {
    const stats: SaveStats = {
      cinemasCreated: 0,
      cinemasUpdated: 0,
      filmsCreated: 0,
      filmsUpdated: 0,
      seancesCreated: 0,
      seancesUpdated: 0,
    };

    for (const scrapedCinema of result.cinemas) {
      await this.saveCinema(scrapedCinema, result.source, stats);
    }

    return stats;
  }

  // ── Cinéma ────────────────────────────────────────────

  private async saveCinema(
    scrapedCinema: ScrapedCinema,
    source: string,
    stats: SaveStats
  ): Promise<void> {
    // Upsert cinéma sur (nom + ville) — clé naturelle stable
    const existingCinema = await prisma.cinema.findFirst({
      where: {
        nom: { equals: scrapedCinema.nom, mode: "insensitive" },
        ville: { equals: scrapedCinema.ville, mode: "insensitive" },
      },
    });

    let cinemaId: string;

    if (existingCinema) {
      await prisma.cinema.update({
        where: { id: existingCinema.id },
        data: {
          adresse: scrapedCinema.adresse || existingCinema.adresse,
          codePostal: scrapedCinema.codePostal || existingCinema.codePostal,
          latitude: scrapedCinema.latitude ?? existingCinema.latitude,
          longitude: scrapedCinema.longitude ?? existingCinema.longitude,
          siteWeb: scrapedCinema.siteWeb ?? existingCinema.siteWeb,
        },
      });
      cinemaId = existingCinema.id;
      stats.cinemasUpdated++;
    } else {
      const cinema = await prisma.cinema.create({
        data: {
          nom: scrapedCinema.nom,
          adresse: scrapedCinema.adresse,
          ville: scrapedCinema.ville,
          codePostal: scrapedCinema.codePostal,
          latitude: scrapedCinema.latitude,
          longitude: scrapedCinema.longitude,
          siteWeb: scrapedCinema.siteWeb,
          chaine: this.detectChain(scrapedCinema.nom),
        },
      });
      cinemaId = cinema.id;
      stats.cinemasCreated++;
    }

    // Films de ce cinéma
    for (const cinemaFilm of scrapedCinema.films) {
      await this.saveCinemaFilm(cinemaFilm, cinemaId, source, stats);
    }
  }

  // ── Film ──────────────────────────────────────────────

  private async saveFilm(
    scrapedFilm: ScrapedFilm,
    stats: SaveStats
  ): Promise<string> {
    // ── Passe 1 : correspondance exacte insensible à la casse ──
    const where = scrapedFilm.realisateur
      ? {
          titre: { equals: scrapedFilm.titre, mode: "insensitive" as const },
          realisateur: {
            equals: scrapedFilm.realisateur,
            mode: "insensitive" as const,
          },
        }
      : { titre: { equals: scrapedFilm.titre, mode: "insensitive" as const } };

    let existing = await prisma.film.findFirst({ where });

    // ── Passe 2 : correspondance normalisée (accents + ponctuation) ──
    // Gère les cas comme "SUPER MARIO GALAXY, LE FILM" vs "Super Mario Galaxy Le Film"
    if (!existing) {
      const normScraped = normalizeTitle(scrapedFilm.titre);
      const keyword = firstSignificantWord(normScraped);
      if (keyword) {
        const candidates = await prisma.film.findMany({
          where: { titre: { contains: keyword, mode: "insensitive" } },
          take: 100,
        });
        existing = candidates.find(c => normalizeTitle(c.titre) === normScraped) ?? null;
      }
    }

    // ── Passe 3 : réalisateur + sous-ensemble de mots-clés ──
    // Gère les titres alternatifs d'un même film :
    //   "Le Parrain 2" (Coppola) ↔ "Le Parrain – Deuxième Partie" (Coppola)
    // Nécessite au moins un mot-clé significatif commun ET même réalisateur.
    if (!existing && scrapedFilm.realisateur) {
      const sameDirector = await prisma.film.findMany({
        where: {
          realisateur: { equals: scrapedFilm.realisateur, mode: "insensitive" },
        },
      });

      if (sameDirector.length > 0) {
        const normScraped = normalizeTitle(scrapedFilm.titre);
        const wordsScraped = normScraped
          .split(" ")
          .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
        const setScraped = new Set(wordsScraped);

        for (const candidate of sameDirector) {
          const normCandidate = normalizeTitle(candidate.titre);
          const wordsCandidate = normCandidate
            .split(" ")
            .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
          const setCandidate = new Set(wordsCandidate);

          // Sous-ensemble : tous les mots-clés de A dans B (ou vice versa) → variante de titre
          const scrapedSubset =
            setScraped.size > 0 &&
            [...setScraped].every(w => setCandidate.has(w));
          const candidateSubset =
            setCandidate.size > 0 &&
            [...setCandidate].every(w => setScraped.has(w));

          if (scrapedSubset || candidateSubset) {
            console.log(
              `[scraper] Passe 3 : "${scrapedFilm.titre}" → "${candidate.titre}" (${scrapedFilm.realisateur})`
            );
            existing = candidate;
            break;
          }
        }
      }
    }

    if (existing) {
      // Ne jamais écraser un poster TMDB (image.tmdb.org) avec une URL CDN de cinéma
      // qui serait protégée et inaccessible hors du navigateur du site d'origine.
      const isTmdbUrl = (url?: string | null) =>
        url?.includes("image.tmdb.org") ?? false;
      const keepExistingPoster =
        isTmdbUrl(existing.affiche) && !isTmdbUrl(scrapedFilm.affiche);

      // Mise à jour des champs enrichis s'ils manquaient
      await prisma.film.update({
        where: { id: existing.id },
        data: {
          synopsis: scrapedFilm.synopsis ?? existing.synopsis,
          affiche: keepExistingPoster
            ? existing.affiche
            : (scrapedFilm.affiche ?? existing.affiche),
          duree: scrapedFilm.duree ?? existing.duree,
          genres:
            (scrapedFilm.genres?.length ?? 0) > 0
              ? normalizeGenres(scrapedFilm.genres!)
              : existing.genres,
          realisateur: scrapedFilm.realisateur ?? existing.realisateur,
        },
      });
      stats.filmsUpdated++;
      return existing.id;
    }

    // Création
    const film = await prisma.film.create({
      data: {
        titre: scrapedFilm.titre,
        titreOriginal: scrapedFilm.titreOriginal,
        synopsis: scrapedFilm.synopsis,
        affiche: scrapedFilm.affiche,
        duree: scrapedFilm.duree,
        genres: normalizeGenres(scrapedFilm.genres ?? []),
        realisateur: scrapedFilm.realisateur,
        acteurs: [],
      },
    });
    stats.filmsCreated++;
    return film.id;
  }

  // ── Salle ─────────────────────────────────────────────

  private async getSalleId(
    salleNom: string,
    cinemaId: string
  ): Promise<string> {
    const existing = await prisma.salle.findFirst({
      where: {
        cinemaId,
        nom: { equals: salleNom, mode: "insensitive" },
      },
    });

    if (existing) return existing.id;

    const salle = await prisma.salle.create({
      data: { nom: salleNom, cinemaId },
    });
    return salle.id;
  }

  // ── Film + séances dans un cinéma ─────────────────────

  private async saveCinemaFilm(
    cinemaFilm: ScrapedCinemaFilm,
    cinemaId: string,
    source: string,
    stats: SaveStats
  ): Promise<void> {
    const filmId = await this.saveFilm(cinemaFilm.film, stats);

    // Sécurité : max 15 séances uniques par (film, cinéma, jour) pour éviter
    // l'explosion des données quand le scraper récupère plusieurs jours d'un coup
    // ou quand l'API retourne des données pour plusieurs cinémas.
    const MAX_PER_CINEMA_PER_DAY = 15;

    // Grouper par jour pour appliquer le cap
    const byDay = new Map<string, typeof cinemaFilm.seances>();
    for (const seance of cinemaFilm.seances) {
      const dayKey = seance.dateHeure.toISOString().slice(0, 10); // "2026-05-03"
      const arr = byDay.get(dayKey) ?? [];
      arr.push(seance);
      byDay.set(dayKey, arr);
    }

    const cappedSeances: typeof cinemaFilm.seances = [];
    for (const [, daySeances] of byDay) {
      // Dédoublonner par (heure, version) avant d'appliquer le cap
      const seen = new Set<string>();
      for (const s of daySeances) {
        const k = `${s.dateHeure.getTime()}|${s.version}`;
        if (!seen.has(k) && seen.size < MAX_PER_CINEMA_PER_DAY) {
          seen.add(k);
          cappedSeances.push(s);
        }
      }
    }

    for (const seance of cappedSeances) {
      const salleNom = seance.salleNom ?? "Salle principale";
      const salleId = await this.getSalleId(salleNom, cinemaId);

      // Upsert atomique sur (filmId, salleId, dateHeure) — clé unique garantie par le schéma
      const result = await prisma.seance.upsert({
        where: { filmId_salleId_dateHeure: { filmId, salleId, dateHeure: seance.dateHeure } },
        create: {
          filmId,
          salleId,
          dateHeure: seance.dateHeure,
          version: seance.version as Version,
          format: seance.format,
          prix: seance.prix,
          source,
        },
        update: {
          version: seance.version as Version,
          format: seance.format,
          prix: seance.prix,
          source,
        },
      });
      // Prisma ne distingue pas create vs update dans upsert sans métadonnée supplémentaire ;
      // on compte côté créé si createdAt = updatedAt (< 1s d'écart)
      const isNew = Math.abs(result.createdAt.getTime() - result.updatedAt.getTime()) < 1000;
      if (isNew) stats.seancesCreated++; else stats.seancesUpdated++;
    }
  }

  // ── Helpers ───────────────────────────────────────────

  /**
   * Détecte la chaîne de cinéma depuis le nom.
   */
  private detectChain(nom: string): string | null {
    const lower = nom.toLowerCase();
    if (lower.includes("ugc")) return "UGC";
    if (lower.includes("mk2")) return "MK2";
    if (lower.includes("pathé") || lower.includes("pathe")) return "Pathé";
    if (lower.includes("gaumont")) return "Gaumont";
    if (lower.includes("cgr")) return "CGR";
    return null;
  }

  /**
   * Supprime les séances passées de plus de 24h pour garder la BDD propre.
   * Appelé après chaque scraping réussi.
   */
  async cleanOldSeances(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 1);

    const { count } = await prisma.seance.deleteMany({
      where: { dateHeure: { lt: cutoff } },
    });

    return count;
  }
}

// Singleton exporté
export const scraperService = new ScraperService();
