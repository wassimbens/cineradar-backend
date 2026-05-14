/**
 * clean-ugc-duplicates.ts
 * ────────────────────────────────────────────────────────────
 * Supprime les séances UGC dupliquées causées par l'API UGC qui retourne
 * les séances de TOUS les cinémas pour un film donné, pas seulement le cinéma demandé.
 *
 * Symptôme : même film, même salle, mêmes N horaires en rafale (< 10 min d'écart).
 *
 * Stratégie : pour chaque cinéma × film × jour × version,
 *   regrouper les séances trop proches (< 10 min) et n'en garder qu'une.
 *
 * Usage :
 *   npx tsx src/scripts/clean-ugc-duplicates.ts [--dry-run]
 */
export {};
//# sourceMappingURL=clean-ugc-duplicates.d.ts.map