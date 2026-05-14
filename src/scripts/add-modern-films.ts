/**
 * add-modern-films.ts
 * ─────────────────────────────────────────────────────────
 * Peuple la base avec les films modernes (2000–2026) issus
 * de TMDB Discover, triés par popularité et qualité.
 *
 * Critères :
 *   - vote_average ≥ 6.0 (exigence un peu plus permissive que classics)
 *   - vote_count ≥ 100
 *   - poster_path obligatoire
 *
 * Usage :
 *   npx tsx src/scripts/add-modern-films.ts [--limit 800]
 * ─────────────────────────────────────────────────────────
 */

import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import { normalizeGenres } from "../lib/genres.js";
dotenv.config();

const prisma   = new PrismaClient();
const TMDB_KEY = process.env["TMDB_API_KEY"]!;
const TMDB_BASE = "https://api.themoviedb.org/3";
const POSTER   = "https://image.tmdb.org/t/p/w500";

const argLimit = process.argv.indexOf("--limit");
const LIMIT_INSERT = argLimit > -1 ? parseInt(process.argv[argLimit + 1], 10) : 800;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const GENRE_MAP: Record<number, string> = {
  28: "Action", 12: "Aventure", 16: "Animation", 35: "Comédie",
  80: "Crime", 99: "Documentaire", 18: "Drame", 10751: "Famille",
  14: "Fantastique", 36: "Historique", 27: "Horreur", 10402: "Musique",
  9648: "Mystère", 10749: "Romance", 878: "Science-Fiction",
  10770: "Thriller", 53: "Thriller", 10752: "Guerre", 37: "Western",
};

interface TmdbDiscover {
  results: Array<{
    id: number;
    title: string;
    original_title: string;
    poster_path: string | null;
    release_date: string;
    vote_average: number;
    vote_count: number;
    popularity: number;
    overview: string;
  }>;
  total_pages: number;
}

interface TmdbDetail {
  id: number;
  title: string;
  original_title: string;
  poster_path: string | null;
  release_date: string;
  runtime: number | null;
  overview: string;
  popularity: number;
  vote_average: number;
  vote_count: number;
  genres: Array<{ id: number; name: string }>;
  credits?: {
    crew: Array<{ job: string; name: string }>;
    cast: Array<{ name: string; order: number }>;
  };
}

async function fetchDiscover(page: number, year: number): Promise<TmdbDiscover> {
  const params = new URLSearchParams({
    api_key: TMDB_KEY,
    sort_by: "popularity.desc",
    "vote_average.gte": "6.0",
    "vote_count.gte": "100",
    "primary_release_year": String(year),
    page: String(page),
    include_adult: "false",
    language: "fr-FR",
  });
  const res = await fetch(`${TMDB_BASE}/discover/movie?${params}`,
    { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`TMDB Discover HTTP ${res.status}`);
  return res.json() as Promise<TmdbDiscover>;
}

async function fetchDetail(tmdbId: number): Promise<TmdbDetail | null> {
  try {
    const params = new URLSearchParams({
      api_key: TMDB_KEY,
      append_to_response: "credits",
      language: "fr-FR",
    });
    const res = await fetch(`${TMDB_BASE}/movie/${tmdbId}?${params}`,
      { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return res.json() as Promise<TmdbDetail>;
  } catch {
    return null;
  }
}

async function main() {
  if (!TMDB_KEY) { console.error("❌ TMDB_API_KEY manquant"); process.exit(1); }

  console.log("🎬  Ajout des films modernes (2000–2026) via TMDB Discover\n");

  const existing = await prisma.film.findMany({ select: { tmdbId: true } });
  const existingTmdbIds = new Set(existing.map(f => f.tmdbId).filter(Boolean) as string[]);
  console.log(`📚 ${existingTmdbIds.size} films déjà en base\n`);

  let inserted = 0;
  let skipped  = 0;
  let errors   = 0;
  const processedTmdbIds = new Set<number>();

  // De 2000 à 2026, par ordre décroissant (plus récent = plus pertinent)
  const years: number[] = [];
  for (let y = 2026; y >= 2000; y--) years.push(y);

  for (const year of years) {
    if (inserted >= LIMIT_INSERT) break;
    console.log(`\n📅 Année ${year}...`);

    // 5 pages par année (≈100 films max), surtout pour années récentes
    const pagesForYear = year >= 2010 ? 6 : year >= 2005 ? 4 : 3;

    for (let page = 1; page <= pagesForYear; page++) {
      if (inserted >= LIMIT_INSERT) break;

      let data: TmdbDiscover;
      try {
        data = await fetchDiscover(page, year);
      } catch (err) {
        console.error(`  ❌ Page ${page}: ${err}`);
        await sleep(2000);
        continue;
      }

      for (const movie of data.results) {
        if (inserted >= LIMIT_INSERT) break;
        if (processedTmdbIds.has(movie.id)) continue;
        processedTmdbIds.add(movie.id);

        const tmdbIdStr = String(movie.id);
        if (existingTmdbIds.has(tmdbIdStr)) { skipped++; continue; }
        if (!movie.poster_path)              { skipped++; continue; }

        const detail = await fetchDetail(movie.id);
        await sleep(110);
        if (!detail) { errors++; continue; }
        if (detail.runtime !== null && detail.runtime < 45) { skipped++; continue; }

        const annee = detail.release_date ? parseInt(detail.release_date.slice(0, 4), 10) : null;
        const rawGenres = (detail.genres ?? [])
          .map(g => GENRE_MAP[g.id] ?? g.name)
          .filter((g): g is string => Boolean(g));
        const genres = normalizeGenres(rawGenres);

        const realisateur = detail.credits?.crew.find(c => c.job === "Director")?.name ?? null;
        const acteurs = (detail.credits?.cast ?? [])
          .sort((a, b) => a.order - b.order)
          .slice(0, 5)
          .map(c => c.name);

        const titre = detail.title || detail.original_title;
        if (!titre) { skipped++; continue; }

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
          inserted++;
          if (inserted % 25 === 0) {
            console.log(`  [${inserted}] ✓ "${titre}" (${annee}) — ${realisateur ?? "?"}`);
          }
        } catch (err: unknown) {
          if ((err as { code?: string }).code === "P2002") {
            existingTmdbIds.add(tmdbIdStr);
            skipped++;
          } else {
            errors++;
          }
        }
      }

      await sleep(250);
    }
  }

  console.log("\n" + "─".repeat(60));
  console.log(`✅ Films ajoutés    : ${inserted}`);
  console.log(`⏭️  Films ignorés   : ${skipped}`);
  console.log(`❌ Erreurs          : ${errors}`);

  const total = await prisma.film.count();
  const modern = await prisma.film.count({ where: { annee: { gte: 2000 } } });
  console.log(`\n📚 Total films      : ${total}`);
  console.log(`📚 Films ≥ 2000     : ${modern}\n`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
