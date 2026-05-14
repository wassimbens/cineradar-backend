import { ScraperResult } from "../scrapers/types.js";
interface SaveStats {
    cinemasCreated: number;
    cinemasUpdated: number;
    filmsCreated: number;
    filmsUpdated: number;
    seancesCreated: number;
    seancesUpdated: number;
}
export declare class ScraperService {
    /**
     * Point d'entrée principal.
     * Persiste l'intégralité d'un ScraperResult en base.
     */
    save(result: ScraperResult): Promise<SaveStats>;
    private saveCinema;
    private saveFilm;
    private getSalleId;
    private saveCinemaFilm;
    /**
     * Détecte la chaîne de cinéma depuis le nom.
     */
    private detectChain;
    /**
     * Supprime les séances passées de plus de 24h pour garder la BDD propre.
     * Appelé après chaque scraping réussi.
     */
    cleanOldSeances(): Promise<number>;
}
export declare const scraperService: ScraperService;
export {};
//# sourceMappingURL=scraper.service.d.ts.map