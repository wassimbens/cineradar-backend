export interface CreateAlerteInput {
    email: string;
    filmTitre: string;
    ville: string;
    rayon: number;
}
export declare class AlertesService {
    /**
     * Crée une alerte en base de données.
     * Si une alerte identique (même email + filmTitre + ville) existe déjà,
     * on la retourne sans doublon.
     */
    createAlerte(input: CreateAlerteInput): Promise<{
        alerte: {
            id: string;
            ville: string;
            filmId: string | null;
            createdAt: Date;
            updatedAt: Date;
            userId: string | null;
            email: string;
            filmTitre: string;
            rayon: number;
            active: boolean;
        };
        created: boolean;
    }>;
    /**
     * Désactive une alerte (désabonnement).
     */
    deactivateAlerte(id: string): Promise<{
        id: string;
        ville: string;
        filmId: string | null;
        createdAt: Date;
        updatedAt: Date;
        userId: string | null;
        email: string;
        filmTitre: string;
        rayon: number;
        active: boolean;
    }>;
    /**
     * Récupère toutes les alertes actives pour un email.
     */
    getAlertesByEmail(email: string): Promise<{
        id: string;
        ville: string;
        filmId: string | null;
        createdAt: Date;
        updatedAt: Date;
        userId: string | null;
        email: string;
        filmTitre: string;
        rayon: number;
        active: boolean;
    }[]>;
}
export declare const alertesService: AlertesService;
//# sourceMappingURL=alertes.service.d.ts.map