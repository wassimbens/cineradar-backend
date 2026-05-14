import { Version } from "@prisma/client";
export interface FilmSummary {
    id: string;
    titre: string;
    titreOriginal: string | null;
    affiche: string | null;
    duree: number | null;
    genres: string[];
    realisateur: string | null;
    acteurs: string[];
    annee: number | null;
    tmdbNote?: number | null;
    imdbNote?: number | null;
    imdbId?: string | null;
    imdbVotes?: number | null;
    seancesCount: number;
}
export interface SeanceWithCinema {
    id: string;
    dateHeure: Date;
    version: Version;
    format: string | null;
    prix: number | null;
    salle: {
        id: string;
        nom: string;
        cinema: {
            id: string;
            nom: string;
            adresse: string;
            ville: string;
            codePostal: string;
            latitude: number | null;
            longitude: number | null;
        };
    };
}
/** Séances d'un film regroupées par cinéma */
export interface SeancesParCinema {
    cinema: {
        id: string;
        nom: string;
        adresse: string;
        ville: string;
        codePostal: string;
        latitude: number | null;
        longitude: number | null;
    };
    seances: {
        id: string;
        dateHeure: Date;
        version: Version;
        format: string | null;
        prix: number | null;
        salleNom: string;
    }[];
}
export type CatalogSort = "titre" | "annee_desc" | "annee_asc" | "seances";
export interface CatalogFilters {
    q?: string;
    genre?: string;
    /** Décennie, ex: 1990 → films de 1990 à 1999 */
    decennie?: number;
    sort?: CatalogSort;
    page?: number;
    limit?: number;
}
export interface CatalogResult {
    films: FilmSummary[];
    total: number;
    page: number;
    totalPages: number;
}
export interface SeanceFilters {
    ville?: string;
    /** ISO date string "YYYY-MM-DD" — si absent, on prend aujourd'hui */
    date?: string;
    version?: Version;
}
export declare class FilmsService {
    /**
     * Recherche des films par titre (insensible à la casse).
     * Retourne aussi le nombre de séances actives pour trier par popularité.
     *
     * GET /api/films?q=dune
     */
    searchFilms(q: string): Promise<FilmSummary[]>;
    /**
     * Catalogue paginé avec filtres genre/décennie/sort.
     * GET /api/films?genre=Action&decennie=1990&sort=annee_desc&page=1&limit=48
     */
    getCatalogFilms(filters: CatalogFilters): Promise<CatalogResult>;
    /**
     * Top films "En ce moment au cinéma".
     *
     * Algorithme :
     *  - Pool A : films avec séances dans les 14 prochains jours
     *  - Pool B : films récents (annee >= currentYear - 1) les plus populaires TMDB
     *  - Fusion et déduplications des deux pools
     *  - Score = min(séances_14j, 50) * 1.5 + tmdbPopularite * 0.5
     *    → les films très populaires (type blockbuster) remontent même sans beaucoup de séances
     *  - Maximum 2 "classiques" (annee <= currentYear - 3) dans le résultat final
     */
    getTrendingFilms(limit?: number): Promise<FilmSummary[]>;
    /**
     * Films classiques pour la section "À redécouvrir" de la home.
     *
     * Règle stricte : uniquement les classiques (annee <= currentYear - 3)
     * qui ont des séances actives dans les 30 prochains jours.
     * Triés par popularité : imdbNote × log10(imdbVotes + 10),
     * avec fallback sur tmdbNote quand IMDb n'est pas encore enrichi.
     * → Le Parrain (9.2/10, 1.9M votes, score ≈ 58) avant un film méconnu.
     */
    getClassicFilms(limit?: number): Promise<FilmSummary[]>;
    /**
     * Tous les films classiques pour la page dédiée.
     * Organisé par réalisateur puis par décennie.
     */
    getAllClassicFilms(): Promise<FilmSummary[]>;
    /**
     * Retourne un film complet avec son synopsis et ses acteurs.
     *
     * Utilisé par la fiche film.
     */
    getFilmById(id: string): Promise<{
        titre: string;
        titreOriginal: string | null;
        duree: number | null;
        genres: string[];
        realisateur: string | null;
        synopsis: string | null;
        affiche: string | null;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        acteurs: string[];
        annee: number | null;
        tmdbId: string | null;
        imdbId: string | null;
        tmdbPopularite: number;
        tmdbNote: number | null;
        imdbNote: number | null;
        imdbVotes: number | null;
    } | null>;
    /**
     * Retourne les séances d'un film, groupées par cinéma.
     * Filtres optionnels : ville, date, version.
     *
     * GET /api/films/:id/seances?ville=Paris&date=2026-04-07&version=VO
     */
    getFilmSeances(filmId: string, filters: SeanceFilters): Promise<SeancesParCinema[]>;
}
export declare const filmsService: FilmsService;
//# sourceMappingURL=films.service.d.ts.map