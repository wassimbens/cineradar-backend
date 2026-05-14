"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.scraperService = exports.ScraperService = void 0;
const genres_js_1 = require("../lib/genres.js");
// ── Normalisation des titres ──────────────────────────────
// Utilisée pour comparer des titres venant de sources différentes :
//   "SUPER MARIO GALAXY, LE FILM"  →  "super mario galaxy le film"
//   "Super Mario Galaxy Le Film"   →  "super mario galaxy le film"
//   "C'EST QUOI L'AMOUR ?"         →  "c est quoi l amour"
//   "La Vénus électrique"          →  "la venus electrique"
function normalizeTitle(title) {
    return title
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "") // supprime les accents
        .replace(/[^a-z0-9\s]/g, " ") // remplace ponctuation par espace
        .replace(/\s+/g, " ") // réduit les espaces multiples
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
function firstSignificantWord(normalized) {
    const words = normalized.split(" ").filter(w => w.length >= 3 && !STOP_WORDS.has(w));
    return words[0] ?? null;
}
const prisma_js_1 = require("../lib/prisma.js");
// ── Service ───────────────────────────────────────────────
class ScraperService {
    /**
     * Point d'entrée principal.
     * Persiste l'intégralité d'un ScraperResult en base.
     */
    async save(result) {
        const stats = {
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
    async saveCinema(scrapedCinema, source, stats) {
        // Upsert cinéma sur (nom + ville) — clé naturelle stable
        const existingCinema = await prisma_js_1.prisma.cinema.findFirst({
            where: {
                nom: { equals: scrapedCinema.nom, mode: "insensitive" },
                ville: { equals: scrapedCinema.ville, mode: "insensitive" },
            },
        });
        let cinemaId;
        if (existingCinema) {
            await prisma_js_1.prisma.cinema.update({
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
        }
        else {
            const cinema = await prisma_js_1.prisma.cinema.create({
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
    async saveFilm(scrapedFilm, stats) {
        // ── Passe 1 : correspondance exacte insensible à la casse ──
        const where = scrapedFilm.realisateur
            ? {
                titre: { equals: scrapedFilm.titre, mode: "insensitive" },
                realisateur: {
                    equals: scrapedFilm.realisateur,
                    mode: "insensitive",
                },
            }
            : { titre: { equals: scrapedFilm.titre, mode: "insensitive" } };
        let existing = await prisma_js_1.prisma.film.findFirst({ where });
        // ── Passe 2 : correspondance normalisée (accents + ponctuation) ──
        // Gère les cas comme "SUPER MARIO GALAXY, LE FILM" vs "Super Mario Galaxy Le Film"
        if (!existing) {
            const normScraped = normalizeTitle(scrapedFilm.titre);
            const keyword = firstSignificantWord(normScraped);
            if (keyword) {
                const candidates = await prisma_js_1.prisma.film.findMany({
                    where: { titre: { contains: keyword, mode: "insensitive" } },
                    take: 100,
                });
                existing = candidates.find(c => normalizeTitle(c.titre) === normScraped) ?? null;
            }
        }
        if (existing) {
            // Ne jamais écraser un poster TMDB (image.tmdb.org) avec une URL CDN de cinéma
            // qui serait protégée et inaccessible hors du navigateur du site d'origine.
            const isTmdbUrl = (url) => url?.includes("image.tmdb.org") ?? false;
            const keepExistingPoster = isTmdbUrl(existing.affiche) && !isTmdbUrl(scrapedFilm.affiche);
            // Mise à jour des champs enrichis s'ils manquaient
            await prisma_js_1.prisma.film.update({
                where: { id: existing.id },
                data: {
                    synopsis: scrapedFilm.synopsis ?? existing.synopsis,
                    affiche: keepExistingPoster
                        ? existing.affiche
                        : (scrapedFilm.affiche ?? existing.affiche),
                    duree: scrapedFilm.duree ?? existing.duree,
                    genres: (scrapedFilm.genres?.length ?? 0) > 0
                        ? (0, genres_js_1.normalizeGenres)(scrapedFilm.genres)
                        : existing.genres,
                    realisateur: scrapedFilm.realisateur ?? existing.realisateur,
                },
            });
            stats.filmsUpdated++;
            return existing.id;
        }
        // Création
        const film = await prisma_js_1.prisma.film.create({
            data: {
                titre: scrapedFilm.titre,
                titreOriginal: scrapedFilm.titreOriginal,
                synopsis: scrapedFilm.synopsis,
                affiche: scrapedFilm.affiche,
                duree: scrapedFilm.duree,
                genres: (0, genres_js_1.normalizeGenres)(scrapedFilm.genres ?? []),
                realisateur: scrapedFilm.realisateur,
                acteurs: [],
            },
        });
        stats.filmsCreated++;
        return film.id;
    }
    // ── Salle ─────────────────────────────────────────────
    async getSalleId(salleNom, cinemaId) {
        const existing = await prisma_js_1.prisma.salle.findFirst({
            where: {
                cinemaId,
                nom: { equals: salleNom, mode: "insensitive" },
            },
        });
        if (existing)
            return existing.id;
        const salle = await prisma_js_1.prisma.salle.create({
            data: { nom: salleNom, cinemaId },
        });
        return salle.id;
    }
    // ── Film + séances dans un cinéma ─────────────────────
    async saveCinemaFilm(cinemaFilm, cinemaId, source, stats) {
        const filmId = await this.saveFilm(cinemaFilm.film, stats);
        // Sécurité : max 15 séances uniques par (film, cinéma, jour) pour éviter
        // l'explosion des données quand le scraper récupère plusieurs jours d'un coup
        // ou quand l'API retourne des données pour plusieurs cinémas.
        const MAX_PER_CINEMA_PER_DAY = 15;
        // Grouper par jour pour appliquer le cap
        const byDay = new Map();
        for (const seance of cinemaFilm.seances) {
            const dayKey = seance.dateHeure.toISOString().slice(0, 10); // "2026-05-03"
            const arr = byDay.get(dayKey) ?? [];
            arr.push(seance);
            byDay.set(dayKey, arr);
        }
        const cappedSeances = [];
        for (const [, daySeances] of byDay) {
            // Dédoublonner par (heure, version) avant d'appliquer le cap
            const seen = new Set();
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
            // Upsert séance sur (filmId + salleId + dateHeure)
            // Évite les doublons si le scraper tourne deux fois dans la journée
            const existing = await prisma_js_1.prisma.seance.findFirst({
                where: {
                    filmId,
                    salleId,
                    dateHeure: seance.dateHeure,
                },
            });
            if (existing) {
                await prisma_js_1.prisma.seance.update({
                    where: { id: existing.id },
                    data: {
                        version: seance.version,
                        format: seance.format ?? existing.format,
                        prix: seance.prix ?? existing.prix,
                        source,
                    },
                });
                stats.seancesUpdated++;
            }
            else {
                await prisma_js_1.prisma.seance.create({
                    data: {
                        filmId,
                        salleId,
                        dateHeure: seance.dateHeure,
                        version: seance.version,
                        format: seance.format,
                        prix: seance.prix,
                        source,
                    },
                });
                stats.seancesCreated++;
            }
        }
    }
    // ── Helpers ───────────────────────────────────────────
    /**
     * Détecte la chaîne de cinéma depuis le nom.
     */
    detectChain(nom) {
        const lower = nom.toLowerCase();
        if (lower.includes("ugc"))
            return "UGC";
        if (lower.includes("mk2"))
            return "MK2";
        if (lower.includes("pathé") || lower.includes("pathe"))
            return "Pathé";
        if (lower.includes("gaumont"))
            return "Gaumont";
        if (lower.includes("cgr"))
            return "CGR";
        return null;
    }
    /**
     * Supprime les séances passées de plus de 24h pour garder la BDD propre.
     * Appelé après chaque scraping réussi.
     */
    async cleanOldSeances() {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 1);
        const { count } = await prisma_js_1.prisma.seance.deleteMany({
            where: { dateHeure: { lt: cutoff } },
        });
        return count;
    }
}
exports.ScraperService = ScraperService;
// Singleton exporté
exports.scraperService = new ScraperService();
//# sourceMappingURL=scraper.service.js.map