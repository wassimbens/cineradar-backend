import { BaseScraper } from "./base.scraper.js";
import { ScraperResult } from "./types.js";
export declare class UgcScraper extends BaseScraper {
    readonly name = "ugc";
    private browser;
    private context;
    private launchBrowser;
    private closeBrowser;
    private newPage;
    /**
     * Effectue une requête GET depuis le contexte Playwright
     * (conserve les cookies de session obtenus lors du warmup).
     */
    private fetchHtml;
    private warmup;
    /**
     * Visite la page d'un cinéma avec chargement JS complet et extrait
     * son cinemaId numérique via plusieurs stratégies :
     *   1. Contexte JavaScript (window.cinemaId, data-attributes…)
     *   2. Patterns regex dans le HTML statique (ordre de priorité)
     * Utilise waitUntil:"load" pour laisser le JS s'exécuter entièrement.
     */
    private fetchCinemaNumericId;
    private fetchCinemaIds;
    private fetchFilmsForCinema;
    private fetchFilmMetadata;
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
    private fetchSeances;
    /**
     * Visite la page du cinéma pour extraire adresse, CP, coordonnées.
     * Utilise le JSON-LD si disponible.
     */
    private fetchCinemaDetails;
    scrape(): Promise<ScraperResult>;
}
//# sourceMappingURL=ugc.scraper.d.ts.map