/**
 * Exécute les scrapers HTTP (UGC, AlloCiné, Pathé, MK2).
 * Appelé à 06:00 ou manuellement.
 */
export declare function runAllScrapers(): Promise<void>;
/**
 * Exécute le scraper CGR (Playwright).
 * Appelé à 09:00, après que le batch HTTP ait libéré la mémoire.
 */
export declare function runCgrScraper(): Promise<void>;
/**
 * Enregistre les deux jobs cron :
 *   - 06:00 → scrapers HTTP (UGC, AlloCiné, Pathé, MK2)
 *   - 09:00 → scraper CGR (Playwright) isolé pour éviter l'OOM
 */
export declare function registerScrapeJob(): void;
//# sourceMappingURL=scrape.job.d.ts.map