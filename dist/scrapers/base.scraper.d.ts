import { ScraperResult } from "./types.js";
export declare abstract class BaseScraper {
    /** Identifiant court de la source, ex: "ugc" */
    abstract readonly name: string;
    /** Délai minimum entre deux requêtes HTTP (anti-ban) */
    protected readonly delayMs: number;
    constructor();
    /**
     * Exécute le scraping complet.
     * Ne lance pas d'exception : les erreurs sont agrégées dans `result.errors`.
     */
    abstract scrape(): Promise<ScraperResult>;
    /**
     * Exécute `fn` avec retry automatique.
     *
     * @param fn       Fonction async à exécuter
     * @param context  Libellé affiché dans les logs (ex: "cinéma UGC Opéra")
     * @param attempts Nombre maximum de tentatives (défaut : MAX_ATTEMPTS)
     */
    protected withRetry<T>(fn: () => Promise<T>, context: string, attempts?: number): Promise<T>;
    /**
     * Attend `ms` millisecondes.
     */
    protected sleep(ms: number): Promise<void>;
    /**
     * Attend le délai anti-ban configuré via SCRAPER_DELAY_MS.
     */
    protected politeDelay(): Promise<void>;
    /**
     * Affiche un message de log préfixé avec le nom du scraper.
     */
    protected log(message: string, level?: "info" | "warn" | "error"): void;
    /**
     * Construit un ScraperResult vide (point de départ).
     */
    protected makeResult(): ScraperResult;
    /**
     * Ajoute une erreur non-bloquante au résultat et la logue.
     */
    protected addError(result: ScraperResult, message: string): void;
}
//# sourceMappingURL=base.scraper.d.ts.map