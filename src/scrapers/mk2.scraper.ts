// ─────────────────────────────────────────────────────────
//  Scraper MK2 — mk2.com  (refonte complète)
//
//  Stratégie (mêmes principes que le scraper UGC amélioré) :
//    1. Fetch HTTP direct + extraction __NEXT_DATA__ (Next.js SSR)
//    2. Pour J+1…J+29 : _next/data/{buildId}/salle/{slug}.json
//    3. Fallback JSON-LD ScreeningEvent (cheerio)
//    4. Fallback Playwright si les deux premiers échouent
//
//  Améliorations vs v1 :
//    - HTTP direct → pas de browser pour le cas nominal
//    - Retry 429/503, back-off exponentiel
//    - Liste enrichie (10 salles MK2)
//    - Détection version/format améliorée
//    - Timezone Europe/Paris stricte
// ─────────────────────────────────────────────────────────

import { chromium, Browser, BrowserContext } from "playwright";
import * as cheerio from "cheerio";
import { Version } from "@prisma/client";
import { BaseScraper } from "./base.scraper.js";
import { CHROMIUM_ARGS } from "./chromium-args.js";
import {
  ScraperResult,
  ScrapedCinema,
  ScrapedFilm,
  ScrapedSeance,
  ScrapedCinemaFilm,
} from "./types.js";

const BASE_URL  = "https://www.mk2.com";
const DAYS_AHEAD = 30;

const HEADERS = {
  "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control":   "no-cache",
};

const JSON_HEADERS = {
  ...HEADERS,
  "Accept": "application/json, */*;q=0.8",
  "x-nextjs-data": "1",
};

// ── Cinémas MK2 ───────────────────────────────────────────
// Source : https://www.mk2.com/sitemap.xml (slugs vérifiés)
// Le site utilise /salle/{slug} depuis 2024 (ancien : /nos-salles/)
// Bastille, Odéon et Quai de Seine/Loire ont été fusionnés en une seule page

const MK2_CINEMAS = [
  { slug: "mk2-bibliotheque",                       nom: "MK2 Bibliothèque",        adresse: "128-162 Av de France",    ville: "Paris", cp: "75013", lat: 48.8318, lng: 2.3799 },
  { slug: "mk2-bastille-beaumarchais-fg-st-antoine", nom: "MK2 Bastille",            adresse: "4 Bd Beaumarchais",       ville: "Paris", cp: "75011", lat: 48.8533, lng: 2.3695 },
  { slug: "mk2-beaubourg",                           nom: "MK2 Beaubourg",           adresse: "50 Rue Rambuteau",        ville: "Paris", cp: "75003", lat: 48.8609, lng: 2.3518 },
  { slug: "mk2-nation",                              nom: "MK2 Nation",              adresse: "133 Bd Diderot",          ville: "Paris", cp: "75012", lat: 48.8487, lng: 2.3943 },
  { slug: "mk2-odeon-st-germain-st-michel",          nom: "MK2 Odéon",               adresse: "113 Bd Saint-Germain",    ville: "Paris", cp: "75006", lat: 48.8511, lng: 2.3414 },
  { slug: "mk2-parnasse",                            nom: "MK2 Parnasse",            adresse: "94 Rue du Maine",         ville: "Paris", cp: "75014", lat: 48.8381, lng: 2.3233 },
  { slug: "mk2-quai-seine-quai-loire",               nom: "MK2 Quai de Seine/Loire", adresse: "14 Quai de la Seine",     ville: "Paris", cp: "75019", lat: 48.8836, lng: 2.3644 },
  { slug: "mk2-gambetta",                            nom: "MK2 Gambetta",            adresse: "6 Rue Belgrand",          ville: "Paris", cp: "75020", lat: 48.8655, lng: 2.3988 },
];

// ── Helpers ───────────────────────────────────────────────

function parseVersion(raw?: string): Version {
  if (!raw) return Version.VF;
  const u = raw.toUpperCase().replace(/[\s\-_]/g, "");
  if (u.includes("VOST") || u.includes("SUBTITL") || u.includes("SOUSTITR")) return Version.VOSTFR;
  if (u === "VO" || u.startsWith("VO") || u === "ORIGINAL" || u.includes("ORIGIN")) return Version.VO;
  return Version.VF;
}

function parseFormat(raw?: string): string {
  if (!raw) return "2D";
  const u = raw.toUpperCase();
  if (u.includes("IMAX"))   return "IMAX";
  if (u.includes("DOLBY"))  return "Dolby Atmos";
  if (u.includes("3D"))     return "3D";
  if (u.includes("LASER"))  return "Laser";
  return "2D";
}

function toDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url: string, opts: RequestInit, retries = 3): Promise<Response | null> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(15_000) });
      if (res.status === 429 || res.status === 503) {
        await sleep((i + 1) * 2000);
        continue;
      }
      return res;
    } catch {
      if (i === retries - 1) return null;
      await sleep(1000 * (i + 1));
    }
  }
  return null;
}

/** Extracteur récursif robuste : remonte toute séance trouvée dans l'arbre JSON */
function extractShowtimesDeep(obj: unknown, depth = 0): Array<Record<string, unknown>> {
  if (depth > 10 || !obj || typeof obj !== "object") return [];
  const results: Array<Record<string, unknown>> = [];
  if (Array.isArray(obj)) {
    for (const item of obj) results.push(...extractShowtimesDeep(item, depth + 1));
    return results;
  }
  const o = obj as Record<string, unknown>;
  const hasDate =
    (typeof o["startDate"]  === "string" && o["startDate"].length  > 5) ||
    (typeof o["startsAt"]   === "string" && o["startsAt"].length   > 5) ||
    (typeof o["datetime"]   === "string" && o["datetime"].length   > 5) ||
    (typeof o["dateHeure"]  === "string" && o["dateHeure"].length  > 5) ||
    (typeof o["showTime"]   === "string" && o["showTime"].length   > 5);   // MK2 : capital T
  if (hasDate) results.push(o);
  for (const key of ["showtimes", "screenings", "sessions", "seances", "data", "results",
                      "items", "movies", "films", "program", "programme", "schedule",
                      "screeningEvents", "showings"]) {
    if (Array.isArray(o[key])) {
      for (const item of o[key] as unknown[]) results.push(...extractShowtimesDeep(item, depth + 1));
    }
  }
  for (const val of Object.values(o)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      results.push(...extractShowtimesDeep(val, depth + 1));
    }
  }
  return results;
}

// ── Extraction directe MK2 ─────────────────────────────────
// Structure réelle : pageProps.cinemaComplexWithSession
//   .sessionsByType[].sessionsByFilmAndCinema[]
//     .film   { id, title, graphicUrl, runTime (minutes), genres[], … }
//     .sessions[] { id, showTime: "2026-05-25T20:45:00", attributes[{ id, … }], … }
//
// Les attributs de version ont un id commençant par "VS" (ex: "VS_VO", "VS_VOST").
// Les attributs de format ont isUsedForConcepts === true (ex: "Dolby Atmos", "3D").

interface Mk2Session {
  id: string;
  showTime: string;
  attributes?: Array<{
    id?: string;
    shortName?: string;   // "VF", "VO", "STFR"
    description?: string; // "Version Française", "Version Originale", "2D"
    isUsedForConcepts?: boolean;
  }>;
  screenName?: string;
}

interface Mk2FilmGroup {
  film: {
    id?: string;
    title?: string;
    originalTitle?: string;
    graphicUrl?: string;
    synopsis?: string;
    runTime?: number;        // minutes
    genres?: Array<{ name?: string }>;
    directors?: Array<{ firstName?: string; lastName?: string; name?: string }>;
  };
  sessions: Mk2Session[];
}

function extractMk2Sessions(pageProps: unknown): Mk2FilmGroup[] {
  if (!pageProps || typeof pageProps !== "object") return [];
  const pp = pageProps as Record<string, unknown>;

  // Chemin principal
  const cwSession = pp["cinemaComplexWithSession"] as Record<string, unknown> | undefined;
  if (!cwSession) return [];

  const sessionsByType = cwSession["sessionsByType"] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(sessionsByType)) return [];

  const groups: Mk2FilmGroup[] = [];

  for (const type of sessionsByType) {
    const byFilm = type["sessionsByFilmAndCinema"] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(byFilm)) continue;

    for (const entry of byFilm) {
      const film = entry["film"] as Mk2FilmGroup["film"] | undefined;
      const sessions = entry["sessions"] as Mk2Session[] | undefined;
      if (!film?.title || !Array.isArray(sessions) || sessions.length === 0) continue;

      // Dédoublonner par film.id (même film peut apparaître dans plusieurs types)
      const existing = groups.find(g => g.film.id === film.id && g.film.title === film.title);
      if (existing) {
        for (const s of sessions) {
          if (!existing.sessions.find(es => es.id === s.id)) existing.sessions.push(s);
        }
      } else {
        groups.push({ film, sessions: [...sessions] });
      }
    }
  }

  return groups;
}

function mk2SessionToSeance(session: Mk2Session): { dateHeure: Date; version: Version; format: string } | null {
  if (!session.showTime) return null;
  const dt = new Date(session.showTime);
  if (isNaN(dt.getTime())) return null;

  let version: Version = Version.VF;
  let format = "2D";

  for (const attr of session.attributes ?? []) {
    const attrId   = (attr.id          ?? "").toUpperCase();
    const shortN   = (attr.shortName   ?? "").toUpperCase();  // "VF", "VO", "STFR"
    const descr    = (attr.description ?? "").toUpperCase();  // "Version Française", "2D"

    // Version : ids commençant par "VS" (ex: VS00000005=VF, VS00000006=VO)
    if (attrId.startsWith("VS")) {
      if (shortN.includes("VOST") || shortN.includes("STFR") || shortN.includes("SUBTI")
          || descr.includes("VOST") || descr.includes("SOUS-TITR") || descr.includes("SUBTITL")) {
        version = Version.VOSTFR;
      } else if (shortN === "VO" || shortN.startsWith("VO")
                 || descr.includes("VERSION ORIGIN") || descr.includes("ORIGINAL")) {
        version = Version.VO;
      }
      // VS00000005 / shortN="VF" → reste VF
    }

    // Format : attributs "concept" (3D, Dolby, IMAX…)
    if (attr.isUsedForConcepts) {
      const label = (shortN + " " + descr);
      if (label.includes("IMAX"))  format = "IMAX";
      else if (label.includes("DOLBY")) format = "Dolby Atmos";
      else if (label.includes("3D"))    format = "3D";
      else if (label.includes("LASER")) format = "Laser";
    }
  }

  return { dateHeure: dt, version, format };
}

// ── Scraper ───────────────────────────────────────────────

export class Mk2Scraper extends BaseScraper {
  readonly name = "mk2";

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  // ── Méthode 1 : HTTP + __NEXT_DATA__ ─────────────────

  private async fetchViaHttp(slug: string): Promise<{
    buildId: string | null;
    groups: Mk2FilmGroup[];
    html: string;
  }> {
    const url = `${BASE_URL}/salle/${slug}`;
    const res = await fetchWithRetry(url, { headers: HEADERS });
    if (!res || !res.ok) return { buildId: null, groups: [], html: "" };

    const html = await res.text();
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
    if (!match) return { buildId: null, groups: [], html };

    try {
      const nextData  = JSON.parse(match[1]) as Record<string, unknown>;
      const buildId   = (nextData["buildId"] as string) ?? null;
      const pageProps = (nextData["props"] as Record<string, unknown>)?.["pageProps"] as unknown;
      const groups    = extractMk2Sessions(pageProps);
      return { buildId, groups, html };
    } catch {
      return { buildId: null, groups: [], html };
    }
  }

  private async fetchDayViaNextData(
    slug: string,
    buildId: string,
    dateStr: string
  ): Promise<Mk2FilmGroup[]> {
    // MK2 stocke ses pages sous /salle/{slug}
    const url = `${BASE_URL}/_next/data/${buildId}/salle/${slug}.json?date=${dateStr}&slug=${slug}`;
    const res = await fetchWithRetry(url, { headers: JSON_HEADERS });
    if (!res || !res.ok) return [];
    try {
      const json      = await res.json() as Record<string, unknown>;
      const pageProps = (json["pageProps"] as unknown) ?? json;
      return extractMk2Sessions(pageProps);
    } catch { return []; }
  }

  // ── Méthode 2 : JSON-LD ScreeningEvent ───────────────

  private parseJsonLd(
    html: string,
    today: Date,
    horizon: Date
  ): Array<{ film: Partial<ScrapedFilm>; seances: ScrapedSeance[] }> {
    const $ = cheerio.load(html);
    const filmMap = new Map<string, { film: Partial<ScrapedFilm>; seances: ScrapedSeance[] }>();

    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const raw = JSON.parse($(el).html() ?? "{}") as unknown;
        const items: unknown[] = Array.isArray(raw) ? raw : [raw];
        for (const item of items) {
          if (!item || typeof item !== "object") continue;
          const it = item as Record<string, unknown>;
          if (it["@type"] !== "ScreeningEvent") continue;
          const movie = (it["workPresented"] ?? it["movie"]) as Record<string, unknown> | undefined;
          const titre = (movie?.["name"] ?? it["name"]) as string | undefined;
          if (!titre) continue;
          const startStr = (it["startDate"] ?? it["startsAt"]) as string | undefined;
          if (!startStr) continue;
          const dt = new Date(startStr);
          if (isNaN(dt.getTime()) || dt < today || dt > horizon) continue;
          if (!filmMap.has(titre)) {
            filmMap.set(titre, {
              film: {
                titre,
                affiche:  (movie?.["image"] ?? movie?.["thumbnailUrl"]) as string | undefined,
                synopsis: movie?.["description"] as string | undefined,
              },
              seances: [],
            });
          }
          filmMap.get(titre)!.seances.push({
            dateHeure: dt,
            version:   parseVersion((it["inLanguage"] ?? it["version"]) as string | undefined),
            format:    parseFormat((it["name"] ?? it["technology"]) as string | undefined),
          });
        }
      } catch { /* ignore */ }
    });

    return Array.from(filmMap.values()).filter((r) => r.seances.length > 0);
  }

  // ── Conversion Mk2FilmGroup[] → ScrapedFilm+séances ──────

  private convertGroups(
    groups: Mk2FilmGroup[],
    today: Date,
    horizon: Date
  ): Array<{ film: Partial<ScrapedFilm>; seances: ScrapedSeance[] }> {
    const map = new Map<string, { film: Partial<ScrapedFilm>; seances: ScrapedSeance[] }>();

    for (const g of groups) {
      const titre = g.film.title;
      if (!titre || titre.length < 2) continue;

      if (!map.has(titre)) {
        const dirs    = g.film.directors ?? [];
        const dir     = dirs[0];
        const genres  = (g.film.genres ?? []).map(ge => ge.name ?? "").filter(Boolean);
        map.set(titre, {
          film: {
            titre,
            titreOriginal: g.film.originalTitle !== titre ? g.film.originalTitle : undefined,
            affiche:       g.film.graphicUrl,
            synopsis:      g.film.synopsis,
            duree:         typeof g.film.runTime === "number" ? g.film.runTime : undefined,
            genres,
            realisateur:   dir
              ? `${dir.firstName ?? ""} ${dir.lastName ?? dir.name ?? ""}`.trim()
              : undefined,
          },
          seances: [],
        });
      }

      const entry = map.get(titre)!;
      for (const session of g.sessions) {
        const seance = mk2SessionToSeance(session);
        if (!seance) continue;
        if (seance.dateHeure < today || seance.dateHeure > horizon) continue;
        const key = seance.dateHeure.toISOString();
        if (!entry.seances.find(s => s.dateHeure.toISOString() === key)) {
          entry.seances.push(seance);
        }
      }
    }

    return Array.from(map.values()).filter(r => r.seances.length > 0);
  }

  // ── Regroupement JSON brut (fallback Playwright) ──────────

  private groupShowtimesRaw(
    rawItems: Array<Record<string, unknown>>,
    today: Date,
    horizon: Date
  ): Array<{ film: Partial<ScrapedFilm>; seances: ScrapedSeance[] }> {
    const map = new Map<string, { film: Partial<ScrapedFilm>; seances: ScrapedSeance[] }>();

    for (const st of rawItems) {
      const movie  = (st["movie"] ?? st["film"] ?? st["workPresented"]) as Record<string, unknown> | undefined;
      const titre  = (movie?.["title"] ?? movie?.["name"] ?? st["movieTitle"] ?? st["filmTitle"]) as string | undefined;
      if (!titre || titre.length < 2) continue;

      const dtStr = (
        st["showTime"] ?? st["startDate"] ?? st["startsAt"] ?? st["datetime"] ?? st["dateHeure"]
      ) as string | undefined;
      if (!dtStr) continue;
      const dt = new Date(dtStr);
      if (isNaN(dt.getTime()) || dt < today || dt > horizon) continue;

      if (!map.has(titre)) {
        map.set(titre, {
          film: {
            titre,
            titreOriginal: (movie?.["originalTitle"] as string | undefined) !== titre
              ? (movie?.["originalTitle"] as string | undefined) : undefined,
            affiche:    (movie?.["posterUrl"] ?? movie?.["poster"] ?? movie?.["image"]) as string | undefined,
            synopsis:   (movie?.["synopsis"] ?? movie?.["description"]) as string | undefined,
            genres:     Array.isArray(movie?.["genres"]) ? movie["genres"] as string[] : [],
          },
          seances: [],
        });
      }

      const existing = map.get(titre)!.seances;
      const key = dt.toISOString();
      if (!existing.find((s) => s.dateHeure.toISOString() === key)) {
        existing.push({
          dateHeure: dt,
          version: parseVersion((st["inLanguage"] ?? st["version"] ?? st["language"]) as string | undefined),
          format:  parseFormat((st["technology"] ?? st["format"]) as string | undefined),
        });
      }
    }

    return Array.from(map.values()).filter((r) => r.seances.length > 0);
  }

  // ── Méthode 3 : Playwright (dernier recours) ──────────

  private async launchBrowser(): Promise<void> {
    this.browser = await chromium.launch({
      headless: true,
      args: CHROMIUM_ARGS,
    });
    this.context = await this.browser.newContext({
      userAgent: HEADERS["User-Agent"],
      locale: "fr-FR",
      timezoneId: "Europe/Paris",
    });
  }

  private async closeBrowser(): Promise<void> {
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.browser = null;
    this.context = null;
  }

  private async fetchViaPlaywright(
    slug: string,
    today: Date,
    horizon: Date
  ): Promise<Array<Record<string, unknown>>> {
    if (!this.context) return [];
    const captured: Array<Record<string, unknown>> = [];
    const page = await this.context.newPage();
    try {
      await page.route("**/*", (route) => {
        const t = route.request().resourceType();
        if (["font", "media", "stylesheet"].includes(t)) route.abort().catch(() => {});
        else route.continue().catch(() => {});
      });

      page.on("response", async (resp) => {
        const url = resp.url();
        const ct  = resp.headers()["content-type"] ?? "";
        if (!ct.includes("json") && !url.includes("_next/data")) return;
        try {
          const data = await resp.json() as unknown;
          captured.push(...extractShowtimesDeep(data));
        } catch { /* ignore */ }
      });

      // Chargement jour par jour
      for (let day = 0; day < DAYS_AHEAD; day++) {
        const date = new Date(today);
        date.setDate(today.getDate() + day);
        const dateStr = toDateStr(date);
        try {
          const resp = await page.goto(
            `${BASE_URL}/salle/${slug}?date=${dateStr}`,
            { waitUntil: "domcontentloaded", timeout: 25_000 }
          );
          if (resp && resp.status() < 400) {
            await page.waitForLoadState("networkidle", { timeout: 7_000 }).catch(() => {});
            await sleep(500);
          }
        } catch { /* next day */ }
      }
    } finally {
      await page.close().catch(() => {});
    }
    return captured;
  }

  // ── Programme complet d'une salle ────────────────────

  private async fetchProgramme(
    cinema: (typeof MK2_CINEMAS)[number]
  ): Promise<Array<{ film: Partial<ScrapedFilm>; seances: ScrapedSeance[] }>> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + DAYS_AHEAD);

    // ── 1. HTTP + __NEXT_DATA__ ───────────────────────
    this.log(`    📡 HTTP fetch pour ${cinema.slug}…`);
    const { buildId, groups: day0Groups, html } = await this.fetchViaHttp(cinema.slug);
    const allGroups: Mk2FilmGroup[] = [...day0Groups];

    if (buildId) {
      this.log(`    🔑 buildId: ${buildId.slice(0, 12)}…`);
      for (let day = 1; day < DAYS_AHEAD; day++) {
        const date = new Date(today);
        date.setDate(today.getDate() + day);
        const dateStr = toDateStr(date);
        await sleep(150);
        const dayGroups = await this.fetchDayViaNextData(cinema.slug, buildId, dateStr);
        // Fusionner : même film → ajouter les sessions manquantes
        for (const g of dayGroups) {
          const existing = allGroups.find(e => e.film.id === g.film.id && e.film.title === g.film.title);
          if (existing) {
            for (const s of g.sessions) {
              if (!existing.sessions.find(es => es.id === s.id)) existing.sessions.push(s);
            }
          } else {
            allGroups.push(g);
          }
        }
        if (day % 5 === 0) {
          const total = allGroups.reduce((a, g) => a + g.sessions.length, 0);
          this.log(`    📅 J+${day} — ${total} séances accumulées`);
        }
      }
    }

    if (allGroups.length > 0) {
      const result = this.convertGroups(allGroups, today, horizon);
      if (result.length > 0) return result;
    }

    // ── 2. JSON-LD depuis le HTML déjà récupéré ───────
    if (html) {
      this.log(`    📜 Tentative JSON-LD…`);
      const jsonldResult = this.parseJsonLd(html, today, horizon);
      if (jsonldResult.length > 0) return jsonldResult;
    }

    // ── 3. Playwright (dernier recours) ───────────────
    this.log(`    🤖 Playwright (fallback) pour ${cinema.slug}…`);
    const pwData = await this.fetchViaPlaywright(cinema.slug, today, horizon);
    if (pwData.length > 0) return this.groupShowtimesRaw(pwData, today, horizon);

    return [];
  }

  // ── Orchestration ─────────────────────────────────────

  async scrape(): Promise<ScraperResult> {
    const result = this.makeResult();

    try {
      await this.launchBrowser();
      this.log(`🎪 ${MK2_CINEMAS.length} salles MK2 à scraper (fenêtre ${DAYS_AHEAD} jours)`);

      for (const cinemaInfo of MK2_CINEMAS) {
        this.log(`\n▶ ${cinemaInfo.nom}`);
        await this.politeDelay();

        try {
          const programme = await this.fetchProgramme(cinemaInfo);

          const films: ScrapedCinemaFilm[] = programme
            .filter((p) => p.film.titre && p.seances.length > 0)
            .map((p) => ({
              film: {
                titre:        p.film.titre!,
                titreOriginal: p.film.titreOriginal,
                synopsis:     p.film.synopsis,
                affiche:      p.film.affiche,
                duree:        p.film.duree,
                genres:       p.film.genres ?? [],
                realisateur:  p.film.realisateur,
                sourceId:     `mk2-${cinemaInfo.slug}`,
              } as ScrapedFilm,
              seances: p.seances,
            }));

          result.cinemas.push({
            sourceId:  `mk2-${cinemaInfo.slug}`,
            nom:       cinemaInfo.nom,
            adresse:   cinemaInfo.adresse,
            ville:     cinemaInfo.ville,
            codePostal: cinemaInfo.cp,
            latitude:  cinemaInfo.lat,
            longitude: cinemaInfo.lng,
            siteWeb:   `${BASE_URL}/salle/${cinemaInfo.slug}`,
            films,
          } as ScrapedCinema);

          const totalSeances = films.reduce((a, f) => a + f.seances.length, 0);
          this.log(`  → ${films.length} films, ${totalSeances} séances sur ${DAYS_AHEAD} jours`);
        } catch (err) {
          this.addError(result, `Erreur cinéma ${cinemaInfo.nom}: ${err}`);
        }
      }
    } catch (err) {
      this.addError(result, `Erreur inattendue MK2: ${err}`);
    } finally {
      await this.closeBrowser();
    }

    const totalSeances = result.cinemas.reduce((a, c) => a + c.films.reduce((b, f) => b + f.seances.length, 0), 0);
    this.log(`\n✅ MK2 terminé — ${result.cinemas.length} cinémas, ${totalSeances} séances`);
    return result;
  }
}
