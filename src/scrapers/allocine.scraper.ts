// ─────────────────────────────────────────────────────────
//  Scraper AlloCiné — allocine.fr  (v4)
//
//  Stratégie :
//    Phase 1 — Découverte nationale par BFS des pages ville :
//      1. Seed : /salle/ → collecte les 21 liens "ville-{id}"
//      2. BFS : pour chaque page ville, collecte les IDs de cinéma
//         ET les liens vers d'autres villes, ajoute au queue
//      3. Continue jusqu'à MAX_VILLE_PAGES villes visitées
//      → couvre toutes les villes de France qui ont un cinéma
//
//    Phase 2 — Séances :
//      Pour chaque cinéma découvert, API JSON interne AlloCiné :
//      GET /_/showtimes/theater-{id}/d-{YYYY-MM-DD}/  sur DAYS_AHEAD jours
//
//  Anti-rate-limit (v4) :
//    • RateLimitError distingue les 429 des vraies erreurs réseau
//    • Retry par requête : backoff exponentiel 30 s → 60 s → 120 s
//    • Circuit-breaker global : 5 cinémas consécutifs tout-429
//      → pause de 10 min avant de reprendre
//    • Délai de base augmenté : 1 500 ms entre dates, 5 s entre cinémas
//    • Jitter ±25 % pour éviter les rafales synchronisées
// ─────────────────────────────────────────────────────────

import { chromium, BrowserContext, Page } from "playwright";
import { Version } from "@prisma/client";
import { BaseScraper } from "./base.scraper.js";
import { CHROMIUM_ARGS } from "./chromium-args.js";
import {
  ScraperResult,
  ScrapedCinema,
  ScrapedFilm,
  ScrapedSeance,
} from "./types.js";

// ── Config ────────────────────────────────────────────────

const DAYS_AHEAD       = 30;
const MAX_CINEMAS      = 2000;
const PAGE_WORKERS     = 3;    // réduit pour moins stresser Cloudflare
const MAX_VILLE_PAGES  = 800;

/** Délai de base entre deux jours d'un même cinéma (ms) */
const DELAY_BETWEEN_DATES_MS = 1_500;
/** Délai de base entre deux cinémas (ms) */
const DELAY_BETWEEN_CINEMAS_MS = 5_000;
/** Backoff initial sur un 429 (ms) — multiplie par 2 à chaque retry */
const BACKOFF_429_BASE_MS = 30_000;   // 30 s
/** Nombre max de retries par requête sur 429 */
const MAX_RETRIES_429 = 3;            // 30 s + 60 s + 120 s
/** Nombre de cinémas consécutifs 100% en 429 avant d'activer le circuit-breaker */
const CB_THRESHOLD = 5;
/** Durée de pause du circuit-breaker (ms) */
const CB_PAUSE_MS = 10 * 60_000;     // 10 min

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ── Erreur spéciale 429 ───────────────────────────────────

class RateLimitError extends Error {
  constructor(url: string) {
    super(`HTTP 429 — ${url}`);
    this.name = "RateLimitError";
  }
}

// ── Types API AlloCiné ────────────────────────────────────

interface AcShowtime {
  internalId?: number;
  startsAt?: string;
  experience?: string | null;
  projection?: string[];
}

interface AcShowtimes {
  dubbed?:           AcShowtime[];
  multiple?:         AcShowtime[];
  multiple_st?:      AcShowtime[];
  multiple_st_sme?:  AcShowtime[];
  original?:         AcShowtime[];
  original_st?:      AcShowtime[];
  original_st_sme?:  AcShowtime[];
  [key: string]: AcShowtime[] | undefined;
}

interface AcMovie {
  title?:         string;
  originalTitle?: string;
  internalId?:    number;
  synopsis?:      string;
  poster?:        { url: string };
  runtime?:       number | string;
  genres?:        Array<{ tag: string }>;
  directors?:     Array<{ fullName: string }>;
}

interface AcResponse {
  error:   boolean;
  results: Array<{ movie: AcMovie; showtimes: AcShowtimes }>;
}

// ── Helpers ───────────────────────────────────────────────

function dateString(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function parseFormat(raw?: unknown): string {
  if (raw == null) return "2D";
  const u = String(raw).toUpperCase();
  if (u.includes("IMAX"))  return "IMAX";
  if (u.includes("DOLBY")) return "Dolby Atmos";
  if (u.includes("3D"))    return "3D";
  return "2D";
}

function parseRuntime(raw?: number | string): number | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "number") return raw > 0 ? raw : undefined;
  const m = String(raw).match(/(?:(\d+)\s*h\s*)?(?:(\d+)\s*(?:min|mn)?)?/i);
  if (!m) return undefined;
  const h   = parseInt(m[1] ?? "0") || 0;
  const min = parseInt(m[2] ?? "0") || 0;
  const total = h * 60 + min;
  return total > 0 ? total : undefined;
}

/** Jitter ±25 % autour d'une durée de base */
function jitter(ms: number): number {
  return ms * (0.75 + Math.random() * 0.5);
}

/**
 * Extrait depuis une page Playwright déjà rendue :
 * - les IDs de cinéma (a[href*="salle_gen_csalle="])
 * - les liens vers d'autres pages ville (a[href*="salle/cinema/ville-"])
 */
async function extractFromPage(page: Page): Promise<{ cinemaIds: string[]; villeUrls: string[] }> {
  return page.evaluate(() => {
    const cinemaIds: string[] = [];
    document.querySelectorAll('a[href*="salle_gen_csalle="]').forEach((a) => {
      const m = (a as HTMLAnchorElement).href.match(/csalle=([A-Z0-9]+)/);
      if (m?.[1]) cinemaIds.push(m[1]);
    });
    const villeUrls: string[] = [];
    document.querySelectorAll('a[href*="salle/cinema/ville-"]').forEach((a) => {
      const href = (a as HTMLAnchorElement).href;
      const m = href.match(/salle\/cinema\/ville-(\d+)\//);
      if (m) villeUrls.push(`https://www.allocine.fr/salle/cinema/ville-${m[1]}/`);
    });
    return { cinemaIds, villeUrls: [...new Set(villeUrls)] };
  }).catch(() => ({ cinemaIds: [], villeUrls: [] }));
}

// ── Scraper ───────────────────────────────────────────────

export class AllocineScraper extends BaseScraper {
  readonly name = "allocine";

  /**
   * Mode streaming : si défini, chaque cinéma est transmis immédiatement
   * après scraping et n'est PAS accumulé dans result.cinemas.
   * Permet d'éviter l'OOM sur 2000+ cinémas.
   */
  onCinema?: (cinema: ScrapedCinema) => Promise<void>;

  /** Nombre de cinémas consécutifs 100% rate-limités (circuit-breaker) */
  private consecutiveRateLimited = 0;

  async scrape(): Promise<ScraperResult> {
    const result = this.makeResult();

    this.log("Lancement du navigateur…");
    const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
    const ctx = await browser.newContext({
      userAgent: UA,
      locale: "fr-FR",
      timezoneId: "Europe/Paris",
    });

    try {
      // ── Phase 1 : découverte des cinémas ──────────────────
      this.log("Phase 1 — découverte nationale par BFS des pages ville…");
      const theaterIds = await this.discoverTheaters(ctx);
      this.log(`  → ${theaterIds.length} cinéma(s) découvert(s)`);

      // ── Phase 2 : scraping par cinéma ─────────────────────
      this.log("Phase 2 — séances par cinéma…");
      let count = 0;

      for (const id of theaterIds.slice(0, MAX_CINEMAS)) {
        // ── Circuit-breaker ────────────────────────────────
        if (this.consecutiveRateLimited >= CB_THRESHOLD) {
          this.log(
            `⛔ Circuit-breaker : ${this.consecutiveRateLimited} cinémas consécutifs ` +
            `100% rate-limités → pause ${CB_PAUSE_MS / 60_000} min…`,
            "warn"
          );
          await this.sleep(CB_PAUSE_MS);
          this.consecutiveRateLimited = 0;
          this.log("▶ Reprise après pause circuit-breaker");
        }

        try {
          const { cinema, allRateLimited } = await this.scrapeTheater(ctx, id);
          if (cinema) {
            if (this.onCinema) {
              await this.onCinema(cinema); // sauvegarde immédiate → libère la mémoire
            } else {
              result.cinemas.push(cinema);
            }
            this.log(`  ✓ ${cinema.nom} (${id}) — ${cinema.films.length} film(s)`);
          }

          if (allRateLimited) {
            this.consecutiveRateLimited++;
          } else {
            this.consecutiveRateLimited = 0;
          }
        } catch (err) {
          this.addError(result, `Cinéma ${id} : ${err}`);
        }

        await this.sleep(jitter(DELAY_BETWEEN_CINEMAS_MS));
        count++;
      }

      this.log(`Phase 2 terminée — ${count} cinéma(s) scrapé(s)`);
    } finally {
      await ctx.close();
      await browser.close();
    }

    return result;
  }

  // ── Phase 1 : BFS des pages ville ────────────────────

  private async discoverTheaters(ctx: BrowserContext): Promise<string[]> {
    const cinemaIds  = new Set<string>();
    const visited    = new Set<string>();
    const queue: string[] = [];

    // ── Seed : page principale /salle/ ────────────────────
    this.log("  Seed : /salle/…");
    {
      const page = await ctx.newPage();
      try {
        const resp = await page.goto("https://www.allocine.fr/salle/", {
          waitUntil: "domcontentloaded",
          timeout: 20_000,
        });
        if (resp?.ok()) {
          await page
            .waitForSelector('a[href*="salle_gen_csalle="]', { timeout: 8_000 })
            .catch(() => {});
          const { cinemaIds: ids, villeUrls } = await extractFromPage(page);
          ids.forEach((id) => cinemaIds.add(id));
          villeUrls.forEach((url) => { if (!visited.has(url)) queue.push(url); });
          this.log(`    → ${ids.length} cinémas, ${villeUrls.length} villes en queue`);
        }
      } finally {
        await page.close().catch(() => {});
      }
    }

    // ── BFS avec PAGE_WORKERS workers parallèles ──────────
    this.log(`  BFS villes (max ${MAX_VILLE_PAGES} pages, ${PAGE_WORKERS} workers)…`);
    let totalVisited = 0;

    const workers = Array.from({ length: PAGE_WORKERS }, async () => {
      const page = await ctx.newPage();
      try {
        while (queue.length > 0 && totalVisited < MAX_VILLE_PAGES) {
          const url = queue.shift();
          if (!url || visited.has(url)) continue;
          visited.add(url);
          totalVisited++;

          try {
            const resp = await page.goto(url, {
              waitUntil: "domcontentloaded",
              timeout: 18_000,
            });

            if (resp?.ok()) {
              await page
                .waitForSelector('a[href*="salle_gen_csalle="]', { timeout: 5_000 })
                .catch(() => {});

              const { cinemaIds: ids, villeUrls } = await extractFromPage(page);

              const newIds = ids.filter((id) => !cinemaIds.has(id));
              newIds.forEach((id) => cinemaIds.add(id));

              for (const villeUrl of villeUrls) {
                if (!visited.has(villeUrl) && !queue.includes(villeUrl)) {
                  queue.push(villeUrl);
                }
              }

              if (newIds.length > 0 || villeUrls.length > 0) {
                this.log(
                  `    [${totalVisited}/${MAX_VILLE_PAGES}] +${newIds.length} cinémas ` +
                    `(total ${cinemaIds.size}) — ${villeUrls.length} villes → queue: ${queue.length}`
                );
              }
            }
          } catch {
            /* timeout ou erreur → ignorer */
          }

          await new Promise((r) => setTimeout(r, 300));
        }
      } finally {
        await page.close().catch(() => {});
      }
    });

    await Promise.all(workers);
    this.log(`  BFS terminé — ${totalVisited} pages visitées, ${cinemaIds.size} cinémas uniques`);

    return [...cinemaIds];
  }

  // ── Phase 2 : scraping d'un cinéma ───────────────────

  private async scrapeTheater(
    ctx: BrowserContext,
    theaterId: string
  ): Promise<{ cinema: ScrapedCinema | null; allRateLimited: boolean }> {
    const info = await this.fetchTheaterInfo(ctx, theaterId);

    const filmMap = new Map<string, { film: ScrapedFilm; seances: ScrapedSeance[] }>();
    let rateLimitedDates = 0;
    let successfulDates  = 0;

    for (let d = 0; d < DAYS_AHEAD; d++) {
      const date = dateString(d);
      try {
        const data = await this.fetchShowtimesWithRetry(ctx, theaterId, date);
        successfulDates++;

        if (data.error || !data.results?.length) {
          await this.sleep(jitter(DELAY_BETWEEN_DATES_MS));
          continue;
        }

        for (const entry of data.results) {
          const movie = entry.movie;
          if (!movie?.title) continue;

          const key = String(movie.internalId ?? movie.title);

          if (!filmMap.has(key)) {
            filmMap.set(key, {
              film: {
                titre:         movie.title,
                titreOriginal: movie.originalTitle || undefined,
                synopsis:      movie.synopsis      || undefined,
                affiche:       movie.poster?.url   || undefined,
                duree:         parseRuntime(movie.runtime),
                genres:        movie.genres?.map((g) => g.tag) ?? [],
                realisateur:   movie.directors?.[0]?.fullName || undefined,
                sourceId:      String(movie.internalId ?? ""),
              },
              seances: [],
            });
          }

          const seances = filmMap.get(key)!.seances;
          const st = entry.showtimes ?? {};

          const VF_KEYS     = ["dubbed", "multiple", "multiple_st", "multiple_st_sme"];
          const VO_KEYS     = ["original"];
          const VOSTFR_KEYS = ["original_st", "original_st_sme"];

          const addSeances = (arr: AcShowtime[] | undefined, version: Version) => {
            if (!arr?.length) return;
            for (const s of arr) {
              if (!s.startsAt) continue;
              const dt = new Date(s.startsAt);
              if (isNaN(dt.getTime())) continue;
              const fmt = parseFormat(s.experience ?? s.projection?.[0] ?? null);
              seances.push({ dateHeure: dt, version, format: fmt });
            }
          };

          VF_KEYS.forEach((k)     => addSeances(st[k], Version.VF));
          VO_KEYS.forEach((k)     => addSeances(st[k], Version.VOSTFR));
          VOSTFR_KEYS.forEach((k) => addSeances(st[k], Version.VOSTFR));

          for (const [k, arr] of Object.entries(st)) {
            if (!VF_KEYS.includes(k) && !VO_KEYS.includes(k) && !VOSTFR_KEYS.includes(k)) {
              const v = k.startsWith("original") ? Version.VOSTFR : Version.VF;
              addSeances(arr, v);
            }
          }
        }
      } catch (err) {
        if (err instanceof RateLimitError) {
          rateLimitedDates++;
          // Toutes les tentatives 429 épuisées pour ce jour → on logue et continue
          this.log(`  ${theaterId} [${date}] — rate-limited après retries, on passe`, "warn");
        } else {
          this.log(`  ${theaterId} [${date}] — ${err}`, "warn");
        }
      }

      await this.sleep(jitter(DELAY_BETWEEN_DATES_MS));
    }

    const films = [...filmMap.values()].filter((f) => f.seances.length > 0);
    if (!info && films.length === 0) return { cinema: null, allRateLimited: rateLimitedDates === DAYS_AHEAD };

    const cinema: ScrapedCinema = {
      sourceId:   theaterId,
      nom:        info?.nom        ?? `Cinéma ${theaterId}`,
      adresse:    info?.adresse    ?? "",
      ville:      info?.ville      ?? "",
      codePostal: info?.codePostal ?? "",
      siteWeb:    `https://www.allocine.fr/seance/salle_gen_csalle=${theaterId}.html`,
      latitude:   info?.lat  ?? undefined,
      longitude:  info?.lng  ?? undefined,
      films,
    };

    const allRateLimited = successfulDates === 0 && rateLimitedDates > 0;
    return { cinema, allRateLimited };
  }

  // ── Infos cinéma via JSON-LD ───────────────────────────

  private async fetchTheaterInfo(
    ctx: BrowserContext,
    theaterId: string
  ): Promise<{
    nom: string;
    adresse: string;
    ville: string;
    codePostal: string;
    lat: number | null;
    lng: number | null;
  } | null> {
    const page = await ctx.newPage();
    try {
      const resp = await page.goto(
        `https://www.allocine.fr/seance/salle_gen_csalle=${theaterId}.html`,
        { waitUntil: "domcontentloaded", timeout: 20_000 }
      );
      if (!resp?.ok()) return null;

      return await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll(
          'script[type="application/ld+json"]'
        ));
        for (const script of scripts) {
          try {
            const d = JSON.parse(script.textContent ?? "");
            const type = d["@type"] as string | undefined;
            if (type === "MovieTheater" || type === "LocalBusiness") {
              return {
                nom:        d.name ?? "",
                adresse:    d.address?.streetAddress ?? "",
                ville:      d.address?.addressLocality ?? "",
                codePostal: d.address?.postalCode ?? "",
                lat:        d.geo?.latitude  ?? null,
                lng:        d.geo?.longitude ?? null,
              };
            }
          } catch { /**/ }
        }

        const nom =
          document.querySelector(".theater-title, h1")?.textContent?.trim() ?? "";
        const adresse =
          document
            .querySelector(
              ".header-theater-adress, [class*=theater-address], [itemprop=streetAddress]"
            )
            ?.textContent?.trim().replace(/\s+/g, " ") ?? "";
        const lat = parseFloat(
          (document.querySelector("[itemprop=latitude]") as HTMLMetaElement)?.content ?? ""
        );
        const lng = parseFloat(
          (document.querySelector("[itemprop=longitude]") as HTMLMetaElement)?.content ?? ""
        );

        return {
          nom,
          adresse,
          ville: "",
          codePostal: "",
          lat: isNaN(lat) ? null : lat,
          lng: isNaN(lng) ? null : lng,
        };
      });
    } catch {
      return null;
    } finally {
      await page.close().catch(() => {});
    }
  }

  // ── API JSON séances avec retry 429 ─────────────────

  /**
   * Appelle l'API séances avec backoff exponentiel sur les 429.
   * Lance RateLimitError si tous les retries sont épuisés.
   */
  private async fetchShowtimesWithRetry(
    ctx: BrowserContext,
    theaterId: string,
    date: string
  ): Promise<AcResponse> {
    let attempt = 0;

    while (attempt <= MAX_RETRIES_429) {
      try {
        return await this.fetchShowtimes(ctx, theaterId, date);
      } catch (err) {
        if (err instanceof RateLimitError) {
          attempt++;
          if (attempt > MAX_RETRIES_429) {
            // Plus de retries disponibles → propager RateLimitError
            throw err;
          }
          const backoff = BACKOFF_429_BASE_MS * Math.pow(2, attempt - 1);
          this.log(
            `  ⏳ 429 sur ${theaterId} [${date}] — retry ${attempt}/${MAX_RETRIES_429} ` +
            `dans ${backoff / 1000}s…`,
            "warn"
          );
          await this.sleep(backoff);
        } else {
          // Erreur non-429 → propager directement
          throw err;
        }
      }
    }

    // Ne devrait jamais arriver (satisfait TypeScript)
    throw new RateLimitError(`${theaterId}/${date}`);
  }

  // ── Requête HTTP brute séances ────────────────────────

  private async fetchShowtimes(
    ctx: BrowserContext,
    theaterId: string,
    date: string
  ): Promise<AcResponse> {
    const url = `https://www.allocine.fr/_/showtimes/theater-${theaterId}/d-${date}/`;

    const response = await ctx.request.get(url, {
      headers: {
        Referer:             `https://www.allocine.fr/seance/salle_gen_csalle=${theaterId}.html`,
        "X-Requested-With":  "XMLHttpRequest",
        Accept:              "application/json, text/plain, */*",
        "Accept-Language":   "fr-FR,fr;q=0.9,en;q=0.8",
        "Cache-Control":     "no-cache",
      },
      timeout: 15_000,
    });

    if (response.status() === 429) {
      throw new RateLimitError(url);
    }

    if (!response.ok()) {
      throw new Error(`HTTP ${response.status()} — ${url}`);
    }

    return (await response.json()) as AcResponse;
  }
}
