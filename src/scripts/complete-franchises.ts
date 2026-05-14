/**
 * complete-franchises.ts
 * ─────────────────────────────────────────────────────────────────
 * Pour chaque film en base appartenant à une "collection" TMDB
 * (Star Wars, Le Seigneur des anneaux, Le Parrain, Harry Potter,
 * James Bond, Mission Impossible, Indiana Jones, MCU, etc.),
 * ajoute tous les films manquants de la collection.
 *
 * Algorithme :
 *   1. Pour chaque film avec tmdbId, récupère TMDB detail
 *   2. Si belongs_to_collection présent, fetch /collection/{id}
 *   3. Pour chaque film de la collection absent en base, l'ajoute
 *
 * Usage :
 *   npx tsx src/scripts/complete-franchises.ts [--dry-run]
 * ─────────────────────────────────────────────────────────────────
 */

import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import { normalizeGenres } from "../lib/genres.js";
dotenv.config();

const prisma   = new PrismaClient();
const TMDB_KEY = process.env["TMDB_API_KEY"]!;
const TMDB_BASE = "https://api.themoviedb.org/3";
const POSTER   = "https://image.tmdb.org/t/p/w500";
const DRY_RUN  = process.argv.includes("--dry-run");

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const GENRE_MAP: Record<number, string> = {
  28: "Action", 12: "Aventure", 16: "Animation", 35: "Comédie",
  80: "Crime", 99: "Documentaire", 18: "Drame", 10751: "Famille",
  14: "Fantastique", 36: "Historique", 27: "Horreur", 10402: "Musique",
  9648: "Mystère", 10749: "Romance", 878: "Science-Fiction",
  10770: "Thriller", 53: "Thriller", 10752: "Guerre", 37: "Western",
};

interface TmdbCollection {
  id: number;
  name: string;
  parts: Array<{
    id: number;
    title: string;
    original_title: string;
    poster_path: string | null;
    release_date: string;
    vote_average: number;
    vote_count: number;
    overview: string;
    popularity: number;
  }>;
}

interface TmdbDetail {
  id: number;
  title: string;
  original_title: string;
  poster_path: string | null;
  release_date: string;
  runtime: number | null;
  overview: string;
  vote_average: number;
  vote_count: number;
  popularity: number;
  belongs_to_collection: { id: number; name: string } | null;
  genres: Array<{ id: number; name: string }>;
  credits?: {
    crew: Array<{ job: string; name: string }>;
    cast: Array<{ name: string; order: number }>;
  };
}

async function fetchDetail(tmdbId: string): Promise<TmdbDetail | null> {
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
  } catch { return null; }
}

async function fetchCollection(collectionId: number): Promise<TmdbCollection | null> {
  try {
    const params = new URLSearchParams({
      api_key: TMDB_KEY,
      language: "fr-FR",
    });
    const res = await fetch(`${TMDB_BASE}/collection/${collectionId}?${params}`,
      { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return res.json() as Promise<TmdbCollection>;
  } catch { return null; }
}

async function main() {
  if (!TMDB_KEY) { console.error("❌ TMDB_API_KEY manquant"); process.exit(1); }

  console.log(`\n🎞️  Complétion des sagas (TMDB collections)${DRY_RUN ? " (DRY RUN)" : ""}\n`);

  const films = await prisma.film.findMany({
    where: { tmdbId: { not: null } },
    select: { id: true, titre: true, tmdbId: true },
  });
  console.log(`  ${films.length} films avec tmdbId à analyser\n`);

  const existing = await prisma.film.findMany({ select: { tmdbId: true } });
  const existingTmdbIds = new Set(existing.map(f => f.tmdbId).filter(Boolean) as string[]);

  const seenCollections = new Set<number>();
  const collectionsFound: Map<number, { name: string; missing: TmdbCollection["parts"] }> = new Map();

  // ── Étape 1 : détecter toutes les collections présentes en BDD ──
  console.log("📡 Détection des collections via TMDB...\n");

  for (let i = 0; i < films.length; i++) {
    const f = films[i];
    if (i % 50 === 0) {
      console.log(`  [${i}/${films.length}] ${seenCollections.size} collections trouvées`);
    }

    const detail = await fetchDetail(f.tmdbId!);
    await sleep(80);
    if (!detail || !detail.belongs_to_collection) continue;

    const colId = detail.belongs_to_collection.id;
    if (seenCollections.has(colId)) continue;
    seenCollections.add(colId);

    const col = await fetchCollection(colId);
    await sleep(120);
    if (!col) continue;

    // Filtrer parts manquants en base, avec poster, sortis (release_date présente)
    const missing = col.parts.filter(p =>
      !existingTmdbIds.has(String(p.id)) &&
      p.poster_path &&
      p.release_date &&
      p.release_date >= "1900-01-01"
    );

    if (missing.length > 0) {
      collectionsFound.set(colId, { name: col.name, missing });
    }
  }

  console.log(`\n✅ ${collectionsFound.size} collection(s) avec films manquants\n`);

  // ── Étape 2 : ajouter les films manquants ──
  let totalAdded   = 0;
  let totalSkipped = 0;
  let totalErrors  = 0;

  for (const [, { name, missing }] of collectionsFound) {
    console.log(`\n▶ ${name} : ${missing.length} film(s) à ajouter`);

    for (const part of missing) {
      const tmdbIdStr = String(part.id);

      // Re-vérifie (peut avoir été ajouté par une autre collection précédente)
      if (existingTmdbIds.has(tmdbIdStr)) { totalSkipped++; continue; }

      const detail = await fetchDetail(tmdbIdStr);
      await sleep(110);
      if (!detail) { totalErrors++; continue; }
      if (detail.runtime !== null && detail.runtime < 45) { totalSkipped++; continue; }

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
      if (!titre) { totalSkipped++; continue; }

      if (DRY_RUN) {
        console.log(`  [DRY] ✓ "${titre}" (${annee})`);
        existingTmdbIds.add(tmdbIdStr);
        totalAdded++;
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
        totalAdded++;
        console.log(`  ✓ "${titre}" (${annee})`);
      } catch (err: unknown) {
        if ((err as { code?: string }).code === "P2002") {
          existingTmdbIds.add(tmdbIdStr);
          totalSkipped++;
        } else {
          console.error(`  ❌ "${titre}" : ${(err as Error).message?.slice(0, 80)}`);
          totalErrors++;
        }
      }
    }
  }

  console.log("\n" + "─".repeat(60));
  console.log(`🎞️  Collections détectées : ${collectionsFound.size}`);
  console.log(`✅ Films ajoutés          : ${totalAdded}`);
  console.log(`⏭️  Ignorés               : ${totalSkipped}`);
  console.log(`❌ Erreurs                : ${totalErrors}`);

  const total = await prisma.film.count();
  console.log(`\n📚 Total films en base    : ${total}\n`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
