export interface SendEmailOptions {
    to: string;
    subject: string;
    html: string;
}
/**
 * Envoie un email via l'API Resend.
 * Si RESEND_API_KEY n'est pas configuré, logue simplement en console.
 */
export declare function sendEmail(options: SendEmailOptions): Promise<void>;
export declare function emailNotificationAlerte(params: {
    filmTitre: string;
    filmAffiche: string | null;
    ville: string;
    rayon: number;
    cinemas: {
        nom: string;
        adresse: string;
        seances: {
            dateHeure: string;
            version: string;
            format?: string;
        }[];
    }[];
    alerteId: string;
    siteUrl?: string;
}): {
    subject: string;
    html: string;
};
export declare function emailConfirmationInscription(params: {
    nom: string | null;
    verifyUrl: string;
}): {
    subject: string;
    html: string;
};
export declare function emailResetMotDePasse(params: {
    nom: string | null;
    resetUrl: string;
}): {
    subject: string;
    html: string;
};
export declare function emailConfirmationAlerte(params: {
    filmTitre: string;
    ville: string;
    rayon: number;
    email: string;
    alerteId?: string;
}): {
    subject: string;
    html: string;
};
//# sourceMappingURL=email.d.ts.map