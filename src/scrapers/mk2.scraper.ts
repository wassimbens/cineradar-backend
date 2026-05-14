// ─────────────────────────────────────────────────────────
//  Scraper MK2 — mk2.com  (refonte complète)
//
//  Stratégie (mêmes principes que le scraper UGC amélioré) :
//    1. Fetch HTTP direct + extraction __NEXT_DATA__ (Next.js SSR)
//    2. Pour J+1…J+29 : _next/data/{buildId}/nos-salles/{slug}.json
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

const MK2_CINEMAS = [
  { slug: "mk2-bibliotheque",        nom: "MK2 Bibliothèque",           adresse: "128-162 Av de France",          ville: "Paris", cp: "75013", lat: 48.8318, lng: 2.3799 },
  { slug: "mk2-bastille",            nom: "MK2 Bastille (côté Port)",   adresse: "14 Bd de la Bastille",          ville: "Paris", cp: "75012", lat: 48.8499, lng: 2.3658 },
  { slug: "mk2-bastille-boulevard",  nom: "MK2 Bastille (côté Bd)",     adresse: "4 Bd Richard Lenoir",           ville: "Paris", cp: "75011", lat: 48.8502, lng: 2.3672 },
  { slug: "mk2-beaubourg",           nom: "MK2 Beaubourg",              adresse: "50 Rue Rambuteau",              ville: "Paris", cp: "75003", lat: 48.8609, lng: 2.3518 },
  { slug: "mk2-nation",              nom: "MK2 Nation",                 adresse: "133 Bd Diderot",                ville: "Paris", cp: "75012", lat: 48.8487, lng: 2.3943 },
  { slug: "mk2-odeon-cote-seine",    nom: "MK2 Odéon (côté Seine)",    adresse: "10 Rue de l'École de Médecine", ville: "Paris", cp: "75006", lat: 48.8510, lng: 2.3427 },
  { slug: "mk2-odeon-saint-germain", nom: "MK2 Odéon (St-Germain)",    adresse: "9 Rue de l'École de Médecine",  ville: "Paris", cp: "75006", lat: 48.8512, lng: 2.3425 },
  { slug: "mk2-parnasse",            nom: "MK2 Parnasse",               adresse: "94 Rue du Maine",               ville: "Paris", cp: "75014", lat: 48.8381, lng: 2.3233 },
  { slug: "mk2-quai-de-seine",       nom: "MK2 Quai de Seine",          adresse: "14 Quai de la Seine",           ville: "Paris", cp: "75019", lat: 48.8833, lng: 2.3647 },
  { slug: "mk2-quai-de-loire",       nom: "MK2 Quai de Loire",          adresse: "7 Quai de Loire",               ville: "Paris", cp: "75019", lat: 48.8839, lng: 2.3641 },
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
    (typeof o["dateHeure"]  === "string" && o["dateHeure"].length  > 5);
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

// ── Scraper ───────────────────────────────────────────────

export class Mk2Scraper extends BaseScraper {
  readonly name = "mk2";

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  // ── Méthode 1 : HTTP + __NEXT_DATA__ ─────────────────

  private async fetchViaHttp(slug: string): Promise<{
    buildId: string | null;
    data: Array<Record<string, unknown>>;
    html: string;
  }> {
    const url = `${BASE_URL}/nos-salles/${slug}`;
    const res = await fetchWithRetry(url, { headers: HEADERS });
    if (!res || !res.ok) return { buildId: null, data: [], html: "" };

    const html = await res.text();
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
    if (!match) return { buildId: null, data: [], html };

    try {
      const nextData = JSON.parse(match[1]) as Record<string, unknown>;
      const buildId  = (nextData["buildId"] as string) ?? null;
      const pageProps = (nextData["props"] as Record<string, unknown>)?.["pageProps"] as unknown;
      const data = extractShowtimesDeep(pageProps);
      return { buildId, data, html };
    } catch {
      return { buildId: null, data: [], html };
    }
  }

  private async fetchDayViaNextData(
    slug: string,
    buildId: string,
    dateStr: string
  ): Promise<Array<Record<string, unknown>>> {
    // MK2 stocke ses pages sous /nos-salles/{slug}
    const url = `${BASE_URL}/_next/data/${buildId}/nos-salles/${slug}.json?date=${dateStr}&slug=${slug}`;
    const res = await fetchWithRetry(url, { headers: JSON_HEADERS });
    if (!res || !res.ok) return [];
    try {
      const json = await res.json() as Record<string, unknown>;
      const pageProps = (json["pageProps"] as unknown) ?? json;
      return extractShowtimesDeep(pageProps);
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

  // ── Regroupement JSON brut → films+séances ────────────

  private groupShowtimes(
    rawItems: Array<Record<string, unknown>>,
    today: Date,
    horizon: Date
  ): Array<{ film: Partial<ScrapedFilm>; seances: ScrapedSeance[] }> {
    const map = new Map<string, { film: Partial<ScrapedFilm>; seances: ScrapedSeance[] }>();

    for (const st of rawItems) {
      const movie  = (st["movie"] ?? st["film"] ?? st["workPresented"]) as Record<string, unknown> | undefined;
      const titre  = (movie?.["title"] ?? movie?.["name"] ?? st["movieTitle"] ?? st["filmTitle"]) as string | undefined;
      if (!titre || titre.length < 2) continue;

      const dtStr = (st["startDate"] ?? st["startsAt"] ?? st["datetime"] ?? st["dateHeure"]) as string | undefined;
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
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
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
            `${BASE_URL}/nos-salles/${slug}?date=${dateStr}`,
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
    const { buildId, data: day0Data, html } = await this.fetchViaHttp(cinema.slug);
    let allData: Array<Record<string, unknown>> = [...day0Data];

    if (buildId) {
      this.log(`    🔑 buildId: ${buildId.slice(0, 12)}…`);
      for (let day = 1; day < DAYS_AHEAD; day++) {
        const date = new Date(today);
        date.setDate(today.getDate() + day);
        const dateStr = toDateStr(date);
        await sleep(150);
        const dayData = await this.fetchDayViaNextData(cinema.slug, buildId, dateStr);
        allData.push(...dayData);
        if (day % 5 === 0) this.log(`    📅 J+${day} — ${allData.length} séances accumulées`);
      }
    }

    if (allData.length > 0) {
      const result = this.groupShowtimes(allData, today, horizon);
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
    if (pwData.length > 0) return this.groupShowtimes(pwData, today, horizon);

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
            siteWeb:   `${BASE_URL}/nos-salles/${cinemaInfo.slug}`,
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
