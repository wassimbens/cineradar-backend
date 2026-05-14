/**
 * lib/genres.ts
 * ─────────────────────────────────────────────────────────
 * Helper de normalisation des genres : convertit toutes les
 * variantes (anglais, MAJUSCULES, FR avec accents) vers une
 * forme canonique française unique. Utilisé par les scrapers
 * pour éviter d'introduire de nouveaux doublons.
 * ─────────────────────────────────────────────────────────
 */
/**
 * Normalise un genre unique vers sa forme canonique française.
 * Renvoie une chaîne vide si l'entrée est invalide.
 */
export declare function canonicalGenre(raw: string): string;
/**
 * Normalise + déduplique (case-insensitive) un tableau de genres.
 * Préserve l'ordre d'apparition.
 */
export declare function normalizeGenres(genres: string[] | null | undefined): string[];
//# sourceMappingURL=genres.d.ts.map