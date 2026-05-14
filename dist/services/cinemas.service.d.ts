export interface CinemaSummary {
    id: string;
    nom: string;
    adresse: string;
    ville: string;
    codePostal: string;
    latitude: number | null;
    longitude: number | null;
    siteWeb: string | null;
    telephone: string | null;
    chaine: string | null;
    sallesCount: number;
    seancesAujourdhui: number;
}
/** Une ligne du programme : un film avec ses séances du jour */
export interface ProgrammeLigne {
    film: {
        id: string;
        titre: string;
        titreOriginal: string | null;
        affiche: string | null;
        duree: number | null;
        genres: string[];
        realisateur: string | null;
    };
    seances: {
        id: string;
        dateHeure: Date;
        version: string;
        format: string | null;
        prix: number | null;
        salleNom: string;
    }[];
}
export declare class CinemasService {
    /**
     * Liste les cinémas d'une ville, triés par nombre de séances du jour.
     *
     * GET /api/cinemas?ville=Paris
     */
    getCinemasByVille(ville: string): Promise<CinemaSummary[]>;
    /**
     * Retourne les informations complètes d'un cinéma.
     *
     * Utilisé par la fiche cinéma.
     */
    getCinemaById(id: string): Promise<({
        salles: {
            nom: string;
            id: string;
            capacite: number | null;
        }[];
    } & {
        nom: string;
        id: string;
        adresse: string;
        ville: string;
        codePostal: string;
        siteWeb: string | null;
        latitude: number | null;
        longitude: number | null;
        telephone: string | null;
        chaine: string | null;
        createdAt: Date;
        updatedAt: Date;
    }) | null>;
    /**
     * Retourne le programme d'un cinéma pour une date donnée,
     * groupé par film et trié par premier horaire.
     *
     * GET /api/cinemas/:id/programme?date=2026-04-07
     */
    getCinemaProgramme(cinemaId: string, dateStr?: string): Promise<ProgrammeLigne[]>;
}
export declare const cinemasService: CinemasService;
//# sourceMappingURL=cinemas.service.d.ts.map