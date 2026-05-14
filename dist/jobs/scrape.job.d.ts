/**
 * Exécute tous les scrapers enregistrés et persiste les résultats.
 * Peut être appelé manuellement (ex: via endpoint d'admin) ou par le cron.
 */
export declare function runAllScrapers(): Promise<void>;
/**
 * Enregistre le job cron quotidien à 06:00.
 * À appeler au démarrage du serveur.
 */
export declare function registerScrapeJob(): void;
//# sourceMappingURL=scrape.job.d.ts.map