/**
 * populate-imdb-notes.ts
 * ─────────────────────────────────────────────────────────────────
 * Pour chaque film en base :
 *   1. Si imdbId est déjà connu, utilise-le directement
 *   2. Sinon, récupère l'imdb_id depuis TMDB (si tmdbId disponible)
 *   3. Appelle OMDB pour obtenir imdbRating + imdbVotes
 *   4. Met à jour le film en base
 *
 * Usage :
 *   npx tsx src/scripts/populate-imdb-notes.ts [--dry-run] [--limit 100]
 *
 * Variables d'environnement requises :
 *   TMDB_API_KEY   — clé TMDB
 *   OMDB_API_KEY   — clé OMDB (gratuite sur omdbapi.com)
 * ─────────────────────────────────────────────────────────────────
 */

import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
dotenv.config();

const prisma    = new PrismaClient();
const TMDB_KEY  = process.env["TMDB_API_KEY"]!;
const OMDB_KEY  = process.env["OMDB_API_KEY"] ?? "trilogy"; // clé démo si non définie
const TMDB_BASE = "https://api.themoviedb.org/3";
const OMDB_BASE = "https://www.omdbapi.com";
const DRY_RUN   = process.argv.includes("--dry-run");
const LIMIT_IDX = process.argv.indexOf("--limit");
const LIMIT     = LIMIT_IDX !== -1 ? parseInt(process.argv[LIMIT_IDX + 1]) : Infinity;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── TMDB : récupère l'imdb_id depuis un tmdbId ────────────────
async function getImdbIdFromTmdb(tmdbId: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({ api_key: TMDB_KEY });
    const res = await fetch(`${TMDB_BASE}/movie/${tmdbId}?${params}`,
      { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = await res.json() as { imdb_id?: string };
    return data.imdb_id ?? null;
  } catch { return null; }
}

// ── OMDB : récupère la note IMDB ──────────────────────────────
interface OmdbResult {
  imdbRating?: string;
  imdbVotes?: string;
  imdbID?: string;
  Response: "True" | "False";
  Error?: string;
}

async function getImdbData(imdbId: string): Promise<OmdbResult | null> {
  try {
    const params = new URLSearchParams({ i: imdbId, apikey: OMDB_KEY });
    const res = await fetch(`${OMDB_BASE}/?${params}`,
      { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return res.json() as Promise<OmdbResult>;
  } catch { return null; }
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  if (!TMDB_KEY) { console.error("❌ TMDB_API_KEY manquant"); process.exit(1); }

  console.log(`\n⭐  Population notes IMDB${DRY_RUN ? " (DRY RUN)" : ""}${isFinite(LIMIT) ? ` — limite: ${LIMIT}` : ""}\n`);
  console.log(`   OMDB key: ${OMDB_KEY === "trilogy" ? "trilogy (démo)" : "personnalisée"}\n`);

  // Films sans note IMDB, triés par popularité TMDB (les plus populaires en premier)
  const films = await prisma.film.findMany({
    where: {
      imdbNote: null,
      OR: [
        { tmdbId: { not: null } },
        { imdbId: { not: null } },
      ],
    },
    select: { id: true, titre: true, tmdbId: true, imdbId: true, annee: true, tmdbPopularite: true },
    orderBy: { tmdbPopularite: "desc" },
    take: isFinite(LIMIT) ? LIMIT : undefined,
  });

  console.log(`  ${films.length} films à enrichir\n`);

  let updated   = 0;
  let skipped   = 0;
  let errors    = 0;
  let noImdb    = 0;

  for (let i = 0; i < films.length; i++) {
    const film = films[i];

    // Progression tous les 50
    if (i > 0 && i % 50 === 0) {
      console.log(`  [${i}/${films.length}] ✅ ${updated} mis à jour | ⏭️ ${skipped} ignorés | ❌ ${errors} erreurs | 🔍 ${noImdb} sans IMDB`);
    }

    // 1. Obtenir l'imdbId
    let imdbId = film.imdbId;

    if (!imdbId && film.tmdbId) {
      await sleep(100); // respect rate limit TMDB (~40 req/s)
      imdbId = await getImdbIdFromTmdb(film.tmdbId);
    }

    if (!imdbId) {
      noImdb++;
      continue;
    }

    // 2. Appel OMDB
    await sleep(80); // OMDB : ~12 req/s pour la clé gratuite
    const omdb = await getImdbData(imdbId);

    if (!omdb || omdb.Response === "False") {
      noImdb++;
      continue;
    }

    // Parser la note ("7.3" → 7.3, "N/A" → null)
    const noteStr  = omdb.imdbRating;
    const votesStr = omdb.imdbVotes;

    const note  = noteStr && noteStr !== "N/A" ? parseFloat(noteStr) : null;
    const votes = votesStr && votesStr !== "N/A"
      ? parseInt(votesStr.replace(/,/g, ""), 10)
      : null;

    if (note === null) {
      // Pas encore de note IMDB (film trop récent, etc.)
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`   [DRY] "${film.titre}" (${film.annee}) — ${imdbId} → IMDb ${note}/10 (${votes?.toLocaleString("fr-FR")} votes)`);
      updated++;
      continue;
    }

    try {
      await prisma.film.update({
        where: { id: film.id },
        data: {
          imdbId,
          imdbNote: note,
          imdbVotes: votes,
        },
      });
      updated++;

      // Log pour les films populaires uniquement (évite le flood)
      if (film.tmdbPopularite > 50) {
        console.log(`   ✅ "${film.titre}" (${film.annee}) — IMDb ${note}/10`);
      }
    } catch (err) {
      console.error(`   ❌ "${film.titre}" : ${err}`);
      errors++;
    }
  }

  // ── Résumé ──────────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log(`✅ Films mis à jour    : ${updated}`);
  console.log(`⏭️  Films ignorés      : ${skipped} (note N/A)`);
  console.log(`🔍 Sans imdbId         : ${noImdb}`);
  console.log(`❌ Erreurs             : ${errors}`);

  const withNote = await prisma.film.count({ where: { imdbNote: { not: null } } });
  const total    = await prisma.film.count();
  console.log(`\n📊 Films avec note IMDb : ${withNote}/${total}\n`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
