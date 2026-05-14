// Trouve les films sans tmdbId et les corrige via TMDB search
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
dotenv.config();

const prisma = new PrismaClient();
const TMDB_KEY  = process.env["TMDB_API_KEY"]!;
const TMDB_BASE = "https://api.themoviedb.org/3";
const POSTER    = "https://image.tmdb.org/t/p/w500";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface TmdbMovie { id: number; title: string; original_title: string; poster_path: string | null; release_date?: string }
interface TmdbSearch { results: TmdbMovie[] }

async function search(query: string, year?: number): Promise<TmdbMovie | null> {
  try {
    const p = new URLSearchParams({ api_key: TMDB_KEY, query, ...(year ? { year: String(year) } : {}) });
    const r = await fetch(`${TMDB_BASE}/search/movie?${p}`, { signal: AbortSignal.timeout(8_000) });
    if (!r.ok) return null;
    const d = await r.json() as TmdbSearch;
    return d.results?.[0] ?? null;
  } catch { return null; }
}

async function main() {
  const films = await prisma.film.findMany({
    where: { tmdbId: null },
    select: { id: true, titre: true, titreOriginal: true, annee: true },
  });

  console.log(`🔍 ${films.length} films sans tmdbId\n`);
  let fixed = 0;

  for (const film of films) {
    let found: TmdbMovie | null = null;

    // Essai 1 : titre original + année
    if (film.titreOriginal) found = await search(film.titreOriginal, film.annee ?? undefined);
    await sleep(150);
    // Essai 2 : titre français + année
    if (!found) { found = await search(film.titre, film.annee ?? undefined); await sleep(150); }
    // Essai 3 : sans année
    if (!found && film.titreOriginal) { found = await search(film.titreOriginal); await sleep(150); }
    if (!found) { found = await search(film.titre); await sleep(150); }

    if (!found || !found.poster_path) {
      console.log(`  ⚠️  "${film.titre}" (${film.annee}) — non trouvé`);
      continue;
    }

    // Vérifier conflit tmdbId
    const conflict = await prisma.film.findFirst({ where: { tmdbId: String(found.id) } });
    // Récupérer la note TMDB
    let tmdbNote: number | undefined;
    try {
      const detail = await fetch(`${TMDB_BASE}/movie/${found.id}?api_key=${TMDB_KEY}`, { signal: AbortSignal.timeout(6_000) });
      if (detail.ok) {
        const d = await detail.json() as { vote_average: number; vote_count: number };
        if (d.vote_count >= 10) tmdbNote = d.vote_average;
      }
    } catch { /**/ }

    if (conflict && conflict.id !== film.id) {
      // Mettre à jour affiche seulement
      await prisma.film.update({
        where: { id: film.id },
        data: { affiche: `${POSTER}${found.poster_path}`, ...(tmdbNote !== undefined ? { tmdbNote } : {}) },
      });
      console.log(`  ✅ "${film.titre}" → affiche seulement (tmdbId=${found.id} pris par "${conflict.titre}")`);
    } else {
      await prisma.film.update({
        where: { id: film.id },
        data: {
          tmdbId: String(found.id),
          affiche: `${POSTER}${found.poster_path}`,
          ...(tmdbNote !== undefined ? { tmdbNote } : {}),
        },
      });
      console.log(`  ✅ "${film.titre}" → TMDB #${found.id}${tmdbNote !== undefined ? ` (${tmdbNote.toFixed(1)}/10)` : ""}`);
    }
    fixed++;
    await sleep(250);
  }

  console.log(`\n✅ ${fixed}/${films.length} films corrigés`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
