// ─────────────────────────────────────────────────────────
//  Script : enrichit automatiquement les affiches manquantes.
//
//  Sources tentées dans l'ordre :
//    1. TMDB (tmdbId direct si dispo)
//    2. TMDB recherche français (avec / sans année)
//    3. TMDB recherche anglais (avec / sans année)
//    4. TMDB avec tolérance année ±1
//    5. OMDB (si OMDB_API_KEY configuré)
//    6. AlloCiné scraping (100% gratuit, aucune clé requise)
//    7. YouTube thumbnail via TMDB videos (dernier recours)
//
//  Usage :
//    npx tsx src/scripts/auto-fix-posters.ts
//    npx tsx src/scripts/auto-fix-posters.ts --all
// ─────────────────────────────────────────────────────────

import { PrismaClient } from "@prisma/client";
import * as cheerio from "cheerio";
import * as dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

const TMDB_API_KEY = process.env["TMDB_API_KEY"];
const OMDB_API_KEY = process.env["OMDB_API_KEY"];
const TMDB_BASE    = "https://api.themoviedb.org/3";
const POSTER_BASE  = "https://image.tmdb.org/t/p/w500";
const FORCE_ALL    = process.argv.includes("--all");

const HEADERS_BROWSER = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8",
};

interface TmdbMovie {
  id: number;
  title: string;
  original_title: string;
  poster_path: string | null;
  release_date?: string;
  overview?: string;
  popularity?: number;
}
interface TmdbSearchResult { results: TmdbMovie[]; total_results: number; }
interface TmdbDetail extends TmdbMovie {
  runtime?: number;
  genres?: { id: number; name: string }[];
  credits?: {
    crew: { job: string; name: string }[];
    cast: { name: string; order: number }[];
  };
}
interface OmdbResult {
  Poster?: string;
  Title?: string;
  Year?: string;
  imdbID?: string;
  Response?: "True" | "False";
}

// ── Helpers ───────────────────────────────────────────────

function normalizeTitle(titre: string): string {
  return titre
    .replace(/[''‚‛′‵]/g, "'")
    .replace(/[""„‟″‶]/g, '"')
    .replace(/^(le |la |les |l'|un |une |the |a |an )/i, "")
    .trim();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function verifyImageUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok && (res.headers.get("content-type") ?? "").startsWith("image");
  } catch {
    return false;
  }
}

// ── TMDB ─────────────────────────────────────────────────

async function tmdbSearch(
  titre: string,
  annee?: number | null,
  lang = "fr-FR"
): Promise<TmdbMovie | null> {
  if (!TMDB_API_KEY) return null;

  const trySearch = async (query: string, year?: number): Promise<TmdbMovie | null> => {
    const params = new URLSearchParams({
      api_key: TMDB_API_KEY!,
      query,
      language: lang,
      include_adult: "false",
    });
    if (year) params.set("year", String(year));
    try {
      const res = await fetch(`${TMDB_BASE}/search/movie?${params}`, {
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as TmdbSearchResult;
      if (data.results.length === 0) return null;
      return data.results.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))[0];
    } catch {
      return null;
    }
  };

  // 1. Titre exact + année
  let r = annee ? await trySearch(titre, annee) : null;
  if (r) return r;

  // 2. Titre exact sans année
  r = await trySearch(titre);
  if (r) return r;

  // 3. Titre normalisé (sans article)
  const norm = normalizeTitle(titre);
  if (norm !== titre) {
    r = annee ? await trySearch(norm, annee) : null;
    if (!r) r = await trySearch(norm);
    if (r) return r;
  }

  // 4. Tolérance année ±1
  if (annee) {
    for (const delta of [-1, 1, -2, 2]) {
      r = await trySearch(titre, annee + delta);
      if (r) return r;
      if (norm !== titre) {
        r = await trySearch(norm, annee + delta);
        if (r) return r;
      }
    }
  }

  return null;
}

async function tmdbById(id: number): Promise<TmdbDetail | null> {
  if (!TMDB_API_KEY) return null;
  // NOTE: no language parameter → canonical poster (not localized fr-FR poster)
  const url =
    `${TMDB_BASE}/movie/${id}?api_key=${TMDB_API_KEY}` +
    `&append_to_response=credits`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    return (await res.json()) as TmdbDetail;
  } catch {
    return null;
  }
}

/** Résolution multi-stratégies TMDB */
async function tmdbResolve(film: {
  titre: string;
  titreOriginal: string | null;
  annee: number | null;
  tmdbId: string | null;
}): Promise<TmdbDetail | null> {
  // Stratégie 1 : tmdbId connu
  if (film.tmdbId && /^\d+$/.test(film.tmdbId)) {
    const d = await tmdbById(parseInt(film.tmdbId, 10));
    if (d) return d;
  }

  // Stratégie 2 : titre français
  const s1 = await tmdbSearch(film.titre, film.annee, "fr-FR");
  if (s1) {
    const d = await tmdbById(s1.id);
    if (d?.poster_path) return d;
  }

  // Stratégie 3 : titre original
  if (film.titreOriginal && film.titreOriginal !== film.titre) {
    const s2 = await tmdbSearch(film.titreOriginal, film.annee, "fr-FR");
    if (s2) {
      const d = await tmdbById(s2.id);
      if (d?.poster_path) return d;
    }
  }

  // Stratégie 4 : recherche en anglais
  const s3 = await tmdbSearch(film.titre, film.annee, "en-US");
  if (s3) {
    const d = await tmdbById(s3.id);
    if (d?.poster_path) return d;
  }

  // Stratégie 5 : titre original en anglais
  if (film.titreOriginal && film.titreOriginal !== film.titre) {
    const s4 = await tmdbSearch(film.titreOriginal, film.annee, "en-US");
    if (s4) {
      const d = await tmdbById(s4.id);
      if (d?.poster_path) return d;
    }
  }

  // Retourner quand même les métadonnées (sans poster)
  if (s1) return tmdbById(s1.id);
  if (s3) return tmdbById(s3.id);
  return null;
}

// ── YouTube thumbnail via TMDB ────────────────────────────

async function tmdbGetYoutubeThumbnail(tmdbId: number): Promise<string | null> {
  if (!TMDB_API_KEY) return null;
  const url = `${TMDB_BASE}/movie/${tmdbId}/videos?api_key=${TMDB_API_KEY}&language=fr-FR`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results: { key: string; site: string; type: string }[];
    };
    const trailer =
      data.results.find((v) => v.site === "YouTube" && v.type === "Trailer") ??
      data.results.find((v) => v.site === "YouTube");
    if (!trailer?.key) return null;
    const maxres = `https://img.youtube.com/vi/${trailer.key}/maxresdefault.jpg`;
    if (await verifyImageUrl(maxres)) return maxres;
    const hq = `https://img.youtube.com/vi/${trailer.key}/hqdefault.jpg`;
    return (await verifyImageUrl(hq)) ? hq : null;
  } catch {
    return null;
  }
}

// ── OMDB ──────────────────────────────────────────────────

async function omdbFetchPoster(titre: string, annee?: number | null): Promise<string | null> {
  if (!OMDB_API_KEY) return null;
  const params = new URLSearchParams({
    apikey: OMDB_API_KEY,
    t: titre,
    type: "movie",
    r: "json",
  });
  if (annee) params.set("y", String(annee));
  try {
    const res = await fetch(`https://www.omdbapi.com/?${params}`, {
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as OmdbResult;
    const poster = data.Poster;
    if (!poster || poster === "N/A") return null;
    return poster.replace(/_SX\d+/, "_SX500");
  } catch {
    return null;
  }
}

// ── AlloCiné scraping (gratuit, aucune clé) ───────────────

async function allocineFetchPoster(
  titre: string,
  annee?: number | null
): Promise<string | null> {
  try {
    const query = encodeURIComponent(titre);
    const url = `https://www.allocine.fr/recherche/?q=${query}&ef=mfilm`;

    const res = await fetch(url, {
      headers: HEADERS_BROWSER,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);

    // Parcourir les résultats de recherche
    let bestPoster: string | null = null;
    let bestScore = -1;

    $(".entity-card, .meta-body-item, .thumbnail-container").each((_, el) => {
      const card = $(el).closest(".entity-card, [class*='card']");

      // Vérifier correspondance d'année si disponible
      const cardYear = parseInt(
        card.find("[class*='year'], .meta-body-info").text().match(/\d{4}/)?.[0] ?? "0",
        10
      );

      let score = 0;
      if (annee && cardYear === annee) score += 2;
      else if (annee && Math.abs(cardYear - annee) <= 1) score += 1;
      else if (!annee) score += 1;

      // Extraire l'URL du poster
      const imgSrc =
        card.find("img[src*='acsta.net']").first().attr("src") ??
        card.find("img[data-src*='acsta.net']").first().attr("data-src") ??
        $(el).find("img[src*='acsta.net']").first().attr("src");

      if (imgSrc && score > bestScore) {
        bestScore = score;
        // Upscaler la résolution : remplacer les miniatures par la grande taille
        bestPoster = imgSrc
          .replace(/r_\d+_\d+\//, "r_640_600/")
          .replace(/c_\d+_\d+\//, "r_640_600/");
        if (!bestPoster.includes("/r_640_600/") && !bestPoster.includes("pictures/")) {
          bestPoster = imgSrc;
        }
      }
    });

    // Fallback : chercher n'importe quelle image acsta
    if (!bestPoster) {
      const firstAcsta = $("img[src*='acsta.net']").first().attr("src");
      if (firstAcsta) {
        bestPoster = firstAcsta.replace(/r_\d+_\d+\//, "r_640_600/");
      }
    }

    if (!bestPoster) return null;

    // Vérifier que l'image est accessible
    const ok = await verifyImageUrl(bestPoster);
    if (!ok) {
      // Essayer sans modification de taille
      const orig = bestPoster.replace(/r_640_600\//, "");
      return (await verifyImageUrl(orig)) ? orig : null;
    }
    return bestPoster;
  } catch {
    return null;
  }
}

// ── Filtrage des films à traiter ──────────────────────────

async function filterBrokenPosters(
  films: Awaited<ReturnType<typeof prisma.film.findMany>>
) {
  const broken: typeof films = [];
  for (const film of films) {
    if (!film.affiche) {
      broken.push(film);
      continue;
    }
    // Poster TMDB valide → skip
    if (film.affiche.includes("image.tmdb.org")) continue;
    // Tout autre source (CDN scraper) → à corriger
    broken.push(film);
  }
  return broken;
}

// ── Main ──────────────────────────────────────────────────

async function main() {
  if (!TMDB_API_KEY) {
    console.error("❌ TMDB_API_KEY manquant dans .env");
    process.exit(1);
  }

  if (!OMDB_API_KEY) {
    console.log("ℹ️  OMDB_API_KEY absent — OMDB désactivé (AlloCiné utilisé à la place)");
  }

  console.log(`\n🎬 Enrichissement des affiches…`);
  console.log(
    FORCE_ALL
      ? "   Mode : TOUTES les affiches (--all)\n"
      : "   Mode : affiches manquantes + URLs non-TMDB\n"
  );

  const allFilms = await prisma.film.findMany({ orderBy: { titre: "asc" } });
  const films = FORCE_ALL ? allFilms : await filterBrokenPosters(allFilms);

  console.log(`📋 ${films.length} film(s) à traiter\n`);

  let updated = 0;
  let notFound = 0;
  let metaOnly = 0;
  let errors = 0;

  for (const film of films) {
    await sleep(300); // anti-rate-limit TMDB

    process.stdout.write(`  🔍 "${film.titre}" (${film.annee ?? "?"})… `);

    try {
      // ── Résolution TMDB ──
      const detail = await tmdbResolve(film);

      let posterUrl: string | null = null;
      let source = "";

      // Source 1 : TMDB poster
      if (detail?.poster_path) {
        posterUrl = `${POSTER_BASE}${detail.poster_path}`;
        source = "TMDB";
      }

      // Source 2 : OMDB
      if (!posterUrl && OMDB_API_KEY) {
        const titleToSearch = film.titreOriginal ?? film.titre;
        posterUrl = await omdbFetchPoster(titleToSearch, film.annee);
        if (!posterUrl && film.titreOriginal && film.titreOriginal !== film.titre) {
          posterUrl = await omdbFetchPoster(film.titre, film.annee);
        }
        if (posterUrl) source = "OMDB";
        await sleep(150);
      }

      // Source 3 : AlloCiné scraping (gratuit)
      if (!posterUrl) {
        await sleep(500); // respecter AlloCiné
        posterUrl = await allocineFetchPoster(film.titre, film.annee);
        if (!posterUrl && film.titreOriginal && film.titreOriginal !== film.titre) {
          await sleep(500);
          posterUrl = await allocineFetchPoster(film.titreOriginal, film.annee);
        }
        if (posterUrl) source = "AlloCiné";
      }

      // Source 4 : YouTube thumbnail via TMDB videos
      if (!posterUrl && detail?.id) {
        const ytThumb = await tmdbGetYoutubeThumbnail(detail.id);
        if (ytThumb) {
          posterUrl = ytThumb;
          source = "YouTube";
        }
      }

      // Valider l'URL du poster (TMDB est fiable, les autres on vérifie)
      const posterValid = posterUrl
        ? posterUrl.includes("image.tmdb.org") || (await verifyImageUrl(posterUrl))
        : false;

      if (!detail && !posterValid) {
        console.log("❌ introuvable");
        notFound++;
        continue;
      }

      // ── Préparer l'update ──
      const updateData: Record<string, unknown> = {};

      if (detail) updateData["tmdbId"] = String(detail.id);
      if (posterValid && posterUrl) updateData["affiche"] = posterUrl;

      // Enrichir les métadonnées manquantes
      if (detail) {
        if (!film.synopsis && detail.overview)
          updateData["synopsis"] = detail.overview;
        if (!film.annee && detail.release_date)
          updateData["annee"] = parseInt(detail.release_date.slice(0, 4), 10);
        if (!film.duree && detail.runtime)
          updateData["duree"] = detail.runtime;
        if ((!film.genres || film.genres.length === 0) && detail.genres?.length)
          updateData["genres"] = detail.genres.map((g) => g.name);
        if (!film.realisateur && detail.credits?.crew) {
          const dir = detail.credits.crew.find((p) => p.job === "Director");
          if (dir) updateData["realisateur"] = dir.name;
        }
        if ((!film.acteurs || film.acteurs.length === 0) && detail.credits?.cast) {
          updateData["acteurs"] = detail.credits.cast
            .sort((a, b) => a.order - b.order)
            .slice(0, 5)
            .map((a) => a.name);
        }
      }

      if (Object.keys(updateData).length === 0) {
        console.log("⏭  déjà à jour");
        continue;
      }

      // ── Sauvegarder ──
      try {
        await prisma.film.update({ where: { id: film.id }, data: updateData });
      } catch (updateErr: unknown) {
        // Conflit tmdbId (P2002) → réessayer sans tmdbId
        const isP2002 =
          typeof updateErr === "object" &&
          updateErr !== null &&
          "code" in updateErr &&
          (updateErr as { code: string }).code === "P2002";

        if (isP2002 && updateData["tmdbId"]) {
          const { tmdbId: _dropped, ...rest } = updateData as Record<string, unknown>;
          if (Object.keys(rest).length > 0) {
            await prisma.film.update({ where: { id: film.id }, data: rest });
          }
        } else {
          throw updateErr;
        }
      }

      if (posterValid) {
        console.log(`✅ poster (${source})`);
        updated++;
      } else {
        console.log(`ℹ️  métadonnées enrichies`);
        metaOnly++;
      }
    } catch (err) {
      console.log(`💥 ${err}`);
      errors++;
    }
  }

  console.log(`
📊 Résultat :
   ✅  ${updated} affiches mises à jour
   ℹ️  ${metaOnly} métadonnées enrichies (sans poster)
   ❌  ${notFound} films introuvables
   💥  ${errors} erreurs
  `);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
