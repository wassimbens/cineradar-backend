// Récupère la note TMDB (vote_average) pour tous les films qui ont un tmdbId
// et met à jour la colonne tmdbNote en base.
//
// Usage :
//   node node_modules/tsx/dist/cli.mjs src/scripts/populate-tmdb-notes.ts
//
// Prérequis : redémarrer le backend une fois pour que Prisma regénère
//             son client avec la nouvelle colonne tmdbNote.

import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
dotenv.config();

const prisma = new PrismaClient();
const TMDB_KEY  = process.env["TMDB_API_KEY"]!;
const TMDB_BASE = "https://api.themoviedb.org/3";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface TmdbDetail { vote_average: number; vote_count: number }

async function fetchNote(tmdbId: string): Promise<number | null> {
  try {
    const r = await fetch(
      `${TMDB_BASE}/movie/${tmdbId}?api_key=${TMDB_KEY}&language=fr-FR`,
      { signal: AbortSignal.timeout(8_000) }
    );
    if (!r.ok) return null;
    const d = await r.json() as TmdbDetail;
    // Ignorer les films sans votes significatifs
    return d.vote_count >= 10 ? d.vote_average : null;
  } catch { return null; }
}

async function main() {
  // Récupérer tous les films avec un tmdbId mais sans note
  const films = await prisma.$queryRaw<Array<{ id: string; tmdbId: string; titre: string }>>`
    SELECT id, "tmdbId", titre
    FROM "Film"
    WHERE "tmdbId" IS NOT NULL
      AND ("tmdbNote" IS NULL OR "tmdbNote" = 0)
    ORDER BY "tmdbPopularite" DESC
  `;

  console.log(`🎬 ${films.length} films à enrichir avec la note TMDB\n`);
  let updated = 0;
  let skipped = 0;

  for (const [i, film] of films.entries()) {
    const note = await fetchNote(film.tmdbId);
    if (note !== null) {
      await prisma.$executeRaw`
        UPDATE "Film" SET "tmdbNote" = ${note} WHERE id = ${film.id}
      `;
      updated++;
      if (updated % 50 === 0 || i < 5) {
        console.log(`  ✅ [${i + 1}/${films.length}] "${film.titre}" → ${note.toFixed(1)}/10`);
      }
    } else {
      skipped++;
    }
    await sleep(200); // ~5 req/s → bien sous la limite TMDB
  }

  console.log(`\n✅ ${updated} films mis à jour, ${skipped} sans note TMDB`);
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
