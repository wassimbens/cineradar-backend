/**
 * audit-posters-trailers.ts
 * ─────────────────────────────────────────────────────────────────
 * Audit générique des associations film ↔ TMDB.
 *
 * Pour chaque film de la base ayant un tmdbId :
 *  1. Fetch TMDB details (titre, année, réalisateur)
 *  2. Calcule un score de matching (titre + année + réalisateur)
 *  3. Si score faible → re-recherche TMDB et propose un meilleur match
 *  4. Met à jour tmdbId + affiche si --apply (sinon dry-run)
 *
 * Pour les films sans tmdbId :
 *  - Tente une recherche TMDB et associe si match haute-confiance
 *
 * Usage :
 *   npx tsx src/scripts/audit-posters-trailers.ts            # dry-run + rapport
 *   npx tsx src/scripts/audit-posters-trailers.ts --apply    # appliquer corrections
 *   npx tsx src/scripts/audit-posters-trailers.ts --limit 50 # limiter (debug)
 *   npx tsx src/scripts/audit-posters-trailers.ts --threshold 0.7 # seuil match
 * ─────────────────────────────────────────────────────────────────
 */

import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
dotenv.config();

const prisma    = new PrismaClient();
const TMDB_KEY  = process.env["TMDB_API_KEY"]!;
const TMDB_BASE = "https://api.themoviedb.org/3";
const POSTER    = "https://image.tmdb.org/t/p/w500";

const APPLY     = process.argv.includes("--apply");
const argLimit  = process.argv.indexOf("--limit");
const LIMIT     = argLimit > -1 ? parseInt(process.argv[argLimit + 1], 10) : 0;
const argThr    = process.argv.indexOf("--threshold");
const THRESHOLD = argThr > -1 ? parseFloat(process.argv[argThr + 1]) : 0.62;

if (!TMDB_KEY) {
  console.error("❌ TMDB_API_KEY manquante dans .env");
  process.exit(1);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Types TMDB ────────────────────────────────────────────
interface TmdbMovie {
  id: number;
  title: string;
  original_title: string;
  poster_path: string | null;
  release_date?: string;
  popularity?: number;
}
interface TmdbDetail extends TmdbMovie {
  runtime?: number;
  credits?: {
    crew: { job: string; name: string }[];
  };
}
interface TmdbSearch { results: TmdbMovie[] }

// ── Normalisation ─────────────────────────────────────────
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/^(le |la |les |l'|un |une |the |a |an )/i, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Distance Levenshtein normalisée 0–1 (1 = identique) ──
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const max = Math.max(a.length, b.length);
  const dist = levenshtein(a, b);
  return 1 - dist / max;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

// ── TMDB API ──────────────────────────────────────────────
async function tmdbDetail(tmdbId: string): Promise<TmdbDetail | null> {
  try {
    const url = `${TMDB_BASE}/movie/${tmdbId}?api_key=${TMDB_KEY}&language=fr-FR&append_to_response=credits`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json() as TmdbDetail;
  } catch {
    return null;
  }
}

async function tmdbSearch(query: string, year?: number): Promise<TmdbMovie[]> {
  try {
    const url = new URL(`${TMDB_BASE}/search/movie`);
    url.searchParams.set("api_key", TMDB_KEY);
    url.searchParams.set("query", query);
    url.searchParams.set("language", "fr-FR");
    url.searchParams.set("include_adult", "false");
    if (year) url.searchParams.set("primary_release_year", String(year));
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const data = await res.json() as TmdbSearch;
    return data.results || [];
  } catch {
    return [];
  }
}

// ── Score de matching ─────────────────────────────────────
function director(detail: TmdbDetail): string | null {
  return detail.credits?.crew?.find(c => c.job === "Director")?.name ?? null;
}

interface MatchScore {
  total: number;
  titleScore: number;
  yearScore: number;
  directorScore: number;
  detail?: string;
}

function score(
  dbFilm: { titre: string; titreOriginal: string | null; annee: number | null; realisateur: string | null },
  tmdb: { title: string; original_title: string; release_date?: string; director?: string | null }
): MatchScore {
  const titleScore = Math.max(
    similarity(norm(dbFilm.titre), norm(tmdb.title)),
    similarity(norm(dbFilm.titre), norm(tmdb.original_title)),
    dbFilm.titreOriginal ? similarity(norm(dbFilm.titreOriginal), norm(tmdb.original_title)) : 0,
  );

  let yearScore = 0.5; // neutre si on ne sait pas
  if (dbFilm.annee && tmdb.release_date) {
    const tmdbYear = parseInt(tmdb.release_date.slice(0, 4), 10);
    if (!isNaN(tmdbYear)) {
      const diff = Math.abs(tmdbYear - dbFilm.annee);
      yearScore = diff === 0 ? 1 : diff === 1 ? 0.85 : diff <= 2 ? 0.6 : 0;
    }
  }

  let directorScore = 0.5;
  if (dbFilm.realisateur && tmdb.director) {
    directorScore = similarity(norm(dbFilm.realisateur), norm(tmdb.director));
  }

  // Pondération : titre 50%, année 30%, réalisateur 20%
  const total = titleScore * 0.5 + yearScore * 0.3 + directorScore * 0.2;

  return {
    total,
    titleScore,
    yearScore,
    directorScore,
    detail: `t=${titleScore.toFixed(2)} y=${yearScore.toFixed(2)} d=${directorScore.toFixed(2)}`,
  };
}

// ── Main ──────────────────────────────────────────────────
async function main() {
  console.log(`\n🔍 Audit affiches/bandes-annonces${APPLY ? "" : " (DRY-RUN — utiliser --apply)"}`);
  console.log(`   seuil de match : ${THRESHOLD}\n`);

  const films = await prisma.film.findMany({
    select: {
      id: true,
      titre: true,
      titreOriginal: true,
      annee: true,
      realisateur: true,
      tmdbId: true,
      affiche: true,
    },
    orderBy: { titre: "asc" },
  });

  const target = LIMIT > 0 ? films.slice(0, LIMIT) : films;
  console.log(`  ${target.length}/${films.length} films à auditer\n`);

  let okCount        = 0;
  let suspectCount   = 0;
  let fixedCount     = 0;
  let unmatchedCount = 0;
  const suspects: string[] = [];

  for (let i = 0; i < target.length; i++) {
    const film = target[i];
    if (i % 25 === 0) {
      console.log(`  [${i}/${target.length}] OK ${okCount} | suspects ${suspectCount} | fixés ${fixedCount} | unmatched ${unmatchedCount}`);
    }

    // Étape 1 : si tmdbId présent, vérifier que c'est le bon
    if (film.tmdbId) {
      const detail = await tmdbDetail(film.tmdbId);
      await sleep(50);
      if (!detail) {
        // tmdbId invalide → reset et re-recherche
        film.tmdbId = null;
      } else {
        const dir = director(detail);
        const sc = score(film, {
          title: detail.title,
          original_title: detail.original_title,
          release_date: detail.release_date,
          director: dir,
        });

        if (sc.total >= THRESHOLD) {
          okCount++;
          // Synchroniser l'affiche si elle est manquante OU clairement erronée
          if (detail.poster_path) {
            const expected = `${POSTER}${detail.poster_path}`;
            if (film.affiche !== expected && APPLY) {
              await prisma.film.update({
                where: { id: film.id },
                data: { affiche: expected },
              });
            }
          }
          continue;
        }

        // Score faible → suspect, on tente une recherche
        suspectCount++;
        suspects.push(`  ⚠️ "${film.titre}" (${film.annee ?? "?"}) → tmdb#${film.tmdbId} "${detail.title}" (${detail.release_date?.slice(0, 4) ?? "?"}) [${sc.detail}]`);
      }
    }

    // Étape 2 : recherche TMDB (sans ou après tmdbId invalidé/suspect)
    const candidates: TmdbMovie[] = [];
    const tries = [
      { q: film.titre, y: film.annee ?? undefined },
      { q: film.titreOriginal ?? film.titre, y: film.annee ?? undefined },
      { q: film.titre, y: undefined },
    ];
    for (const { q, y } of tries) {
      if (!q) continue;
      const results = await tmdbSearch(q, y);
      candidates.push(...results.slice(0, 5));
      await sleep(60);
      if (candidates.length >= 8) break;
    }

    if (candidates.length === 0) {
      unmatchedCount++;
      continue;
    }

    // Récupérer le détail (avec credits) pour le top 3 candidats afin de scorer
    let best: { tmdb: TmdbMovie; detail: TmdbDetail; score: MatchScore } | null = null;
    for (const cand of candidates.slice(0, 3)) {
      const det = await tmdbDetail(String(cand.id));
      await sleep(50);
      if (!det) continue;
      const sc = score(film, {
        title: det.title,
        original_title: det.original_title,
        release_date: det.release_date,
        director: director(det),
      });
      if (!best || sc.total > best.score.total) {
        best = { tmdb: cand, detail: det, score: sc };
      }
    }

    if (!best || best.score.total < THRESHOLD) {
      unmatchedCount++;
      suspects.push(`  ❌ "${film.titre}" (${film.annee ?? "?"}) → aucun match fiable trouvé`);
      continue;
    }

    // On a un meilleur candidat → applique
    fixedCount++;
    const newTmdbId = String(best.tmdb.id);
    const newAffiche = best.tmdb.poster_path ? `${POSTER}${best.tmdb.poster_path}` : film.affiche;

    suspects.push(`  ✅ "${film.titre}" (${film.annee ?? "?"}) → tmdb#${newTmdbId} "${best.tmdb.title}" (${best.tmdb.release_date?.slice(0, 4) ?? "?"}) [${best.score.detail}]`);

    if (APPLY) {
      // S'assurer qu'aucun autre film n'a déjà ce tmdbId
      const collision = await prisma.film.findUnique({ where: { tmdbId: newTmdbId } });
      if (collision && collision.id !== film.id) {
        suspects.push(`     ⚠️ tmdb#${newTmdbId} déjà utilisé par "${collision.titre}" — non appliqué`);
        continue;
      }
      try {
        await prisma.film.update({
          where: { id: film.id },
          data: {
            tmdbId: newTmdbId,
            affiche: newAffiche,
          },
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        suspects.push(`     ❌ Update échoué : ${msg.slice(0, 80)}`);
      }
    }
  }

  console.log(`\n📊 Résultats audit :`);
  console.log(`  ✅ OK            : ${okCount}`);
  console.log(`  ⚠️  Suspects      : ${suspectCount}`);
  console.log(`  🔧 Re-matchés    : ${fixedCount}`);
  console.log(`  ❌ Non matchés   : ${unmatchedCount}`);

  if (suspects.length > 0) {
    console.log(`\n📝 Détails (${suspects.length} entrées) :`);
    suspects.slice(0, 80).forEach(s => console.log(s));
    if (suspects.length > 80) {
      console.log(`  … (+${suspects.length - 80} autres)`);
    }
  }

  if (!APPLY && fixedCount > 0) {
    console.log(`\n💡 Pour appliquer les corrections, relancer avec --apply\n`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
