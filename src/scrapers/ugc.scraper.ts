// ─────────────────────────────────────────────────────────
//  Scraper UGC — ugc.fr
//
//  Stratégie :
//    1. Playwright ouvre la page film+cinéma pour capturer les cookies
//       ET intercepter le POST automatique (→ regionId + 1er jour de séances)
//    2. Pour chaque jour disponible (getDaysByFilm), POST getShowingsByFilm
//    3. Parse le bloc #bloc-showing-cinema-{id} + .screening-time-start
//
//  Endpoints :
//    GET  /showingsCinemaAjaxAction!getShowingsForCinemaPage.action?cinemaId={id}
//    GET  /showingsFilmAjaxAction!getDaysByFilm.action?filmId={id}&day=
//    POST /showingsFilmAjaxAction!getShowingsByFilm.action
//         body: filmId=X&day=YYYY-MM-DD&regionId=RRRR&defaultRegionId=1&__multiselect_versions=
//
//  Structure HTML de la réponse POST :
//    <div id="bloc-showing-cinema-{cinemaId}" class="band component--cinema-list-item">
//      ...
//      <div class="screening-time-start">14:30</div>
//      ...
//    </div>
// ─────────────────────────────────────────────────────────

import { chromium, Browser, BrowserContext, Page } from "playwright";
import * as cheerio from "cheerio";
import { Version } from "@prisma/client";

import { BaseScraper } from "./base.scraper.js";
import { CHROMIUM_ARGS } from "./chromium-args.js";
import {
  ScraperResult,
  ScrapedCinema,
  ScrapedCinemaFilm,
  ScrapedFilm,
  ScrapedSeance,
} from "./types.js";

// ── Constantes ────────────────────────────────────────────

const BASE_URL = "https://www.ugc.fr";

// Nombre de films à scraper par cinéma (limite pour éviter la surcharge)
const MAX_FILMS_PER_CINEMA = 20;

// ── Cinémas UGC France entière (liste complète 2026-05) ──────────────────────
// Les IDs numériques hardcodés (Paris/IdF) évitent une requête de découverte.
// Pour les cinémas sans id hardcodé, le scraper visite leur page ugc.fr
// pour extraire le cinemaId automatiquement.
// George V et Normandie ne sont plus actifs.
const PARIS_CINEMA_SLUGS: Array<{ slug: string; nom: string; id?: string }> = [
  // ── Paris intra-muros ──
  { slug: "ugc-cine-cite-les-halles",            nom: "UGC Ciné Cité Les Halles",              id: "10" },
  { slug: "ugc-cine-cite-bercy",                 nom: "UGC Ciné Cité Bercy",                   id: "12" },
  { slug: "ugc-cine-cite-maillot",               nom: "UGC Ciné Cité Maillot",                 id: "7"  },
  { slug: "ugc-montparnasse",                    nom: "UGC Montparnasse",                       id: "14" },
  { slug: "ugc-rotonde",                         nom: "UGC Rotonde",                            id: "15" },
  { slug: "ugc-odeon",                           nom: "UGC Odéon",                              id: "13" },
  { slug: "ugc-danton",                          nom: "UGC Danton",                             id: "4"  },
  { slug: "ugc-lyon-bastille",                   nom: "UGC Lyon Bastille",                      id: "11" },
  { slug: "ugc-gobelins",                        nom: "UGC Gobelins",                           id: "5"  },
  { slug: "ugc-opera",                           nom: "UGC Opéra",                              id: "9"  },
  { slug: "ugc-cine-cite-paris-19",              nom: "UGC Ciné Cité Paris 19",                 id: "37" },
  // ── Île-de-France ──
  { slug: "ugc-cine-cite-la-defense",            nom: "UGC Ciné Cité La Défense",               id: "20" },
  { slug: "ugc-issy-les-moulineaux",             nom: "UGC Issy-les-Moulineaux",                id: "59" },
  { slug: "ugc-cine-cite-rosny",                 nom: "UGC Ciné Cité Rosny",                    id: "18" },
  { slug: "ugc-cine-cite-creteil",               nom: "UGC Ciné Cité Créteil",                  id: "21" },
  { slug: "ugc-cine-cite-velizy",                nom: "UGC Ciné Cité Vélizy",                   id: "43" },
  { slug: "ugc-cine-cite-noisy-le-grand",        nom: "UGC Ciné Cité Noisy-le-Grand",           id: "19" },
  { slug: "ugc-cine-cite-cergy-le-haut",         nom: "UGC Ciné Cité Cergy-le-Haut",            id: "16" },
  { slug: "ugc-enghien",                         nom: "UGC Enghien",                            id: "17" },
  { slug: "ugc-cine-cite-parly",                 nom: "UGC Ciné Cité Parly",                    id: "44" },
  { slug: "ugc-cine-cite-sqy-ouest",             nom: "UGC Ciné Cité SQY Ouest",                id: "6"  },
  { slug: "ugc-plaisir",                         nom: "UGC Plaisir",                            id: "55" },
  { slug: "ugc-cine-cite-o-parinor",             nom: "UGC Ciné Cité O'Parinor",                id: "38" },
  { slug: "ugc-roxane",                          nom: "UGC Roxane",                             id: "40" },
  { slug: "ugc-cyrano",                          nom: "UGC Cyrano",                             id: "41" },
  { slug: "ugc-le-majestic",                     nom: "UGC Le Majestic",                        id: "39" },
  // ── Lyon ──
  { slug: "ugc-cine-cite-confluence",            nom: "UGC Ciné Cité Confluence",               id: "36" },
  { slug: "ugc-cine-cite-part-dieu",             nom: "UGC Ciné Cité Part-Dieu",                id: "58" },
  { slug: "ugc-astoria",                         nom: "UGC Astoria",                            id: "33" },
  // ── Bordeaux ──
  { slug: "ugc-cine-cite-bordeaux-gambetta",     nom: "UGC Ciné Cité Bordeaux Gambetta",         id: "1"  },
  { slug: "ugc-cine-cite-bassins-a-flot",        nom: "UGC Ciné Cité Bassins à Flot",            id: "57" },
  { slug: "ugc-talence",                         nom: "UGC Talence",                            id: "42" },
  // ── Lille / Nord ──
  { slug: "ugc-cine-cite-lille",                 nom: "UGC Ciné Cité Lille",                    id: "25" },
  { slug: "ugc-cine-cite-villeneuve-d-ascq",     nom: "UGC Ciné Cité Villeneuve d'Ascq",         id: "24" },
  // ── Strasbourg ──
  { slug: "ugc-cine-cite-strasbourg",            nom: "UGC Ciné Cité Strasbourg",               id: "30" },
  // ── Nantes / Atlantis ──
  { slug: "ugc-cine-cite-atlantis",              nom: "UGC Ciné Cité Atlantis",                 id: "31" },
  // ── Nancy ──
  { slug: "ugc-nancy-saint-jean",                nom: "UGC Nancy Saint Jean",                   id: "28" },
  { slug: "ugc-cine-cite-ludres",                nom: "UGC Ciné Cité Ludres",                   id: "29" },
  // ── Caen / Normandie ──
  { slug: "ugc-cine-cite-mondeville",            nom: "UGC Ciné Cité Mondeville",               id: "27" },
  // ── Toulouse ──
  { slug: "ugc-montaudran",                      nom: "UGC Montaudran",                         id: "56" },
];

// ── Parser helpers ────────────────────────────────────────

/**
 * Parse une durée ISO 8601 "PT1H38M" → 98 (minutes).
 */
function parseDuration(iso?: string): number | undefined {
  if (!iso) return undefined;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return undefined;
  const h = parseInt(match[1] ?? "0", 10);
  const m = parseInt(match[2] ?? "0", 10);
  return h * 60 + m || undefined;
}

/**
 * Normalise la version : "VOSTF" → VOSTFR, "VO" → VOSTFR (en France VO = VOSTFR), tout le reste → VF.
 */
function parseVersion(raw: string): Version {
  const upper = raw.toUpperCase().replace(/\s+/g, "");
  if (upper.includes("VOST")) return Version.VOSTFR;
  if (upper.startsWith("VO")) return Version.VOSTFR; // En France VO = Version Originale Sous-Titrée
  return Version.VF;
}

/**
 * Extrait le format ("3D", "IMAX", "Dolby Atmos") depuis une chaîne brute.
 * Retourne undefined si aucun format spécial.
 */
function parseFormat(raw: string): string | undefined {
  const upper = raw.toUpperCase();
  if (upper.includes("IMAX")) return "IMAX";
  if (upper.includes("DOLBY")) return "Dolby Atmos";
  if (upper.includes("3D")) return "3D";
  return "2D";
}

/**
 * Construit une Date à partir d'une heure "HH:MM" et de la date du jour.
 * Si l'heure est avant minuit + 4h, on suppose que c'est la séance du lendemain.
 */
function buildDateTime(timeStr: string, baseDate: Date): Date {
  const [hStr, mStr] = timeStr.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);

  const dt = new Date(baseDate);
  dt.setHours(h, m, 0, 0);

  // Séances après minuit (00:xx → 03:xx) comptent pour le lendemain
  if (h < 4) dt.setDate(dt.getDate() + 1);

  return dt;
}

// ── Parsers HTML (Cheerio) ────────────────────────────────

/**
 * Parse la liste des cinémas depuis la réponse AJAX (option list HTML).
 * Retourne un tableau d'{ id, nom }.
 *
 * Structure attendue :
 *   <option value="41">UGC Ciné Cité Les Halles</option>
 */
function parseCinemaList(html: string): Array<{ id: string; nom: string }> {
  const $ = cheerio.load(html);
  const cinemas: Array<{ id: string; nom: string }> = [];

  // Format actuel : <a href="cinema-ugc-cine-cite-les-halles.html" title="UGC Ciné Cité Les Halles">
  $("a[href*='cinema-ugc']").each((_, el) => {
    const href = $(el).attr("href")?.trim() ?? "";
    const nom = $(el).attr("title")?.trim() || $(el).text().trim();
    // Extraire un ID depuis le slug (ex: "cinema-ugc-cine-cite-les-halles.html" → "ugc-cine-cite-les-halles")
    const id = href.replace(/^cinema-/, "").replace(/\.html.*$/, "");
    if (id && nom) {
      cinemas.push({ id, nom });
    }
  });

  // Fallback : ancien format <option value="41">
  if (cinemas.length === 0) {
    $("option").each((_, el) => {
      const id = $(el).attr("value")?.trim();
      const nom = $(el).text().trim();
      if (id && id !== "" && nom) {
        cinemas.push({ id, nom });
      }
    });
  }

  return cinemas;
}

/**
 * Parse la liste des films depuis la page programme d'un cinéma.
 * Retourne les IDs et slugs des films.
 *
 * Les liens ont la forme :
 *   href="/film_super_mario_galaxy_le_film_17706.html?cinemaId=41"
 */
function parseFilmLinks(
  html: string,
  cinemaId: string
): Array<{ filmId: string; href: string }> {
  const $ = cheerio.load(html);
  const films: Array<{ filmId: string; href: string }> = [];
  const seen = new Set<string>();

  // Sélectionne tous les liens vers une page film contenant un cinemaId
  // puis vérifie l'égalité exacte (évite cinemaId=4 de matcher cinemaId=41)
  $('a[href*="film_"][href*="cinemaId"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";

    // Vérification exacte du cinemaId (pas de "contains" approximatif)
    const linkedCinemaId = href.match(/[?&]cinemaId=(\d+)/)?.[1];
    if (linkedCinemaId !== cinemaId) return;

    // Extrait l'ID numérique : film_titre_17706.html → "17706"
    // Accepte 4 à 7 chiffres pour couvrir les futures IDs
    const match = href.match(/[_-](\d{4,7})\.html/);
    if (match) {
      const filmId = match[1];
      if (!seen.has(filmId)) {
        seen.add(filmId);
        films.push({ filmId, href });
      }
    }
  });

  return films.slice(0, MAX_FILMS_PER_CINEMA);
}

/**
 * Parse les métadonnées d'un film depuis la page film (JSON-LD).
 *
 * Structure attendue dans <script type="application/ld+json"> :
 * {
 *   "@type": "Movie",
 *   "name": "...",
 *   "description": "...",
 *   "duration": "PT1H38M",
 *   "genre": ["Action", "Aventure"],
 *   "director": [{ "name": "..." }],
 *   "image": "https://..."
 * }
 */
function parseFilmMetadata(html: string): Partial<ScrapedFilm> {
  const $ = cheerio.load(html);
  const meta: Partial<ScrapedFilm> = {};

  // 1. JSON-LD
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() ?? "{}");
      if (data["@type"] === "Movie") {
        meta.titre = data.name ?? meta.titre;
        meta.synopsis = data.description ?? meta.synopsis;
        meta.duree = parseDuration(data.duration);
        meta.affiche = data.image ?? meta.affiche;

        // Genres : tableau ou string
        if (Array.isArray(data.genre)) meta.genres = data.genre;
        else if (typeof data.genre === "string") meta.genres = [data.genre];

        // Réalisateur
        if (Array.isArray(data.director) && data.director.length > 0) {
          meta.realisateur = data.director[0]?.name;
        } else if (typeof data.director?.name === "string") {
          meta.realisateur = data.director.name;
        }
      }
    } catch {
      // JSON malformé, on ignore
    }
  });

  // 2. Fallback sur les balises HTML si JSON-LD incomplet
  if (!meta.titre) {
    meta.titre =
      $("h1").first().text().trim() ||
      $('meta[property="og:title"]').attr("content") ||
      "";
  }
  if (!meta.affiche) {
    meta.affiche = $('meta[property="og:image"]').attr("content");
  }

  return meta;
}

/**
 * Parse les séances depuis la réponse POST getShowingsByFilm.action.
 *
 * La réponse contient les séances de TOUS les cinémas de la région.
 * On filtre par #bloc-showing-cinema-{cinemaId} pour n'extraire que
 * les séances du cinéma demandé.
 *
 * Structure HTML confirmée :
 *   <div id="bloc-showing-cinema-10" class="band component--cinema-list-item">
 *     ...
 *     <div class="screening-time-start">09:10</div>
 *     <div class="screening-time-start">14:30</div>
 *     ...
 *   </div>
 *
 * @param html     - HTML brut retourné par le POST
 * @param cinemaId - ID numérique du cinéma (ex: "10")
 * @param dayStr   - Date au format "YYYY-MM-DD" (ex: "2026-05-11")
 */
function parseSeancesFromPost(
  html: string,
  cinemaId: string,
  dayStr: string
): ScrapedSeance[] {
  const $ = cheerio.load(html);
  const seances: ScrapedSeance[] = [];
  const seen = new Set<string>();

  // ── 1. Trouver le bloc spécifique à ce cinéma ──────────────────────
  const cinemaBlock = $(`#bloc-showing-cinema-${cinemaId}`);
  if (!cinemaBlock.length) {
    // Ce cinéma ne projette pas ce film ce jour-là (bloc absent)
    return [];
  }

  // ── 2. Date de base depuis le paramètre "day" (YYYY-MM-DD) ─────────
  const [y, mo, d] = dayStr.split("-").map(Number);
  const baseDate = new Date(y, mo - 1, d);

  // ── 3. Détecter la version dominante pour chaque section ───────────
  //
  // UGC regroupe les séances par version (VF, VOSTFR…) dans des blocs séparés.
  // On parcourt le DOM du bloc cinéma et on suit la "version courante"
  // au fur et à mesure qu'on rencontre des marqueurs de version.
  //
  // Pour chaque .screening-time-start, on remonte jusqu'à trouver un
  // ancêtre/frère qui contient "VF" / "VOSTFR" / "VOST".

  cinemaBlock.find(".screening-time-start").each((_, el) => {
    const timeStr = $(el).text().trim();
    // Format attendu : "HH:MM" ou "H:MM"
    if (!/^\d{1,2}:\d{2}$/.test(timeStr)) return;

    const [hStr, mStr] = timeStr.split(":");
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    if (h > 23 || m > 59) return;

    const dt = new Date(baseDate);
    dt.setHours(h, m, 0, 0);
    // Séances de minuit à 4h sont en réalité le lendemain
    if (h < 4) dt.setDate(dt.getDate() + 1);

    // ── Détection de version : remonter les ancêtres ────────────────
    // On cherche le texte "VF" / "VOSTFR" / "VOST" dans les ancêtres
    // proches (jusqu'au bloc cinéma).
    let version: Version = Version.VF; // valeur par défaut
    let $node = $(el).parent();
    let depth = 0;

    while ($node.length && depth < 8) {
      // Texte propre de ce nœud (sans les enfants pour éviter le bruit)
      const ownText = $node.clone().children().remove().end().text()
        .toUpperCase().replace(/\s+/g, " ").trim();

      if (ownText.includes("VOSTFR") || ownText.includes("VOSTF") ||
          ownText.includes("VOST") || ownText.includes("SOUS-TITR")) {
        version = Version.VOSTFR;
        break;
      }
      if (/\bVO\b/.test(ownText) && !ownText.includes("VF")) {
        version = Version.VOSTFR;
        break;
      }
      if (ownText.includes("VF")) {
        version = Version.VF;
        break;
      }

      // Vérifier aussi le texte complet du nœud (enfants inclus) si court
      const fullText = $node.text().toUpperCase().replace(/\s+/g, " ").trim();
      if (fullText.length < 200) {
        if (fullText.includes("VOSTFR") || fullText.includes("VOSTF") || fullText.includes("VOST")) {
          version = Version.VOSTFR;
          break;
        }
        if (/\bVF\b/.test(fullText) && !fullText.includes("VOSTFR")) {
          version = Version.VF;
          break;
        }
      }

      // Arrêter au bloc cinéma
      if ($node.attr("id") === `bloc-showing-cinema-${cinemaId}`) break;

      $node = $node.parent();
      depth++;
    }

    // ── Détection du format ─────────────────────────────────────────
    // On cherche IMAX / Dolby / 3D dans l'ancêtre le plus proche qui a du contexte
    let format = "2D";
    const contextText = $(el).closest("[class]").text().toUpperCase();
    if (contextText.includes("IMAX")) format = "IMAX";
    else if (contextText.includes("DOLBY")) format = "Dolby Atmos";
    else if (/\b3D\b/.test(contextText)) format = "3D";

    // ── Salle ────────────────────────────────────────────────────────
    const salleMatch = contextText.match(/SALLE\s+(\w+)/);
    const salleNom = salleMatch ? `Salle ${salleMatch[1]}` : undefined;

    // ── Déduplification ──────────────────────────────────────────────
    const dedupeKey = `${dt.getTime()}|${version}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    seances.push({ dateHeure: dt, version, format, salleNom, prix: undefined });
  });

  return seances;
}

// ── Scraper principal ─────────────────────────────────────

export class UgcScraper extends BaseScraper {
  readonly name = "ugc";

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  // ── Cycle de vie navigateur ────────────────────────────

  private async launchBrowser(): Promise<void> {
    this.log("Lancement du navigateur Playwright…");
    this.browser = await chromium.launch({
      headless: true,
      args: CHROMIUM_ARGS,
    });
    this.context = await this.browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/124.0.0.0 Safari/537.36",
      locale: "fr-FR",
      timezoneId: "Europe/Paris",
    });
  }

  private async closeBrowser(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
    this.browser = null;
    this.context = null;
  }

  private async newPage(): Promise<Page> {
    if (!this.context) throw new Error("Contexte navigateur non initialisé");
    const page = await this.context.newPage();

    // Bloquer les ressources inutiles (images, fonts, trackers)
    // pour accélérer le scraping
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (["image", "font", "media", "stylesheet"].includes(type)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    return page;
  }

  // ── Requête HTTP via Playwright (avec cookies de session) ──

  /**
   * Effectue une requête GET depuis le contexte Playwright
   * (conserve les cookies de session obtenus lors du warmup).
   */
  private async fetchHtml(url: string): Promise<string> {
    const page = await this.newPage();
    try {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });

      if (!response) throw new Error(`Pas de réponse pour ${url}`);

      // 429 = rate-limit : on attend avant de relancer (withRetry s'en chargera)
      if (response.status() === 429) {
        const retryAfterHeader = response.headers()["retry-after"];
        const waitMs = retryAfterHeader
          ? parseInt(retryAfterHeader, 10) * 1_000
          : 60_000; // 60 s par défaut si le header est absent
        this.log(
          `🚦 429 Too Many Requests — pause ${waitMs / 1_000}s avant retry…`,
          "warn"
        );
        await this.sleep(waitMs);
        throw new Error(`HTTP 429 sur ${url}`);
      }

      if (!response.ok()) {
        throw new Error(`HTTP ${response.status()} sur ${url}`);
      }

      return await page.content();
    } finally {
      await page.close();
    }
  }

  // ── Warmup : visite la page d'accueil pour obtenir les cookies ──

  private async warmup(): Promise<void> {
    this.log("Warmup — acquisition des cookies de session…");
    const page = await this.newPage();
    try {
      await page.goto(BASE_URL, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      // Fermer le bandeau cookies s'il est présent
      try {
        await page.click("#popin_tc_privacy_button_2", { timeout: 3_000 });
        this.log("Bandeau cookies accepté");
      } catch {
        // Pas de bandeau, on continue
      }
    } finally {
      await page.close();
    }
  }

  // ── Extraction fiable du cinemaId numérique ───────────

  /**
   * Visite la page d'un cinéma avec chargement JS complet et extrait
   * son cinemaId numérique via plusieurs stratégies :
   *   1. Contexte JavaScript (window.cinemaId, data-attributes…)
   *   2. Patterns regex dans le HTML statique (ordre de priorité)
   * Utilise waitUntil:"load" pour laisser le JS s'exécuter entièrement.
   */
  private async fetchCinemaNumericId(
    pageUrl: string,
    nom: string
  ): Promise<string | null> {
    const page = await this.newPage();
    try {
      const response = await page.goto(pageUrl, {
        waitUntil: "load",
        timeout: 45_000,
      });
      if (!response || !response.ok()) {
        this.log(`  ⚠️ HTTP ${response?.status()} pour ${nom}`, "warn");
        return null;
      }

      const html = await page.content();

      // ── Stratégie 1 : contexte JavaScript (couvre les cinemaId injectés par JS)
      // globalThis === window en navigateur, reconnu par TypeScript sans lib DOM
      try {
        const jsId: string | null = await page.evaluate(() => {
          const w = globalThis as any; // eslint-disable-line @typescript-eslint/no-explicit-any
          const raw =
            w.cinemaId          ??
            w.CINEMA_ID         ??
            w.__cinemaId__      ??
            w.App?.cinemaId     ??
            w.config?.cinemaId  ??
            w.ugcConfig?.cinemaId ?? null;

          if (raw !== null && raw !== undefined) return String(raw);

          // Attributs data-* sur les éléments du DOM (via globalThis.document)
          const doc = w.document as any;
          const el =
            doc?.querySelector("[data-cinema-id]") ??
            doc?.querySelector("[data-cid]")       ??
            doc?.querySelector("[data-id]");
          return el
            ? (el.getAttribute("data-cinema-id") ??
               el.getAttribute("data-cid")       ??
               el.getAttribute("data-id"))
            : null;
        });
        if (jsId && /^\d+$/.test(jsId)) {
          this.log(`  ✓ ${nom} → id=${jsId} (via JS)`);
          return jsId;
        }
      } catch { /* contexte JS inaccessible, on continue */ }

      // ── Stratégie 2 : patterns dans le HTML (ordre de confiance décroissant)
      const patterns: RegExp[] = [
        /getShowingsForCinemaPage\.action\?cinemaId=(\d+)/,
        /showingsCinemaAjaxAction[^"']*cinemaId=(\d+)/,
        /data-cinema(?:-id)?="(\d+)"/,
        /"cinemaId"\s*[=:]\s*"?(\d+)"?/,
        /\bcinemaId\s*[:=]\s*(\d+)/,
        /[?&;]cinemaId=(\d+)/,
      ];

      for (const pattern of patterns) {
        const m = html.match(pattern);
        if (m?.[1] && /^\d+$/.test(m[1])) {
          this.log(`  ✓ ${nom} → id=${m[1]} (via HTML)`);
          return m[1];
        }
      }

      this.log(`  ⚠️ Aucun cinemaId trouvé pour ${nom} (${pageUrl})`, "warn");
      return null;
    } finally {
      await page.close();
    }
  }

  // ── Étape 1 : liste des cinémas Paris ─────────────────

  private async fetchCinemaIds(): Promise<Array<{ id: string; nom: string; slug: string }>> {
    const allCinemas: Array<{ id: string; nom: string; slug: string }> = [];
    this.log(`  → ${PARIS_CINEMA_SLUGS.length} cinémas Paris à résoudre`);

    for (const { slug, nom, id: hardcodedId } of PARIS_CINEMA_SLUGS) {
      try {
        // Utilise l'ID hardcodé si disponible (évite une visite de page par cinéma)
        if (hardcodedId) {
          allCinemas.push({ id: hardcodedId, nom, slug });
          this.log(`  ✓ ${nom} → id=${hardcodedId} (hardcodé)`);
          continue;
        }

        const pageUrl = `${BASE_URL}/cinema-${slug}.html`;
        const numericId = await this.withRetry(
          () => this.fetchCinemaNumericId(pageUrl, nom),
          `ID cinéma ${nom}`
        );
        if (numericId) {
          allCinemas.push({ id: numericId, nom, slug });
          this.log(`  ✓ ${nom} → id=${numericId}`);
        } else {
          this.log(`  ⚠️ ID introuvable pour ${nom}`, "warn");
        }
        await this.politeDelay();
      } catch (err) {
        this.log(`⚠️  Impossible de récupérer l'ID de ${nom} : ${err}`, "warn");
      }
    }

    return allCinemas;
  }

  // ── Étape 2 : films d'un cinéma ──────────────────────

  private async fetchFilmsForCinema(
    cinemaId: string
  ): Promise<Array<{ filmId: string; href: string }>> {
    const url =
      `${BASE_URL}/showingsCinemaAjaxAction!getShowingsForCinemaPage.action` +
      `?cinemaId=${cinemaId}`;

    const html = await this.withRetry(
      () => this.fetchHtml(url),
      `films cinéma ${cinemaId}`
    );

    return parseFilmLinks(html, cinemaId);
  }

  // ── Étape 3 : métadonnées film ────────────────────────

  private async fetchFilmMetadata(
    href: string
  ): Promise<Partial<ScrapedFilm>> {
    // Supprimer les query params (?cinemaId=XX) pour obtenir la vraie page film
    const cleanHref = href.split("?")[0];
    const url = cleanHref.startsWith("http")
      ? cleanHref
      : `${BASE_URL}/${cleanHref.replace(/^\//, "")}`;
    const html = await this.withRetry(
      () => this.fetchHtml(url),
      `métadonnées film ${cleanHref}`
    );
    const meta = parseFilmMetadata(html);
    if (!meta.titre) {
      // Log diagnostic : taille HTML + début de page pour identifier le problème
      const preview = html.replace(/\s+/g, " ").slice(0, 200);
      this.log(
        `  ⚠️ Titre introuvable — ${url} (${html.length} octets)\n     HTML: ${preview}`,
        "warn"
      );
    }
    return meta;
  }

  // ── Étape 4 : séances d'un film dans un cinéma ───────

  /**
   * Récupère les séances d'un film dans un cinéma UGC via l'API POST.
   *
   * Stratégie :
   *   1. Naviguer vers la page film+cinéma pour capturer le POST automatique
   *      qui révèle le regionId ET les séances du premier jour.
   *   2. Appeler getDaysByFilm pour obtenir tous les jours disponibles.
   *   3. POSTer getShowingsByFilm pour chaque jour restant.
   *   4. Parser chaque réponse en filtrant sur #bloc-showing-cinema-{id}.
   *
   * @param filmId   - ID numérique du film côté UGC (ex: "17538")
   * @param cinemaId - ID numérique du cinéma (ex: "10")
   * @param filmHref - href de la page film (ex: "/film_titre_17538.html?cinemaId=10")
   */
  private async fetchSeances(
    filmId: string,
    cinemaId: string,
    filmHref?: string
  ): Promise<ScrapedSeance[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + 30);

    const page = await this.newPage();
    const allSeances: ScrapedSeance[] = [];
    let regionId = "3000"; // valeur par défaut (Paris/IdF)
    const autoPostHtmls: Map<string, string> = new Map();

    try {
      // ── A. Intercepter les POST automatiques pour capturer regionId ──
      await page.route("**/*getShowingsByFilm*", async (route) => {
        const req = route.request();
        if (req.method() !== "POST") { await route.continue(); return; }

        const body = req.postData() ?? "";
        const rIdMatch = body.match(/regionId=([^&]+)/);
        if (rIdMatch?.[1]) regionId = rIdMatch[1];

        const resp = await route.fetch();
        const html = await resp.text();
        const dayMatch = body.match(/day=([^&]+)/);
        if (dayMatch?.[1]) autoPostHtmls.set(dayMatch[1], html);

        await route.fulfill({ response: resp, body: html });
      });

      // ── B. Naviguer vers la page film du cinéma ──────────────────────
      // Cela déclenche un POST automatique (regionId + séances du 1er jour).
      if (filmHref) {
        const cleanHref = filmHref.split("?")[0];
        const filmPageUrl = cleanHref.startsWith("http")
          ? `${cleanHref}?cinemaId=${cinemaId}`
          : `${BASE_URL}/${cleanHref.replace(/^\//, "")}?cinemaId=${cinemaId}`;
        try {
          await page.goto(filmPageUrl, { waitUntil: "networkidle", timeout: 45_000 });
        } catch (err) {
          this.log(`    ⚠️ Timeout page film ${filmId}: ${err}`, "warn");
          // Continuer quand même — on a peut-être capté le POST avant le timeout
        }
      } else {
        // Pas de href : aller sur la page principale pour obtenir les cookies
        await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
      }

      this.log(`    Film ${filmId} cinéma ${cinemaId}: regionId=${regionId}, auto-POSTs=${autoPostHtmls.size}`);

      // ── C. Récupérer tous les jours disponibles ────────────────────
      let days: string[] = [];
      try {
        const daysHtml = await page.evaluate(async (fId: string): Promise<string> => {
          const r = await fetch(
            `/showingsFilmAjaxAction!getDaysByFilm.action?filmId=${fId}&day=`,
            { headers: { "X-Requested-With": "XMLHttpRequest" } }
          );
          return r.text();
        }, filmId);

        days = [
          ...new Set(
            [...daysHtml.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map((m) => m[1])
          ),
        ]
          .sort()
          .filter((d) => {
            const dt = new Date(d);
            return dt >= today && dt <= horizon;
          });
      } catch (err) {
        this.log(`    ⚠️ getDaysByFilm film ${filmId}: ${err}`, "warn");
      }

      // Fallback : si aucun jour trouvé, utiliser aujourd'hui + 7 jours
      if (days.length === 0) {
        for (let i = 0; i < 7; i++) {
          const d = new Date(today);
          d.setDate(d.getDate() + i);
          days.push(d.toISOString().slice(0, 10));
        }
      }

      this.log(`    Film ${filmId}: ${days.length} jour(s) — ${days.join(", ")}`);

      // ── D. Traiter les réponses auto-capturées (1er(s) jour(s)) ────
      for (const [day, html] of autoPostHtmls.entries()) {
        const dayDate = new Date(day);
        if (dayDate < today || dayDate > horizon) continue;
        const daySeances = parseSeancesFromPost(html, cinemaId, day);
        allSeances.push(...daySeances);
        this.log(`    Jour ${day} (auto): ${daySeances.length} séance(s)`);
      }

      // ── E. POSTer manuellement pour les jours restants ─────────────
      const processedDays = new Set(autoPostHtmls.keys());

      for (const day of days) {
        if (processedDays.has(day)) continue;
        await this.sleep(200); // délai poli entre requêtes

        try {
          const postBody = `filmId=${filmId}&day=${day}&regionId=${regionId}&defaultRegionId=1&__multiselect_versions=`;
          const html = await page.evaluate(async (body: string): Promise<string> => {
            const resp = await fetch(
              "/showingsFilmAjaxAction!getShowingsByFilm.action",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                  "X-Requested-With": "XMLHttpRequest",
                },
                body,
              }
            );
            return resp.text();
          }, postBody);

          const daySeances = parseSeancesFromPost(html, cinemaId, day);
          allSeances.push(...daySeances);
          this.log(`    Jour ${day} (POST): ${daySeances.length} séance(s)`);
        } catch (err) {
          this.log(`    ⚠️ POST séances film ${filmId} jour ${day}: ${err}`, "warn");
        }
      }

    } finally {
      await page.close();
    }

    return allSeances;
  }

  // ── Étape 5 : infos détaillées d'un cinéma ────────────

  /**
   * Visite la page du cinéma pour extraire adresse, CP, coordonnées.
   * Utilise le JSON-LD si disponible.
   */
  private async fetchCinemaDetails(
    cinemaId: string,
    nomFallback: string,
    slug?: string
  ): Promise<Partial<ScrapedCinema>> {
    const url = slug
      ? `${BASE_URL}/cinema-${slug}.html`
      : `${BASE_URL}/cinema.html?id=${cinemaId}`;
    try {
      const html = await this.withRetry(
        () => this.fetchHtml(url),
        `détails cinéma ${cinemaId}`
      );
      const $ = cheerio.load(html);

      let adresse = "";
      let ville = "Paris";
      let codePostal = "75000";
      let latitude: number | undefined;
      let longitude: number | undefined;

      // JSON-LD de type MovieTheater
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const data = JSON.parse($(el).html() ?? "{}");
          if (
            data["@type"] === "MovieTheater" ||
            data["@type"] === "LocalBusiness"
          ) {
            const addr = data.address ?? {};
            adresse = addr.streetAddress ?? adresse;
            ville = addr.addressLocality ?? ville;
            codePostal = addr.postalCode ?? codePostal;
            latitude = data.geo?.latitude;
            longitude = data.geo?.longitude;
          }
        } catch {
          /* ignore */
        }
      });

      // Fallback HTML si JSON-LD absent
      if (!adresse) {
        adresse =
          $(".cinema-address, .address, [itemprop='streetAddress']")
            .first()
            .text()
            .trim() || "";
      }

      // ── Extraction ville/CP depuis l'adresse ────────────────────────
      // Quand le JSON-LD ne fournit pas addressLocality, on parse l'adresse.
      // Pattern UGC typique : "Place Marcel Bouilloux-Lafont 31400 TOULOUSE"
      //                    ou : "75001 PARIS"
      if ((!ville || ville === "Paris") && adresse) {
        // Cherche un code postal 5 chiffres suivi du nom de ville
        const cpMatch = adresse.match(/\b(\d{5})\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s\-']{1,40}?)(?:\s+(?:CEDEX\s*\d*|cedex\s*\d*))?(?:\s*$|(?=\s*\n))/i);
        if (cpMatch) {
          const cp = cpMatch[1];
          const rawVille = cpMatch[2].trim().replace(/\s+(?:CEDEX\s*\d*)$/i, "").trim();
          codePostal = cp;
          // Capitalisation : "TOULOUSE" → "Toulouse", "AIX-EN-PROVENCE" → "Aix-En-Provence"
          ville = rawVille
            .split(/(\s+|(?<=-))/)
            .map((w) => (w.match(/[A-Za-zÀ-ÿ]/) ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
            .join("");
        }
      }

      // Si le JSON-LD a fourni un codePostal mais pas de ville,
      // essayer de déduire la ville depuis le CP
      if ((!ville || ville === "Paris") && codePostal && codePostal !== "75000") {
        // Mapping CP → ville pour les cinémas UGC connus
        const CP_VILLES: Record<string, string> = {
          "33": "Bordeaux",
          "69": "Lyon",
          "59": "Lille",
          "67": "Strasbourg",
          "44": "Saint-Herblain",
          "54": "Nancy",
          "14": "Mondeville",
          "31": "Toulouse",
          "92": "Issy-les-Moulineaux",
          "93": "Noisy-le-Grand",
          "94": "Créteil",
          "95": "Cergy",
          "78": "Plaisir",
          "77": "Marne-la-Vallée",
        };
        const prefix = codePostal.slice(0, 2);
        if (CP_VILLES[prefix]) ville = CP_VILLES[prefix];
      }

      return { adresse, ville, codePostal, latitude, longitude };
    } catch (err) {
      this.log(
        `Impossible de récupérer les détails du cinéma ${cinemaId} : ${err}`,
        "warn"
      );
      return {
        adresse: "",
        ville: "Paris",
        codePostal: "75000",
      };
    }
  }

  // ── Orchestration principale ───────────────────────────

  async scrape(): Promise<ScraperResult> {
    const result = this.makeResult();

    try {
      await this.launchBrowser();
      await this.warmup();

      // 1. Liste des cinémas
      this.log("📍 Récupération des cinémas…");
      let cinemaList: Array<{ id: string; nom: string; slug: string }>;
      try {
        cinemaList = await this.fetchCinemaIds();
      } catch (err) {
        this.addError(result, `Impossible de récupérer la liste des cinémas : ${err}`);
        return result;
      }

      this.log(`🎪 ${cinemaList.length} cinémas à scraper`);

      // 2. Pour chaque cinéma
      for (const { id: cinemaId, nom: cinemaName, slug } of cinemaList) {
        this.log(`\n▶ Cinéma : ${cinemaName} (id=${cinemaId})`);
        await this.politeDelay();

        // Infos du cinéma
        const details = await this.fetchCinemaDetails(cinemaId, cinemaName, slug);

        const cinema: ScrapedCinema = {
          sourceId: cinemaId,
          nom: cinemaName,
          adresse: details.adresse ?? "",
          ville: details.ville ?? "Paris",
          codePostal: details.codePostal ?? "75000",
          latitude: details.latitude,
          longitude: details.longitude,
          siteWeb: BASE_URL,
          films: [],
        };

        // Films de ce cinéma
        let filmLinks: Array<{ filmId: string; href: string }>;
        try {
          filmLinks = await this.fetchFilmsForCinema(cinemaId);
        } catch (err) {
          this.addError(
            result,
            `Cinéma ${cinemaName} — impossible de lister les films : ${err}`
          );
          result.cinemas.push(cinema);
          continue;
        }

        this.log(`  🎬 ${filmLinks.length} films trouvés`);

        // Pour chaque film
        for (const { filmId, href } of filmLinks) {
          await this.politeDelay();

          let filmMeta: Partial<ScrapedFilm> = {};
          let seances: ScrapedSeance[] = [];

          try {
            filmMeta = await this.fetchFilmMetadata(href);
          } catch (err) {
            this.addError(
              result,
              `Film ${filmId} @ ${cinemaName} — métadonnées introuvables : ${err}`
            );
          }

          try {
            seances = await this.fetchSeances(filmId, cinemaId, href);
          } catch (err) {
            this.addError(
              result,
              `Film ${filmId} @ ${cinemaName} — séances introuvables : ${err}`
            );
          }

          if (!filmMeta.titre) {
            this.log(`  ⏭  Film ${filmId} ignoré (titre introuvable)`, "warn");
            continue;
          }

          if (seances.length === 0) {
            this.log(`  ⏭  Film "${filmMeta.titre}" ignoré (0 séances)`, "warn");
            continue;
          }

          const film: ScrapedFilm = {
            titre: filmMeta.titre,
            titreOriginal: filmMeta.titreOriginal,
            synopsis: filmMeta.synopsis,
            affiche: filmMeta.affiche,
            duree: filmMeta.duree,
            genres: filmMeta.genres ?? [],
            realisateur: filmMeta.realisateur,
            sourceId: filmId,
          };

          const cinemaFilm: ScrapedCinemaFilm = { film, seances };
          cinema.films.push(cinemaFilm);

          this.log(
            `  ✓ "${film.titre}" — ${seances.length} séance(s)`
          );
        }

        result.cinemas.push(cinema);
        this.log(`  → Cinéma terminé (${cinema.films.length} films retenus)`);
      }
    } catch (err) {
      this.addError(result, `Erreur inattendue : ${err}`);
    } finally {
      await this.closeBrowser();
    }

    this.log(
      `\n✅ Scraping terminé — ` +
        `${result.cinemas.length} cinémas, ` +
        `${result.cinemas.reduce((acc, c) => acc + c.films.length, 0)} films, ` +
        `${result.errors.length} erreur(s)`
    );

    return result;
  }
}
