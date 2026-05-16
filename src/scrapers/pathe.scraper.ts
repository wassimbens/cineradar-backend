// ─────────────────────────────────────────────────────────
//  Scraper Pathé — pathe.fr  (refonte complète)
//
//  Stratégie :
//    1. Fetch HTTP direct + extraction __NEXT_DATA__ (Next.js SSR)
//    2. Pour J+1…J+29 : _next/data/{buildId}/cinemas/{slug}.json
//    3. Parser récursif robuste sur la structure pageProps
//    4. Fallback Playwright (stealth) si HTTP bloqué
//
//  Améliorations vs v1 :
//    - Pas de Playwright pour le cas nominal → 10× plus rapide
//    - Retry 429/503 avec back-off exponentiel
//    - Meilleure liste de cinémas (27 établissements)
//    - Détection VF/VOST/VO et format améliorée
//    - Timezone Europe/Paris stricte
// ─────────────────────────────────────────────────────────

// @ts-ignore
import { chromium } from "playwright-extra";
// @ts-ignore
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, BrowserContext } from "playwright";
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

(chromium as { use: (p: unknown) => void }).use(StealthPlugin());

const BASE_URL  = "https://www.pathe.fr";
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

// ── Cinémas Pathé France (27 établissements) ──────────────

const PATHE_CINEMAS = [
  // ── Paris ──
  { slug: "pathe-wepler",          name: "Pathé Wepler",                address: "17 Place de Clichy",              city: "Paris",          zipCode: "75018", latitude: 48.8838, longitude: 2.3278 },
  { slug: "pathe-beaugrenelle",    name: "Pathé Beaugrenelle",          address: "12 Rue Linois",                   city: "Paris",          zipCode: "75015", latitude: 48.8478, longitude: 2.2896 },
  { slug: "pathe-convention",      name: "Pathé Convention",            address: "27 Rue Alain Chartier",           city: "Paris",          zipCode: "75015", latitude: 48.8396, longitude: 2.3016 },
  { slug: "pathe-opera-premier",   name: "Pathé Opéra Premier",        address: "8 Bd des Capucines",              city: "Paris",          zipCode: "75009", latitude: 48.8709, longitude: 2.3322 },
  { slug: "pathe-les-fauvettes",   name: "Pathé Les Fauvettes",        address: "8 Avenue des Gobelins",           city: "Paris",          zipCode: "75013", latitude: 48.8356, longitude: 2.3524 },
  { slug: "pathe-montparnos",      name: "Pathé Montparnos",           address: "3 Rue Commandant Mouchotte",      city: "Paris",          zipCode: "75014", latitude: 48.8406, longitude: 2.3175 },
  { slug: "pathe-la-villette",     name: "Pathé La Villette",          address: "211 Av Jean Jaurès",              city: "Paris",          zipCode: "75019", latitude: 48.8923, longitude: 2.3883 },
  // ── Île-de-France ──
  { slug: "pathe-gaumont-disney",  name: "Pathé Gaumont Disney Village", address: "1 Bd du Parc",                 city: "Chessy",         zipCode: "77700", latitude: 48.8693, longitude: 2.7795 },
  { slug: "pathe-massy",           name: "Pathé Massy",                 address: "17 Av Carnot",                   city: "Massy",          zipCode: "91300", latitude: 48.7267, longitude: 2.2735 },
  { slug: "pathe-versailles",      name: "Pathé Versailles",            address: "Av du Général de Gaulle",        city: "Versailles",     zipCode: "78000", latitude: 48.8014, longitude: 2.1301 },
  { slug: "pathe-les-grésilles",   name: "Pathé Les Grésilles",        address: "17 Av du Drapeau",               city: "Dijon",          zipCode: "21000", latitude: 47.3216, longitude: 5.0413 },
  // ── Lyon / Rhône-Alpes ──
  { slug: "pathe-carré-de-soie",   name: "Pathé Carré de Soie",       address: "Av du Général de Gaulle",         city: "Vaulx-en-Velin", zipCode: "69120", latitude: 45.7713, longitude: 4.9296 },
  { slug: "pathe-bellecour",       name: "Pathé Bellecour",            address: "26 Rue de la Barre",              city: "Lyon",           zipCode: "69002", latitude: 45.7574, longitude: 4.8320 },
  { slug: "pathe-vaise",           name: "Pathé Vaise",                address: "31 Rue Marietton",                city: "Lyon",           zipCode: "69009", latitude: 45.7724, longitude: 4.8016 },
  { slug: "pathe-chavant",         name: "Pathé Chavant",              address: "2 Pl Firmin Gautier",             city: "Grenoble",       zipCode: "38000", latitude: 45.1871, longitude: 5.7247 },
  // ── Sud-Est ──
  { slug: "pathe-marseille-plan-de-campagne", name: "Pathé Plan de Campagne", address: "RN 113",              city: "Les Pennes-Mirabeau", zipCode: "13170", latitude: 43.4265, longitude: 5.3307 },
  { slug: "pathe-toulon",          name: "Pathé Toulon",               address: "Quartier Mayol",                  city: "Toulon",         zipCode: "83000", latitude: 43.1255, longitude: 5.9378 },
  { slug: "pathe-nice-gare",       name: "Pathé Nice Gare",            address: "33 Av Malausséna",               city: "Nice",           zipCode: "06000", latitude: 43.7054, longitude: 7.2645 },
  { slug: "pathe-lingostiere",     name: "Pathé Lingostière",          address: "Av de la Lanterne",               city: "Nice",           zipCode: "06200", latitude: 43.7231, longitude: 7.2018 },
  // ── Nantes / Grand Ouest ──
  { slug: "pathe-nantes",          name: "Pathé Nantes Atlantis",      address: "Rue du Port Boyer",               city: "Saint-Herblain", zipCode: "44800", latitude: 47.2448, longitude: -1.6345 },
  // ── Bordeaux ──
  { slug: "pathe-bordeaux",        name: "Pathé Bordeaux",             address: "14 Allée de Chartres",            city: "Bordeaux",       zipCode: "33000", latitude: 44.8378, longitude: -0.5792 },
  // ── Toulouse ──
  { slug: "pathe-labège",          name: "Pathé Labège",               address: "Centre Commercial Fenouillet",    city: "Labège",         zipCode: "31670", latitude: 43.5356, longitude: 1.5285 },
  // ── Strasbourg ──
  { slug: "pathe-strasbourg-étoile", name: "Pathé Strasbourg Étoile", address: "39 Rue du Faubourg National",     city: "Strasbourg",     zipCode: "67000", latitude: 48.5840, longitude: 7.7345 },
  // ── Rennes ──
  { slug: "pathe-rennes",          name: "Pathé Rennes",               address: "14 Allée Louis Lumière",          city: "Rennes",         zipCode: "35000", latitude: 48.1147, longitude: -1.6753 },
  // ── Lille ──
  { slug: "pathe-gaumont-lille",   name: "Pathé Gaumont Lille",        address: "40 Rue Nationale",               city: "Lille",          zipCode: "59000", latitude: 50.6325, longitude: 3.0586 },
  // ── Montpellier ──
  { slug: "pathe-montpellier",     name: "Pathé Montpellier",          address: "Odysseum, Av Raymond Dugrand",    city: "Montpellier",    zipCode: "34000", latitude: 43.6049, longitude: 3.9200 },
  // ── Clermont-Ferrand ──
  { slug: "pathe-clermont-ferrand", name: "Pathé Clermont-Ferrand",    address: "27 Bd François Mitterrand",      city: "Clermont-Ferrand", zipCode: "63000", latitude: 45.7797, longitude: 3.0863 },
];

// ── Helpers ───────────────────────────────────────────────

function parseVersion(raw?: string): Version {
  if (!raw) return Version.VF;
  const u = raw.toUpperCase().replace(/[\s\-_]/g, "");
  if (u.includes("VOST") || u.includes("SUBTIT") || u.includes("SOUSTITR")) return Version.VOSTFR;
  if (u === "VO" || u.startsWith("VO") || u === "ORIGINAL" || u.includes("ORIGIN")) return Version.VO;
  return Version.VF;
}

function parseFormat(raw?: string): string {
  if (!raw) return "2D";
  const u = raw.toUpperCase();
  if (u.includes("IMAX"))   return "IMAX";
  if (u.includes("DOLBY"))  return "Dolby Atmos";
  if (u.includes("4DX"))    return "4DX";
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

/** Fetch avec retry sur 429/503 */
async function fetchWithRetry(url: string, opts: RequestInit, retries = 3): Promise<Response | null> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(15_000) });
      if (res.status === 429 || res.status === 503) {
        const wait = (i + 1) * 2000;
        await sleep(wait);
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

/** Extrait récursivement toutes les séances d'un objet JSON Pathé */
function extractShowtimesDeep(obj: unknown, depth = 0): Array<Record<string, unknown>> {
  if (depth > 10 || !obj || typeof obj !== "object") return [];
  const results: Array<Record<string, unknown>> = [];
  if (Array.isArray(obj)) {
    for (const item of obj) results.push(...extractShowtimesDeep(item, depth + 1));
    return results;
  }
  const o = obj as Record<string, unknown>;
  // Un objet est une séance s'il a une date de début
  const hasDate =
    (typeof o["startsAt"] === "string" && o["startsAt"].length > 5) ||
    (typeof o["startDate"] === "string" && o["startDate"].length > 5) ||
    (typeof o["datetime"] === "string" && o["datetime"].length > 5);
  if (hasDate) results.push(o);
  // Clés enfants connues
  for (const key of ["showtimes", "screenings", "sessions", "seances", "data", "results",
                      "items", "movies", "films", "program", "programme", "schedule"]) {
    if (Array.isArray(o[key])) {
      for (const item of o[key] as unknown[]) results.push(...extractShowtimesDeep(item, depth + 1));
    }
  }
  // Objets imbriqués non-tableau
  for (const val of Object.values(o)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      results.push(...extractShowtimesDeep(val, depth + 1));
    }
  }
  return results;
}

// ── Scraper ───────────────────────────────────────────────

export class PatheScraper extends BaseScraper {
  readonly name = "pathe";

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  // ── Méthode 1 : HTTP direct + __NEXT_DATA__ ───────────

  private async fetchViaHttp(slug: string): Promise<{
    buildId: string | null;
    data: Array<Record<string, unknown>>;
  }> {
    const url = `${BASE_URL}/cinemas/${slug}`;
    const res = await fetchWithRetry(url, { headers: HEADERS });
    if (!res || !res.ok) return { buildId: null, data: [] };

    const html = await res.text();

    // Extraire __NEXT_DATA__
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
    if (!match) return { buildId: null, data: [] };

    try {
      const nextData = JSON.parse(match[1]) as Record<string, unknown>;
      const buildId = (nextData["buildId"] as string) ?? null;
      const pageProps = (nextData["props"] as Record<string, unknown>)?.["pageProps"] as unknown;
      const data = extractShowtimesDeep(pageProps);
      return { buildId, data };
    } catch {
      return { buildId: null, data: [] };
    }
  }

  private async fetchDayViaNextData(
    slug: string,
    buildId: string,
    dateStr: string
  ): Promise<Array<Record<string, unknown>>> {
    // URL _next/data pour un jour donné
    const url = `${BASE_URL}/_next/data/${buildId}/cinemas/${slug}.json?date=${dateStr}&slug=${slug}`;
    const res = await fetchWithRetry(url, { headers: JSON_HEADERS });
    if (!res || !res.ok) return [];
    try {
      const json = await res.json() as Record<string, unknown>;
      const pageProps = (json["pageProps"] as unknown) ?? json;
      return extractShowtimesDeep(pageProps);
    } catch { return []; }
  }

  private groupShowtimes(
    rawItems: Array<Record<string, unknown>>,
    today: Date,
    horizon: Date
  ): Array<{ film: Partial<ScrapedFilm>; seances: ScrapedSeance[] }> {
    const map = new Map<string, { film: Partial<ScrapedFilm>; seances: ScrapedSeance[] }>();

    for (const st of rawItems) {
      // Film attaché
      const movie = (st["movie"] ?? st["film"] ?? st["workPresented"]) as Record<string, unknown> | undefined;
      const titre  = (movie?.["title"] ?? movie?.["name"] ?? st["movieTitle"] ?? st["filmTitle"]) as string | undefined;
      if (!titre || titre.length < 2) continue;

      // Date/heure de la séance
      const dtStr = (st["startsAt"] ?? st["startDate"] ?? st["datetime"]) as string | undefined;
      if (!dtStr) continue;
      const dt = new Date(dtStr);
      if (isNaN(dt.getTime()) || dt < today || dt > horizon) continue;

      if (!map.has(titre)) {
        const dirs = movie?.["directors"] as Array<Record<string, string>> | undefined;
        const dir = dirs?.[0];
        map.set(titre, {
          film: {
            titre,
            titreOriginal: (movie?.["originalTitle"] as string | undefined) !== titre
              ? (movie?.["originalTitle"] as string | undefined) : undefined,
            affiche:    (movie?.["posterUrl"] ?? movie?.["poster"] ?? movie?.["image"]) as string | undefined,
            duree:      typeof movie?.["durationMinutes"] === "number" ? movie["durationMinutes"] as number : undefined,
            genres:     Array.isArray(movie?.["genres"]) ? movie["genres"] as string[] : [],
            synopsis:   (movie?.["synopsis"] ?? movie?.["description"]) as string | undefined,
            realisateur: dir
              ? `${(dir["firstName"] ?? "") as string} ${(dir["lastName"] ?? dir["name"] ?? "") as string}`.trim()
              : undefined,
          },
          seances: [],
        });
      }

      const existing = map.get(titre)!.seances;
      const key = dt.toISOString();
      if (!existing.find((s) => s.dateHeure.toISOString() === key)) {
        existing.push({
          dateHeure: dt,
          version: parseVersion((st["version"] ?? st["language"] ?? st["inLanguage"]) as string | undefined),
          format:  parseFormat((st["technology"] ?? st["format"] ?? st["experience"]) as string | undefined),
        });
      }
    }

    return Array.from(map.values()).filter((r) => r.seances.length > 0);
  }

  // ── Méthode 2 : Playwright stealth (fallback) ─────────

  private async launchBrowser(): Promise<void> {
    this.browser = await (chromium as { launch: (o: unknown) => Promise<Browser> }).launch({
      headless: true,
      args: [...CHROMIUM_ARGS, "--disable-blink-features=AutomationControlled"],
    });
    this.context = await this.browser.newContext({
      userAgent: HEADERS["User-Agent"],
      locale: "fr-FR",
      timezoneId: "Europe/Paris",
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: { "Accept-Language": "fr-FR,fr;q=0.9" },
    });
  }

  private async closeBrowser(): Promise<void> {
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.browser = null;
    this.context = null;
  }

  private async fetchViaPlaywright(slug: string, today: Date, horizon: Date): Promise<Array<Record<string, unknown>>> {
    if (!this.context) return [];
    const allCaptured: Array<Record<string, unknown>> = [];
    const page = await this.context.newPage();
    try {
      await page.route("**/*", (route) => {
        const t = route.request().resourceType();
        if (["font", "media", "image", "stylesheet"].includes(t)) route.abort().catch(() => {});
        else route.continue().catch(() => {});
      });

      page.on("response", async (response) => {
        const url = response.url();
        const ct = response.headers()["content-type"] ?? "";
        if (!ct.includes("json")) return;
        if (!url.includes("pathe") && !url.includes("_next/data")) return;
        try {
          const data = await response.json() as unknown;
          const extracted = extractShowtimesDeep(data);
          if (extracted.length > 0) allCaptured.push(...extracted);
        } catch { /* ignore */ }
      });

      for (let day = 0; day < DAYS_AHEAD; day++) {
        const date = new Date(today);
        date.setDate(today.getDate() + day);
        const dateStr = toDateStr(date);
        try {
          const resp = await page.goto(
            `${BASE_URL}/cinemas/${slug}?date=${dateStr}`,
            { waitUntil: "domcontentloaded", timeout: 25_000 }
          );
          if (resp && resp.status() < 400) {
            await page.waitForLoadState("networkidle", { timeout: 7_000 }).catch(() => {});
            await sleep(600);
          }
        } catch { /* continue */ }
      }
    } finally {
      await page.close().catch(() => {});
    }
    return allCaptured;
  }

  // ── Programme complet d'un cinéma ────────────────────

  private async fetchProgramme(
    slug: string
  ): Promise<Array<{ film: Partial<ScrapedFilm>; seances: ScrapedSeance[] }>> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + DAYS_AHEAD);

    // ── Tentative HTTP + __NEXT_DATA__ ────────────────
    this.log(`    📡 HTTP fetch pour ${slug}…`);
    const { buildId, data: day0Data } = await this.fetchViaHttp(slug);
    let allData: Array<Record<string, unknown>> = [...day0Data];

    if (buildId) {
      this.log(`    🔑 buildId: ${buildId.slice(0, 12)}…`);
      for (let day = 1; day < DAYS_AHEAD; day++) {
        const date = new Date(today);
        date.setDate(today.getDate() + day);
        const dateStr = toDateStr(date);
        await sleep(150); // poli envers le serveur
        const dayData = await this.fetchDayViaNextData(slug, buildId, dateStr);
        allData.push(...dayData);
        if (day % 5 === 0) this.log(`    📅 J+${day} — ${allData.length} séances accumulées`);
      }
    } else {
      this.log(`    ⚠️ __NEXT_DATA__ non trouvé, passage en Playwright…`);
    }

    if (allData.length > 0) {
      const result = this.groupShowtimes(allData, today, horizon);
      if (result.length > 0) return result;
    }

    // ── Fallback Playwright ───────────────────────────
    this.log(`    🤖 Playwright (fallback) pour ${slug}…`);
    const pwData = await this.fetchViaPlaywright(slug, today, horizon);
    return this.groupShowtimes(pwData, today, horizon);
  }

  // ── Orchestration ─────────────────────────────────────

  async scrape(): Promise<ScraperResult> {
    const result = this.makeResult();

    try {
      this.log(`🎪 ${PATHE_CINEMAS.length} cinémas Pathé à scraper (fenêtre ${DAYS_AHEAD} jours)`);

      // Lance le browser en avance (utilisé seulement en fallback)
      await this.launchBrowser();

      for (const c of PATHE_CINEMAS) {
        this.log(`\n▶ ${c.name} (${c.slug})`);
        await this.politeDelay();

        try {
          const programme = await this.fetchProgramme(c.slug);

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
                sourceId:     `pathe-${c.slug}`,
              } as ScrapedFilm,
              seances: p.seances,
            }));

          const cinema: ScrapedCinema = {
            sourceId:  `pathe-${c.slug}`,
            nom:       c.name,
            adresse:   c.address,
            ville:     c.city,
            codePostal: c.zipCode,
            latitude:  c.latitude,
            longitude: c.longitude,
            siteWeb:   `${BASE_URL}/cinemas/${c.slug}`,
            films,
          };
          result.cinemas.push(cinema);

          const totalSeances = films.reduce((a, f) => a + f.seances.length, 0);
          this.log(`  → ${films.length} films, ${totalSeances} séances sur ${DAYS_AHEAD} jours`);
        } catch (err) {
          this.addError(result, `Erreur cinéma ${c.name}: ${err}`);
        }
      }
    } catch (err) {
      this.addError(result, `Erreur inattendue Pathé: ${err}`);
    } finally {
      await this.closeBrowser();
    }

    const totalSeances = result.cinemas.reduce((a, c) => a + c.films.reduce((b, f) => b + f.seances.length, 0), 0);
    this.log(`\n✅ Pathé terminé — ${result.cinemas.length} cinémas, ${totalSeances} séances`);
    return result;
  }
}
