"use strict";
/**
 * enrich-directors-filmography.ts
 * ─────────────────────────────────────────────────────────────────
 * Pour chaque réalisateur présent en base, récupère sa filmographie
 * complète depuis TMDB et ajoute les films manquants.
 *
 * Heuristiques "film sorti en salle" (pas de court-métrage, pas de
 * direct-to-video) :
 *   - vote_count >= 25   (les courts-métrages ont rarement autant de votes)
 *   - poster_path non nul
 *   - runtime > 45 min si disponible (détail TMDB)
 *   - adult === false
 *
 * Usage :
 *   npx tsx src/scripts/enrich-directors-filmography.ts [--dry-run] [--director "Denis Villeneuve"]
 * ─────────────────────────────────────────────────────────────────
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const dotenv = __importStar(require("dotenv"));
const genres_js_1 = require("../lib/genres.js");
dotenv.config();
const prisma = new client_1.PrismaClient();
const TMDB_KEY = process.env["TMDB_API_KEY"];
const TMDB_BASE = "https://api.themoviedb.org/3";
const POSTER = "https://image.tmdb.org/t/p/w500";
const DRY_RUN = process.argv.includes("--dry-run");
const ONLY_DIR = process.argv.includes("--director")
    ? process.argv[process.argv.indexOf("--director") + 1]
    : null;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// ── Genre map TMDB → français ─────────────────────────────
const GENRE_MAP = {
    28: "Action", 12: "Aventure", 16: "Animation", 35: "Comédie",
    80: "Crime", 99: "Documentaire", 18: "Drame", 10751: "Famille",
    14: "Fantastique", 36: "Historique", 27: "Horreur", 10402: "Musique",
    9648: "Mystère", 10749: "Romance", 878: "Science-Fiction",
    10770: "Thriller", 53: "Thriller", 10752: "Guerre", 37: "Western",
};
// ── TMDB helpers ──────────────────────────────────────────
async function searchPerson(name) {
    try {
        const params = new URLSearchParams({ api_key: TMDB_KEY, query: name, language: "fr-FR" });
        const res = await fetch(`${TMDB_BASE}/search/person?${params}`, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok)
            return null;
        const data = await res.json();
        // Préférer un réalisateur (Director) connu
        const directors = data.results.filter(p => p.known_for_department === "Directing" || p.known_for_department === "Writing");
        return directors[0] ?? data.results[0] ?? null;
    }
    catch {
        return null;
    }
}
async function getMovieCredits(personId) {
    try {
        const params = new URLSearchParams({ api_key: TMDB_KEY, language: "fr-FR" });
        const res = await fetch(`${TMDB_BASE}/person/${personId}/movie_credits?${params}`, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok)
            return [];
        const data = await res.json();
        return (data.crew ?? []).filter(m => m.job === "Director");
    }
    catch {
        return [];
    }
}
async function fetchDetail(tmdbId) {
    try {
        const params = new URLSearchParams({
            api_key: TMDB_KEY,
            append_to_response: "credits",
            language: "fr-FR",
        });
        const res = await fetch(`${TMDB_BASE}/movie/${tmdbId}?${params}`, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok)
            return null;
        return res.json();
    }
    catch {
        return null;
    }
}
// ── Normalisation nom de réalisateur (déduplication) ─────
function normalizeName(name) {
    return name.toLowerCase()
        .normalize("NFD").replace(/\p{Diacritic}/gu, "") // retire accents
        .replace(/[^a-z\s]/g, " ") // ponctuation → espace
        .replace(/\s+/g, " ").trim();
}
// ── Main ──────────────────────────────────────────────────
async function main() {
    if (!TMDB_KEY) {
        console.error("❌ TMDB_API_KEY manquant");
        process.exit(1);
    }
    console.log(`\n🎬  Enrichissement filmographies réalisateurs${DRY_RUN ? " (DRY RUN)" : ""}${ONLY_DIR ? ` — filtre: "${ONLY_DIR}"` : ""}\n`);
    // 1. Récupérer les réalisateurs distincts de la base
    const rows = await prisma.film.findMany({
        where: { realisateur: { not: null } },
        select: { realisateur: true },
        distinct: ["realisateur"],
    });
    // Dédupliquer par nom normalisé
    const seenNorm = new Map(); // norm → canonical
    for (const { realisateur } of rows) {
        const r = realisateur;
        const norm = normalizeName(r);
        if (!seenNorm.has(norm))
            seenNorm.set(norm, r);
    }
    let directors = [...seenNorm.values()].sort();
    if (ONLY_DIR)
        directors = directors.filter(d => d.toLowerCase().includes(ONLY_DIR.toLowerCase()));
    console.log(`  ${directors.length} réalisateur(s) à traiter\n`);
    // 2. Charger les tmdbIds déjà en base
    const existingFilms = await prisma.film.findMany({ select: { tmdbId: true, titre: true } });
    const existingTmdbIds = new Set(existingFilms.map(f => f.tmdbId).filter(Boolean));
    let totalAdded = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    let dirNotFound = 0;
    // 3. Pour chaque réalisateur
    for (const dirName of directors) {
        console.log(`\n▶  ${dirName}`);
        // Chercher le réalisateur sur TMDB
        await sleep(200);
        const person = await searchPerson(dirName);
        if (!person) {
            console.log(`   ⚠️  Introuvable sur TMDB`);
            dirNotFound++;
            continue;
        }
        if (normalizeName(person.name) !== normalizeName(dirName)) {
            console.log(`   ℹ️  TMDB → "${person.name}" (id=${person.id})`);
        }
        // Récupérer les crédits de réalisation
        await sleep(150);
        const credits = await getMovieCredits(person.id);
        // Filtrer : films sortis en salle (heuristiques)
        const qualifying = credits.filter(m => !m.adult &&
            m.poster_path !== null &&
            m.vote_count >= 25 &&
            m.release_date &&
            m.release_date >= "1900-01-01");
        console.log(`   ${credits.length} films réalisés → ${qualifying.length} qualifiants (vote_count≥25 + affiche)`);
        let added = 0;
        for (const movie of qualifying) {
            const tmdbIdStr = String(movie.id);
            // Déjà en base ?
            if (existingTmdbIds.has(tmdbIdStr)) {
                totalSkipped++;
                continue;
            }
            // Récupérer les détails complets (runtime, genres précis, casting)
            await sleep(130);
            const detail = await fetchDetail(movie.id);
            if (!detail) {
                totalErrors++;
                continue;
            }
            // Court-métrage si runtime < 45 min (avec info disponible)
            if (detail.runtime !== null && detail.runtime < 45) {
                totalSkipped++;
                continue;
            }
            const annee = detail.release_date ? parseInt(detail.release_date.slice(0, 4)) : null;
            const rawGenres = (detail.genres ?? [])
                .map(g => GENRE_MAP[g.id] ?? g.name)
                .filter((g) => Boolean(g));
            const genres = (0, genres_js_1.normalizeGenres)(rawGenres);
            const realisateur = detail.credits?.crew
                .find(c => c.job === "Director")?.name ?? dirName;
            const acteurs = (detail.credits?.cast ?? [])
                .sort((a, b) => a.order - b.order)
                .slice(0, 5)
                .map(c => c.name);
            const titre = detail.title || detail.original_title;
            if (!titre) {
                totalSkipped++;
                continue;
            }
            if (DRY_RUN) {
                console.log(`   [DRY] "${titre}" (${annee}) — TMDB #${tmdbIdStr} — runtime=${detail.runtime}min`);
                added++;
                existingTmdbIds.add(tmdbIdStr);
                continue;
            }
            try {
                await prisma.film.create({
                    data: {
                        titre,
                        titreOriginal: detail.original_title !== detail.title ? detail.original_title : undefined,
                        synopsis: detail.overview || null,
                        affiche: detail.poster_path ? `${POSTER}${detail.poster_path}` : null,
                        duree: detail.runtime ?? null,
                        genres,
                        realisateur,
                        acteurs,
                        annee,
                        tmdbId: tmdbIdStr,
                        tmdbNote: detail.vote_count >= 10 ? detail.vote_average : null,
                        tmdbPopularite: detail.popularity ?? 0,
                    },
                });
                existingTmdbIds.add(tmdbIdStr);
                added++;
                totalAdded++;
                console.log(`   ✅ "${titre}" (${annee})`);
            }
            catch (err) {
                if (err.code === "P2002") {
                    // Doublon tmdbId — peut arriver si le même film est coréalisé
                    existingTmdbIds.add(tmdbIdStr);
                    totalSkipped++;
                }
                else {
                    console.error(`   ❌ "${titre}" : ${err}`);
                    totalErrors++;
                }
            }
        }
        if (!DRY_RUN) {
            console.log(`   → ${added} film(s) ajouté(s) pour ${dirName}`);
        }
    }
    // ── Résumé ──────────────────────────────────────────────
    console.log("\n" + "─".repeat(60));
    console.log(`✅ Films ajoutés    : ${totalAdded}`);
    console.log(`⏭️  Films ignorés   : ${totalSkipped} (déjà en base / trop courts)`);
    console.log(`❌ Erreurs          : ${totalErrors}`);
    console.log(`🔍 Réal. introuvables : ${dirNotFound}/${directors.length}`);
    const total = await prisma.film.count();
    console.log(`\n📚 Total films en base : ${total}\n`);
    await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
//# sourceMappingURL=enrich-directors-filmography.js.map