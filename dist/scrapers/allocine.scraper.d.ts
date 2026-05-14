import { BaseScraper } from "./base.scraper.js";
import { ScraperResult } from "./types.js";
export declare class AllocineScraper extends BaseScraper {
    readonly name = "allocine";
    /** Nombre de cinémas consécutifs 100% rate-limités (circuit-breaker) */
    private consecutiveRateLimited;
    scrape(): Promise<ScraperResult>;
    private discoverTheaters;
    private scrapeTheater;
    private fetchTheaterInfo;
    /**
     * Appelle l'API séances avec backoff exponentiel sur les 429.
     * Lance RateLimitError si tous les retries sont épuisés.
     */
    private fetchShowtimesWithRetry;
    private fetchShowtimes;
}
//# sourceMappingURL=allocine.scraper.d.ts.map