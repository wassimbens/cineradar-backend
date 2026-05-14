// ─────────────────────────────────────────────────────────
//  Script : ajoute des films classiques depuis TMDB Discover.
//
//  Cible : films sortis avant 2001, note >= 7.0, votes >= 200.
//  Insère uniquement les films absents de la base.
//
//  Usage : npx tsx src/scripts/add-classics-tmdb.ts
// ─────────────────────────────────────────────────────────

import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import { normalizeGenres } from "../lib/genres.js";
dotenv.config();

const prisma = new PrismaClient();
const TMDB_KEY  = process.env["TMDB_API_KEY"]!;
const TMDB_BASE = "https://api.themoviedb.org/3";
const POSTER    = "https://image.tmdb.org/t/p/w500";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Mapping genres TMDB → français canonique ──────────────
const GENRE_MAP: Record<number, string> = {
  28:    "Action",
  12:    "Aventure",
  16:    "Animation",
  35:    "Comédie",
  80:    "Crime",
  99:    "Documentaire",
  18:    "Drame",
  10751: "Famille",
  14:    "Fantastique",
  36:    "Historique",
  27:    "Horreur",
  10402: "Musique",
  9648:  "Mystère",
  10749: "Romance",
  878:   "Science-Fiction",
  10770: "Thriller",
  53:    "Thriller",
  10752: "Guerre",
  37:    "Western",
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
  genres: Array<{ id: number; name: string }>;
  credits?: {
    crew: Array<{ job: string; name: string }>;
    cast: Array<{ name: string; order: number }>;
  };
}

async function fetchDiscover(page: number, maxYear: number): Promise<TmdbDiscover> {
  const params = new URLSearchParams({
    api_key: TMDB_KEY,
    sort_by: "vote_count.desc",
    "vote_average.gte": "7.0",
    "vote_count.gte": "200",
    "primary_release_date.lte": `${maxYear}-12-31`,
    page: String(page),
    include_adult: "false",
    language: "fr-FR",
  });
  const res = await fetch(`${TMDB_BASE}/discover/movie?${params}`, {
    signal: AbortSignal.timeout(10_000),
  });
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
    const res = await fetch(`${TMDB_BASE}/movie/${tmdbId}?${params}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return res.json() as Promise<TmdbDetail>;
  } catch {
    return null;
  }
}

async function main() {
  if (!TMDB_KEY) {
    console.error("❌ TMDB_API_KEY manquant dans .env");
    process.exit(1);
  }

  console.log("🎬 Ajout des films classiques via TMDB Discover\n");

  // Charger les tmdbIds déjà en base
  const existing = await prisma.film.findMany({ select: { tmdbId: true } });
  const existingTmdbIds = new Set(existing.map(f => f.tmdbId).filter(Boolean));

  console.log(`📚 ${existingTmdbIds.size} films déjà en base.\n`);

  let inserted = 0;
  let skipped  = 0;
  let errors   = 0;

  // Parcourir plusieurs années et pages
  const yearRanges = [
    { maxYear: 2010, pages: 12 },
    { maxYear: 2000, pages: 15 },
    { maxYear: 1990, pages: 12 },
    { maxYear: 1980, pages: 10 },
    { maxYear: 1970, pages: 8  },
    { maxYear: 1960, pages: 6  },
    { maxYear: 1950, pages: 5  },
    { maxYear: 1940, pages: 3  },
  ];

  const processedTmdbIds = new Set<number>();

  for (const range of yearRanges) {
    console.log(`\n📅 Films jusqu'à ${range.maxYear} (${range.pages} pages)...`);

    for (let page = 1; page <= range.pages; page++) {
      let results;
      try {
        const data = await fetchDiscover(page, range.maxYear);
        results = data.results;
        if (page === 1) console.log(`   Total TMDB pour cette requête : ${data.total_pages} pages`);
      } catch (err) {
        console.error(`  ❌ Erreur page ${page}:`, err);
        await sleep(2000);
        continue;
      }

      for (const movie of results) {
        if (processedTmdbIds.has(movie.id)) continue;
        processedTmdbIds.add(movie.id);

        const tmdbIdStr = String(movie.id);
        if (existingTmdbIds.has(tmdbIdStr)) {
          skipped++;
          continue;
        }

        if (!movie.poster_path) {
          skipped++;
          continue;
        }

        // Récupérer les détails complets
        const detail = await fetchDetail(movie.id);
        await sleep(120); // rate limit TMDB

        if (!detail) {
          errors++;
          continue;
        }

        const annee = detail.release_date ? parseInt(detail.release_date.split("-")[0]) : null;
        const rawGenres = (detail.genres ?? [])
          .map(g => GENRE_MAP[g.id] ?? g.name)
          .filter((g): g is string => Boolean(g));
        const genres = normalizeGenres(rawGenres);

        const realisateur = detail.credits?.crew
          .find(c => c.job === "Director")?.name ?? null;

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
              tmdbNote: movie.vote_count >= 10 ? movie.vote_average : null,
            },
          });

          console.log(`  ✅ ${titre} (${annee}) — TMDB #${tmdbIdStr}`);
          inserted++;
          existingTmdbIds.add(tmdbIdStr); // éviter les doublons inter-pages
        } catch (err: unknown) {
          if ((err as { code?: string }).code === "P2002") {
            // Doublon tmdbId entre pages différentes → ignorer
            skipped++;
          } else {
            console.error(`  ❌ ${titre} : ${err}`);
            errors++;
          }
        }
      }

      await sleep(300);
    }

    if (inserted >= 600) {
      console.log("\n✅ Objectif atteint (600 films insérés), arrêt.");
      break;
    }
  }

  console.log(`\n📊 Résumé :`);
  console.log(`   ✅ ${inserted} films ajoutés`);
  console.log(`   ⏭️  ${skipped} films ignorés (déjà en base ou sans affiche)`);
  console.log(`   ❌ ${errors} erreurs`);

  const total = await prisma.film.count();
  const classics = await prisma.film.count({ where: { annee: { lte: 2000 } } });
  console.log(`\n📚 État final : ${total} films en base (${classics} classiques ≤ 2000)`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
