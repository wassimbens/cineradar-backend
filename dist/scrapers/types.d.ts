import { Version } from "@prisma/client";
export interface ScrapedFilm {
    /** Titre dans la langue de diffusion */
    titre: string;
    /** Titre original (si différent) */
    titreOriginal?: string;
    /** Durée en minutes */
    duree?: number;
    genres?: string[];
    realisateur?: string;
    synopsis?: string;
    /** URL absolue de l'affiche */
    affiche?: string;
    /** Identifiant interne de la source (ex : ugcFilmId = "17706") */
    sourceId?: string;
}
export interface ScrapedSeance {
    dateHeure: Date;
    version: Version;
    /** "2D" | "3D" | "IMAX" | "Dolby Atmos" */
    format?: string;
    /** Nom de la salle, ex: "Salle 3" */
    salleNom?: string;
    prix?: number;
}
export interface ScrapedCinemaFilm {
    film: ScrapedFilm;
    seances: ScrapedSeance[];
}
export interface ScrapedCinema {
    /** Identifiant dans la source, ex: "41" pour ugc.fr */
    sourceId: string;
    nom: string;
    adresse: string;
    ville: string;
    codePostal: string;
    siteWeb?: string;
    latitude?: number;
    longitude?: number;
    films: ScrapedCinemaFilm[];
}
export interface ScraperResult {
    /** Identifiant de la source, ex: "ugc" */
    source: string;
    scrapedAt: Date;
    cinemas: ScrapedCinema[];
    /** Erreurs non-bloquantes (un cinéma qui a échoué, etc.) */
    errors: string[];
}
//# sourceMappingURL=types.d.ts.map