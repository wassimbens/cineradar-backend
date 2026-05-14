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

import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import { normalizeGenres } from "../lib/genres.js";
dotenv.config();

const prisma    = new PrismaClient();
const TMDB_KEY  = process.env["TMDB_API_KEY"]!;
const TMDB_BASE = "https://api.themoviedb.org/3";
const POSTER    = "https://image.tmdb.org/t/p/w500";
const DRY_RUN   = process.argv.includes("--dry-run");
const ONLY_DIR  = process.argv.includes("--director")
  ? process.argv[process.argv.indexOf("--director") + 1]
  : null;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Genre map TMDB → français ─────────────────────────────
const GENRE_MAP: Record<number, string> = {
  28: "Action", 12: "Aventure", 16: "Animation", 35: "Comédie",
  80: "Crime", 99: "Documentaire", 18: "Drame", 10751: "Famille",
  14: "Fantastique", 36: "Historique", 27: "Horreur", 10402: "Musique",
  9648: "Mystère", 10749: "Romance", 878: "Science-Fiction",
  10770: "Thriller", 53: "Thriller", 10752: "Guerre", 37: "Western",
};

// ── Types TMDB ────────────────────────────────────────────
interface TmdbPerson {
  id: number;
  name: string;
  known_for_department: string;
  popularity: number;
}

interface TmdbMovieCredit {
  id: number;
  title: string;
  original_title: string;
  poster_path: string | null;
  release_date: string;
  vote_average: number;
  vote_count: number;
  popularity: number;
  overview: string;
  adult: boolean;
  job: string;
  genre_ids: number[];
}

interface TmdbMovieDetail {
  id: number;
  title: string;
  original_title: string;
  poster_path: string | null;
  release_date: string;
  runtime: number | null;
  overview: string;
  genres: Array<{ id: number; name: string }>;
  vote_average: number;
  vote_count: number;
  popularity: number;
  credits?: {
    crew: Array<{ job: string; name: string }>;
    cast: Array<{ name: string; order: number }>;
  };
}

// ── TMDB helpers ──────────────────────────────────────────

async function searchPerson(name: string): Promise<TmdbPerson | null> {
  try {
    const params = new URLSearchParams({ api_key: TMDB_KEY, query: name, language: "fr-FR" });
    const res = await fetch(`${TMDB_BASE}/search/person?${params}`,
      { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = await res.json() as { results: TmdbPerson[] };
    // Préférer un réalisateur (Director) connu
    const directors = data.results.filter(p =>
      p.known_for_department === "Directing" || p.known_for_department === "Writing"
    );
    return directors[0] ?? data.results[0] ?? null;
  } catch { return null; }
}

async function getMovieCredits(personId: number): Promise<TmdbMovieCredit[]> {
  try {
    const params = new URLSearchParams({ api_key: TMDB_KEY, language: "fr-FR" });
    const res = await fetch(`${TMDB_BASE}/person/${personId}/movie_credits?${params}`,
      { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const data = await res.json() as { crew: TmdbMovieCredit[] };
    return (data.crew ?? []).filter(m => m.job === "Director");
  } catch { return []; }
}

async function fetchDetail(tmdbId: number): Promise<TmdbMovieDetail | null> {
  try {
    const params = new URLSearchParams({
      api_key: TMDB_KEY,
      append_to_response: "credits",
      language: "fr-FR",
    });
    const res = await fetch(`${TMDB_BASE}/movie/${tmdbId}?${params}`,
      { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return res.json() as Promise<TmdbMovieDetail>;
  } catch { return null; }
}

// ── Normalisation nom de réalisateur (déduplication) ─────
function normalizeName(name: string): string {
  return name.toLowerCase()
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")   // retire accents
    .replace(/[^a-z\s]/g, " ")                          // ponctuation → espace
    .replace(/\s+/g, " ").trim();
}

// ── Main ──────────────────────────────────────────────────

async function main() {
  if (!TMDB_KEY) { console.error("❌ TMDB_API_KEY manquant"); process.exit(1); }

  console.log(`\n🎬  Enrichissement filmographies réalisateurs${DRY_RUN ? " (DRY RUN)" : ""}${ONLY_DIR ? ` — filtre: "${ONLY_DIR}"` : ""}\n`);

  // 1. Récupérer les réalisateurs distincts de la base
  const rows = await prisma.film.findMany({
    where: { realisateur: { not: null } },
    select: { realisateur: true },
    distinct: ["realisateur"],
  });

  // Dédupliquer par nom normalisé
  const seenNorm = new Map<string, string>(); // norm → canonical
  for (const { realisateur } of rows) {
    const r = realisateur!;
    const norm = normalizeName(r);
    if (!seenNorm.has(norm)) seenNorm.set(norm, r);
  }

  let directors = [...seenNorm.values()].sort();
  if (ONLY_DIR) directors = directors.filter(d => d.toLowerCase().includes(ONLY_DIR.toLowerCase()));

  console.log(`  ${directors.length} réalisateur(s) à traiter\n`);

  // 2. Charger les tmdbIds déjà en base
  const existingFilms = await prisma.film.findMany({ select: { tmdbId: true, titre: true } });
  const existingTmdbIds = new Set(existingFilms.map(f => f.tmdbId).filter(Boolean) as string[]);

  let totalAdded   = 0;
  let totalSkipped = 0;
  let totalErrors  = 0;
  let dirNotFound  = 0;

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
    const qualifying = credits.filter(m =>
      !m.adult &&
      m.poster_path !== null &&
      m.vote_count >= 25 &&
      m.release_date &&
      m.release_date >= "1900-01-01"
    );

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
        .filter((g): g is string => Boolean(g));
      const genres = normalizeGenres(rawGenres);

      const realisateur = detail.credits?.crew
        .find(c => c.job === "Director")?.name ?? dirName;

      const acteurs = (detail.credits?.cast ?? [])
        .sort((a, b) => a.order - b.order)
        .slice(0, 5)
        .map(c => c.name);

      const titre = detail.title || detail.original_title;
      if (!titre) { totalSkipped++; continue; }

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
      } catch (err: unknown) {
        if ((err as { code?: string }).code === "P2002") {
          // Doublon tmdbId — peut arriver si le même film est coréalisé
          existingTmdbIds.add(tmdbIdStr);
          totalSkipped++;
        } else {
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
