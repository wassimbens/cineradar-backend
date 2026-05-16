// ─────────────────────────────────────────────────────────
//  FilmsService — requêtes Prisma liées aux films
// ─────────────────────────────────────────────────────────

import { Version } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

// ── Types retournés ───────────────────────────────────────

export interface FilmSummary {
  id: string;
  titre: string;
  titreOriginal: string | null;
  affiche: string | null;
  duree: number | null;
  genres: string[];
  realisateur: string | null;
  acteurs: string[];
  annee: number | null;
  tmdbNote?: number | null;
  imdbNote?: number | null;
  imdbId?: string | null;
  imdbVotes?: number | null;
  seancesCount: number;
}

export interface SeanceWithCinema {
  id: string;
  dateHeure: Date;
  version: Version;
  format: string | null;
  prix: number | null;
  salle: {
    id: string;
    nom: string;
    cinema: {
      id: string;
      nom: string;
      adresse: string;
      ville: string;
      codePostal: string;
      latitude: number | null;
      longitude: number | null;
    };
  };
}

/** Séances d'un film regroupées par cinéma */
export interface SeancesParCinema {
  cinema: {
    id: string;
    nom: string;
    adresse: string;
    ville: string;
    codePostal: string;
    latitude: number | null;
    longitude: number | null;
  };
  seances: {
    id: string;
    dateHeure: Date;
    version: Version;
    format: string | null;
    prix: number | null;
    salleNom: string;
  }[];
}

// ── Filtres pour /api/films (catalogue) ──────────────────

export type CatalogSort = "titre" | "annee_desc" | "annee_asc" | "seances";

export interface CatalogFilters {
  q?: string;
  genre?: string;
  /** Décennie, ex: 1990 → films de 1990 à 1999 */
  decennie?: number;
  sort?: CatalogSort;
  page?: number;
  limit?: number;
}

export interface CatalogResult {
  films: FilmSummary[];
  total: number;
  page: number;
  totalPages: number;
}

// ── Filtres pour /api/films/:id/seances ──────────────────

export interface SeanceFilters {
  ville?: string;
  /** ISO date string "YYYY-MM-DD" — si absent, on prend aujourd'hui */
  date?: string;
  version?: Version;
}

// ── Service ───────────────────────────────────────────────

export class FilmsService {
  /**
   * Recherche des films par titre (insensible à la casse).
   * Retourne aussi le nombre de séances actives pour trier par popularité.
   *
   * GET /api/films?q=dune
   */
  async searchFilms(q: string): Promise<FilmSummary[]> {
    const now = new Date();
    const term = q.trim();
    const words = term ? term.split(/\s+/).filter(Boolean) : [];

    // Recherche par acteur via requête raw (ILIKE sur tableau PostgreSQL) — terme complet
    let actorIds: string[] = [];
    if (term) {
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Film"
        WHERE EXISTS (
          SELECT 1 FROM unnest(acteurs) AS a
          WHERE a ILIKE ${'%' + term + '%'}
        )
      `;
      actorIds = rows.map((r) => r.id);
    }

    let where: Record<string, unknown> = {};
    if (words.length === 1) {
      // Terme unique : recherche exacte par substring dans tous les champs
      where = {
        OR: [
          { titre:         { contains: words[0], mode: "insensitive" as const } },
          { titreOriginal: { contains: words[0], mode: "insensitive" as const } },
          { realisateur:   { contains: words[0], mode: "insensitive" as const } },
          ...(actorIds.length > 0 ? [{ id: { in: actorIds } }] : []),
        ],
      };
    } else if (words.length > 1) {
      // Plusieurs mots : chaque mot doit apparaître dans le titre ou le titre original
      // "tron ares" → trouve "Tron: Ares"
      where = {
        AND: words.map((word) => ({
          OR: [
            { titre:         { contains: word, mode: "insensitive" as const } },
            { titreOriginal: { contains: word, mode: "insensitive" as const } },
          ],
        })),
      };
    }

    const films = await prisma.film.findMany({
      where,
      include: {
        _count: {
          select: {
            seances: {
              where: { dateHeure: { gte: now } },
            },
          },
        },
      },
      orderBy: { titre: "asc" },
      // Pas de limit quand on veut tous les films (q vide) → le catalogue complet
      ...(term ? { take: 500 } : {}),
    });

    return films.map((f) => ({
      id: f.id,
      titre: f.titre,
      titreOriginal: f.titreOriginal,
      affiche: f.affiche,
      duree: f.duree,
      genres: f.genres,
      realisateur: f.realisateur,
      acteurs: f.acteurs ?? [],
      annee: f.annee,
      tmdbNote: (f as { tmdbNote?: number | null }).tmdbNote ?? null,
      imdbNote: (f as { imdbNote?: number | null }).imdbNote ?? null,
      imdbId: (f as { imdbId?: string | null }).imdbId ?? null,
      imdbVotes: (f as { imdbVotes?: number | null }).imdbVotes ?? null,
      seancesCount: f._count.seances,
    }));
  }

  /**
   * Catalogue paginé avec filtres genre/décennie/sort.
   * GET /api/films?genre=Action&decennie=1990&sort=annee_desc&page=1&limit=48
   */
  async getCatalogFilms(filters: CatalogFilters): Promise<CatalogResult> {
    const now = new Date();
    const { q = "", genre, decennie, sort = "seances", page = 1, limit = 48 } = filters;
    const offset = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (q.trim()) {
      // Recherche par acteur (ILIKE sur tableau PostgreSQL)
      const actorRows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Film"
        WHERE EXISTS (
          SELECT 1 FROM unnest(acteurs) AS a
          WHERE a ILIKE ${'%' + q.trim() + '%'}
        )
      `;
      const actorIds = actorRows.map((r) => r.id);

      where["OR"] = [
        { titre: { contains: q.trim(), mode: "insensitive" } },
        { titreOriginal: { contains: q.trim(), mode: "insensitive" } },
        { realisateur: { contains: q.trim(), mode: "insensitive" } },
        ...(actorIds.length > 0 ? [{ id: { in: actorIds } }] : []),
      ];
    }

    if (genre) {
      where["genres"] = { has: genre };
    }

    if (decennie) {
      where["annee"] = { gte: decennie, lt: decennie + 10 };
    }

    // Tri par séances nécessite de récupérer tous puis trier en mémoire
    // pour les autres tris on peut utiliser l'ORDER BY Prisma
    const prismaOrderBy =
      sort === "titre"
        ? [{ titre: "asc" as const }]
        : sort === "annee_desc"
        ? [{ annee: "desc" as const }, { titre: "asc" as const }]
        : sort === "annee_asc"
        ? [{ annee: "asc" as const }, { titre: "asc" as const }]
        : [{ titre: "asc" as const }]; // seances → tri en mémoire

    const [total, rawFilms] = await Promise.all([
      prisma.film.count({ where }),
      prisma.film.findMany({
        where,
        include: {
          _count: {
            select: {
              seances: { where: { dateHeure: { gte: now } } },
            },
          },
        },
        orderBy: prismaOrderBy,
        // Pour le tri par séances, on récupère tout pour pouvoir trier en mémoire
        // Pour les autres tris, on pagine directement en BD
        ...(sort !== "seances" ? { skip: offset, take: limit } : {}),
      }),
    ]);

    let films = rawFilms.map((f) => ({
      id: f.id,
      titre: f.titre,
      titreOriginal: f.titreOriginal,
      affiche: f.affiche,
      duree: f.duree,
      genres: f.genres,
      realisateur: f.realisateur,
      acteurs: f.acteurs ?? [],
      annee: f.annee,
      tmdbNote: (f as { tmdbNote?: number | null }).tmdbNote ?? null,
      imdbNote: (f as { imdbNote?: number | null }).imdbNote ?? null,
      imdbId: (f as { imdbId?: string | null }).imdbId ?? null,
      imdbVotes: (f as { imdbVotes?: number | null }).imdbVotes ?? null,
      seancesCount: f._count.seances,
    }));

    // Tri et pagination en mémoire pour "seances"
    if (sort === "seances") {
      films.sort((a, b) => (b.seancesCount ?? 0) - (a.seancesCount ?? 0));
      films = films.slice(offset, offset + limit);
    }

    return {
      films,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Top films "En ce moment au cinéma".
   *
   * Algorithme :
   *  - Pool A : films avec séances dans les 14 prochains jours
   *  - Pool B : films récents (annee >= currentYear - 1) les plus populaires TMDB
   *  - Fusion et déduplications des deux pools
   *  - Score = min(séances_14j, 50) * 1.5 + tmdbPopularite * 0.5
   *    → les films très populaires (type blockbuster) remontent même sans beaucoup de séances
   *  - Maximum 2 "classiques" (annee <= currentYear - 3) dans le résultat final
   */
  async getTrendingFilms(limit = 8, ville = ""): Promise<FilmSummary[]> {
    const now = new Date();
    const currentYear = now.getFullYear();
    const in14 = new Date(now);
    in14.setDate(in14.getDate() + 14);

    // Filtre optionnel sur la ville (via la salle → cinéma)
    const villeFilter = ville
      ? { salle: { cinema: { ville: { contains: ville, mode: "insensitive" as const } } } }
      : {};

    // ── Pool A : films avec séances prochainement ─────────
    const filmsWithSeances = await prisma.film.findMany({
      where: {
        seances: { some: { dateHeure: { gte: now, lte: in14 }, ...villeFilter } },
      },
      include: {
        _count: {
          select: {
            seances: { where: { dateHeure: { gte: now, lte: in14 }, ...villeFilter } },
          },
        },
      },
    });

    // ── Pool B : films récents populaires (avec ou sans séances)
    const popularRecent = await prisma.film.findMany({
      where: { annee: { gte: currentYear - 1 } },
      orderBy: { tmdbPopularite: "desc" },
      take: 20,
    });

    // ── Fusion avec déduplications ────────────────────────
    const seanceMap = new Map(filmsWithSeances.map((f) => [f.id, f._count.seances]));
    const allIds = new Set<string>();
    const pool: Array<{
      film: (typeof filmsWithSeances)[0] | (typeof popularRecent)[0];
      seancesCount: number;
      score: number;
      isClassic: boolean;
    }> = [];

    // Ajouter pool A
    for (const f of filmsWithSeances) {
      if (allIds.has(f.id)) continue;
      allIds.add(f.id);
      const seances = f._count.seances;
      pool.push({
        film: f,
        seancesCount: seances,
        score: Math.min(seances, 50) * 1.5 + f.tmdbPopularite * 0.5,
        isClassic: (f.annee ?? currentYear) <= currentYear - 3,
      });
    }

    // Ajouter pool B (films récents populaires, même sans séances)
    for (const f of popularRecent) {
      if (allIds.has(f.id)) continue;
      allIds.add(f.id);
      const seances = seanceMap.get(f.id) ?? 0;
      pool.push({
        film: f,
        seancesCount: seances,
        score: seances * 1.5 + f.tmdbPopularite * 0.5,
        isClassic: false,
      });
    }

    // ── Tri par score décroissant ─────────────────────────
    pool.sort((a, b) => b.score - a.score);

    // ── Sélection finale : max 2 classiques ──────────────
    let classicsCount = 0;
    const selected: typeof pool = [];

    for (const item of pool) {
      if (item.isClassic) {
        if (classicsCount >= 2) continue;
        classicsCount++;
      }
      selected.push(item);
      if (selected.length >= limit) break;
    }

    return selected.map((s) => ({
      id: s.film.id,
      titre: s.film.titre,
      titreOriginal: s.film.titreOriginal,
      affiche: s.film.affiche,
      duree: s.film.duree,
      genres: s.film.genres,
      realisateur: s.film.realisateur,
      acteurs: (s.film as { acteurs?: string[] }).acteurs ?? [],
      annee: s.film.annee,
      tmdbNote: (s.film as { tmdbNote?: number | null }).tmdbNote ?? null,
      seancesCount: s.seancesCount,
    }));
  }

  /**
   * Films classiques pour la section "À redécouvrir" de la home.
   *
   * Règle stricte : uniquement les classiques (annee <= currentYear - 3)
   * qui ont des séances actives dans les 30 prochains jours.
   * Triés par popularité : imdbNote × log10(imdbVotes + 10),
   * avec fallback sur tmdbNote quand IMDb n'est pas encore enrichi.
   * → Le Parrain (9.2/10, 1.9M votes, score ≈ 58) avant un film méconnu.
   */
  async getClassicFilms(limit = 18): Promise<FilmSummary[]> {
    const cutoffYear = new Date().getFullYear() - 3; // au moins 3 ans pour être "classique"
    const now = new Date();
    const in30 = new Date(now);
    in30.setDate(in30.getDate() + 30);

    // Uniquement les classiques actuellement en salle (séances dans les 30j)
    const rows = await prisma.film.findMany({
      where: {
        annee: { lte: cutoffYear },
        seances: { some: { dateHeure: { gte: now, lte: in30 } } },
      },
      include: {
        _count: { select: { seances: { where: { dateHeure: { gte: now, lte: in30 } } } } },
      },
    });

    // Éliminer les faux positifs (edge case datetime boundary)
    const withSeances = rows.filter((r) => r._count.seances > 0);

    // Score de popularité : imdbNote ou tmdbNote × log10(imdbVotes + 10)
    // Avec seulement tmdbNote et 0 votes : score = tmdbNote × 1 = tmdbNote
    const popularityScore = (r: typeof rows[0]) => {
      const note  = r.imdbNote ?? r.tmdbNote ?? 0;
      const votes = r.imdbVotes ?? 0;
      return note * Math.log10(votes + 10);
    };

    withSeances.sort((a, b) => popularityScore(b) - popularityScore(a));

    return withSeances.slice(0, limit).map((r) => ({
      id:           r.id,
      titre:        r.titre,
      titreOriginal: r.titreOriginal,
      affiche:      r.affiche,
      duree:        r.duree,
      genres:       r.genres,
      realisateur:  r.realisateur,
      acteurs:      r.acteurs ?? [],
      annee:        r.annee,
      tmdbNote:     r.tmdbNote   ?? null,
      imdbNote:     r.imdbNote   ?? null,
      imdbVotes:    r.imdbVotes  ?? null,
      seancesCount: r._count.seances,
    }));
  }

  /**
   * Tous les films classiques pour la page dédiée.
   * Organisé par réalisateur puis par décennie.
   */
  async getAllClassicFilms(): Promise<FilmSummary[]> {
    const cutoffYear = new Date().getFullYear() - 2;
    const now = new Date();

    const films = await prisma.film.findMany({
      where: {
        annee: { lte: cutoffYear },
      },
      include: {
        _count: {
          select: {
            seances: { where: { dateHeure: { gte: now } } },
          },
        },
      },
      orderBy: [{ realisateur: "asc" }, { annee: "asc" }],
    });

    return films.map((f) => ({
      id: f.id,
      titre: f.titre,
      titreOriginal: f.titreOriginal,
      affiche: f.affiche,
      duree: f.duree,
      genres: f.genres,
      realisateur: f.realisateur,
      acteurs: f.acteurs ?? [],
      annee: f.annee,
      tmdbNote: (f as { tmdbNote?: number | null }).tmdbNote ?? null,
      imdbNote: (f as { imdbNote?: number | null }).imdbNote ?? null,
      imdbId: (f as { imdbId?: string | null }).imdbId ?? null,
      imdbVotes: (f as { imdbVotes?: number | null }).imdbVotes ?? null,
      seancesCount: f._count.seances,
    }));
  }

  /**
   * Retourne un film complet avec son synopsis et ses acteurs.
   *
   * Utilisé par la fiche film.
   */
  async getFilmById(id: string) {
    return prisma.film.findUnique({
      where: { id },
    });
  }

  /**
   * Retourne les séances d'un film, groupées par cinéma.
   * Filtres optionnels : ville, date, version.
   *
   * GET /api/films/:id/seances?ville=Paris&date=2026-04-07&version=VO
   */
  async getFilmSeances(
    filmId: string,
    filters: SeanceFilters
  ): Promise<SeancesParCinema[]> {
    // Plage horaire du jour demandé (ou aujourd'hui) — heure Paris
    let start: Date;
    let end: Date;

    if (filters.date) {
      // Date explicite "YYYY-MM-DD" → interprétée en heure Paris (UTC+1/+2)
      // On ajoute "T00:00:00" pour éviter l'interprétation UTC
      start = new Date(`${filters.date}T00:00:00`);
      end   = new Date(`${filters.date}T23:59:59.999`);
    } else {
      // Aujourd'hui : plage complète de la journée locale
      const now = new Date();
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    }

    const seances = await prisma.seance.findMany({
      where: {
        filmId,
        dateHeure: { gte: start, lte: end },
        // Filtre version optionnel
        ...(filters.version ? { version: filters.version } : {}),
        salle: {
          cinema: filters.ville
            ? { ville: { contains: filters.ville, mode: "insensitive" } }
            : undefined,
        },
      },
      include: {
        salle: {
          include: { cinema: true },
        },
      },
      orderBy: { dateHeure: "asc" },
    });

    // Grouper par cinéma + dédoublonner par fenêtre de 10 minutes
    // (évite les centaines de séances dues au scraper qui mappe plusieurs
    //  jours sur le même horaire)
    const byCinema = new Map<string, SeancesParCinema>();
    // Arrondir au créneau de 10 min pour fusionner les quasi-doublons
    const seen = new Set<string>();

    for (const s of seances) {
      const cinemaId = s.salle.cinema.id;
      const bucket = Math.round(s.dateHeure.getTime() / (10 * 60 * 1000));
      const dedupeKey = `${cinemaId}|${bucket}|${s.version}`;

      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      if (!byCinema.has(cinemaId)) {
        byCinema.set(cinemaId, {
          cinema: {
            id: s.salle.cinema.id,
            nom: s.salle.cinema.nom,
            adresse: s.salle.cinema.adresse,
            ville: s.salle.cinema.ville,
            codePostal: s.salle.cinema.codePostal,
            latitude: s.salle.cinema.latitude,
            longitude: s.salle.cinema.longitude,
          },
          seances: [],
        });
      }

      byCinema.get(cinemaId)!.seances.push({
        id: s.id,
        dateHeure: s.dateHeure,
        version: s.version,
        format: s.format,
        prix: s.prix,
        salleNom: s.salle.nom,
      });
    }

    // Cap 30 séances par cinéma (tri chronologique d'abord)
    for (const groupe of byCinema.values()) {
      groupe.seances.sort((a, b) => a.dateHeure.getTime() - b.dateHeure.getTime());
      if (groupe.seances.length > 30) groupe.seances.length = 30;
    }

    // Trier les cinémas par nom
    return Array.from(byCinema.values()).sort((a, b) =>
      a.cinema.nom.localeCompare(b.cinema.nom, "fr")
    );
  }
}

export const filmsService = new FilmsService();
