/**
 * enrich-actors-filmography.ts
 * ─────────────────────────────────────────────────────────────────
 * Pour chaque acteur présent en base, récupère sa filmographie
 * complète depuis TMDB et ajoute les films manquants.
 *
 * Filtres (plus stricts que pour les réalisateurs car un acteur
 * peut apparaître dans des centaines de productions) :
 *   - vote_count >= 100
 *   - poster_path non nul
 *   - adult === false
 *   - runtime > 45 min si disponible
 *
 * Reprise automatique : un fichier .checkpoint sauvegarde la
 * progression — relancer le script reprend où il s'était arrêté.
 *
 * Usage :
 *   npx tsx src/scripts/enrich-actors-filmography.ts [--dry-run] [--reset]
 *   npx tsx src/scripts/enrich-actors-filmography.ts --actor "Cate Blanchett"
 * ─────────────────────────────────────────────────────────────────
 */

import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { normalizeGenres } from "../lib/genres.js";
dotenv.config();

const prisma    = new PrismaClient();
const TMDB_KEY  = process.env["TMDB_API_KEY"]!;
const TMDB_BASE = "https://api.themoviedb.org/3";
const POSTER    = "https://image.tmdb.org/t/p/w500";
const DRY_RUN   = process.argv.includes("--dry-run");
const RESET     = process.argv.includes("--reset");
const ONLY_ACT  = process.argv.includes("--actor")
  ? process.argv[process.argv.indexOf("--actor") + 1]
  : null;

const CHECKPOINT_FILE = path.join(process.cwd(), ".actors-checkpoint.json");
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
  genre_ids: number[];
  character: string;
  order: number;
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

// ── Helpers ───────────────────────────────────────────────

function normalizeName(name: string): string {
  return name.toLowerCase()
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ").trim();
}

async function searchPerson(name: string): Promise<TmdbPerson | null> {
  try {
    const params = new URLSearchParams({ api_key: TMDB_KEY, query: name, language: "fr-FR" });
    const res = await fetch(`${TMDB_BASE}/search/person?${params}`,
      { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = await res.json() as { results: TmdbPerson[] };
    // Préférer un acteur connu
    const actors = data.results.filter(p =>
      p.known_for_department === "Acting"
    );
    return actors[0] ?? data.results[0] ?? null;
  } catch { return null; }
}

async function getCastCredits(personId: number): Promise<TmdbMovieCredit[]> {
  try {
    const params = new URLSearchParams({ api_key: TMDB_KEY, language: "fr-FR" });
    const res = await fetch(`${TMDB_BASE}/person/${personId}/movie_credits?${params}`,
      { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const data = await res.json() as { cast: TmdbMovieCredit[] };
    return data.cast ?? [];
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

// ── Checkpoint ────────────────────────────────────────────

function loadCheckpoint(): { done: string[] } {
  if (RESET && fs.existsSync(CHECKPOINT_FILE)) {
    fs.unlinkSync(CHECKPOINT_FILE);
  }
  if (fs.existsSync(CHECKPOINT_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf8"));
    } catch { /* ignore */ }
  }
  return { done: [] };
}

function saveCheckpoint(done: string[]) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify({ done }), "utf8");
}

// ── Main ──────────────────────────────────────────────────

async function main() {
  if (!TMDB_KEY) { console.error("❌ TMDB_API_KEY manquant"); process.exit(1); }

  console.log(`\n🎭  Enrichissement filmographies acteurs${DRY_RUN ? " (DRY RUN)" : ""}${ONLY_ACT ? ` — filtre: "${ONLY_ACT}"` : ""}\n`);

  // 1. Récupérer tous les acteurs distincts en base
  const allFilms = await prisma.film.findMany({ select: { acteurs: true } });
  const acteurCount = new Map<string, number>();
  for (const f of allFilms) {
    for (const a of f.acteurs) {
      acteurCount.set(a, (acteurCount.get(a) ?? 0) + 1);
    }
  }

  // Trier par nombre d'apparitions (les plus courants d'abord = plus de valeur)
  let acteurs = [...acteurCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  if (ONLY_ACT) {
    acteurs = acteurs.filter(a => a.toLowerCase().includes(ONLY_ACT.toLowerCase()));
  }

  console.log(`  ${acteurs.length} acteur(s) à traiter\n`);

  // 2. Charger les tmdbIds déjà en base
  const existingFilms = await prisma.film.findMany({ select: { tmdbId: true } });
  const existingTmdbIds = new Set(existingFilms.map(f => f.tmdbId).filter(Boolean) as string[]);

  // 3. Reprendre depuis le checkpoint
  const checkpoint = loadCheckpoint();
  const doneSet = new Set(checkpoint.done);
  const remaining = acteurs.filter(a => !doneSet.has(a));
  console.log(`  ${doneSet.size} déjà traités, ${remaining.length} restants\n`);

  let totalAdded   = 0;
  let totalSkipped = 0;
  let totalErrors  = 0;
  let notFound     = 0;
  const done: string[] = [...checkpoint.done];

  // ── Gestion Ctrl+C ───────────────────────────────────────
  process.on("SIGINT", () => {
    console.log("\n\n⏸  Interruption — sauvegarde du checkpoint…");
    saveCheckpoint(done);
    console.log(`   ${done.length} acteurs sauvegardés. Relancez pour reprendre.\n`);
    process.exit(0);
  });

  // 4. Pour chaque acteur
  for (let i = 0; i < remaining.length; i++) {
    const actorName = remaining[i];
    const progress = `[${i + 1 + doneSet.size}/${acteurs.length}]`;

    console.log(`\n▶  ${progress} ${actorName} (${acteurCount.get(actorName)} film(s) en base)`);

    // Rechercher sur TMDB
    await sleep(200);
    const person = await searchPerson(actorName);

    if (!person) {
      console.log(`   ⚠️  Introuvable sur TMDB`);
      notFound++;
      done.push(actorName);
      if (done.length % 50 === 0) saveCheckpoint(done);
      continue;
    }

    // Récupérer les crédits de jeu
    await sleep(150);
    const credits = await getCastCredits(person.id);

    // Filtrer (plus strict pour les acteurs)
    const qualifying = credits.filter(m =>
      !m.adult &&
      m.poster_path !== null &&
      m.vote_count >= 100 &&
      m.release_date &&
      m.release_date >= "1920-01-01"
    );

    console.log(`   ${credits.length} films joués → ${qualifying.length} qualifiants (vote_count≥100 + affiche)`);

    let added = 0;

    for (const movie of qualifying) {
      const tmdbIdStr = String(movie.id);

      if (existingTmdbIds.has(tmdbIdStr)) {
        totalSkipped++;
        continue;
      }

      await sleep(130);
      const detail = await fetchDetail(movie.id);
      if (!detail) { totalErrors++; continue; }

      // Court-métrage
      if (detail.runtime !== null && detail.runtime < 45) {
        totalSkipped++;
        continue;
      }

      const annee = detail.release_date ? parseInt(detail.release_date.slice(0, 4)) : null;
      const rawGenres = (detail.genres ?? []).map(g => GENRE_MAP[g.id] ?? g.name).filter(Boolean);
      const genres = normalizeGenres(rawGenres as string[]);

      const realisateur = detail.credits?.crew.find(c => c.job === "Director")?.name ?? null;
      const acteursList = (detail.credits?.cast ?? [])
        .sort((a, b) => a.order - b.order)
        .slice(0, 5)
        .map(c => c.name);

      const titre = detail.title || detail.original_title;
      if (!titre) { totalSkipped++; continue; }

      if (DRY_RUN) {
        console.log(`   [DRY] "${titre}" (${annee}) — TMDB #${tmdbIdStr}`);
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
            realisateur: realisateur ?? null,
            acteurs: acteursList,
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
          existingTmdbIds.add(tmdbIdStr);
          totalSkipped++;
        } else {
          console.error(`   ❌ "${titre}" : ${err}`);
          totalErrors++;
        }
      }
    }

    if (!DRY_RUN && added > 0) {
      console.log(`   → ${added} film(s) ajouté(s) pour ${actorName}`);
    }

    done.push(actorName);
    // Sauvegarder toutes les 50 personnes
    if (done.length % 50 === 0) {
      saveCheckpoint(done);
      const total = await prisma.film.count();
      console.log(`\n   💾 Checkpoint — ${done.length} acteurs traités — ${total} films en base\n`);
    }
  }

  // Checkpoint final
  saveCheckpoint(done);

  // ── Résumé ──────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log(`✅ Films ajoutés       : ${totalAdded}`);
  console.log(`⏭️  Films ignorés      : ${totalSkipped} (déjà en base / trop courts)`);
  console.log(`❌ Erreurs             : ${totalErrors}`);
  console.log(`🔍 Acteurs introuvables : ${notFound}/${acteurs.length}`);

  const total = await prisma.film.count();
  console.log(`\n📚 Total films en base : ${total}\n`);

  // Nettoyer le checkpoint si tout est terminé
  if (fs.existsSync(CHECKPOINT_FILE)) fs.unlinkSync(CHECKPOINT_FILE);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
