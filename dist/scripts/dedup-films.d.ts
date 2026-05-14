/**
 * dedup-films.ts
 * ─────────────────────────────────────────────────────────────────
 * Détecte et fusionne les films en doublon dans la base. Un film est
 * considéré comme doublon d'un autre si :
 *   - Ils ont le même tmdbId (ne peut pas arriver vu l'unique constraint)
 *   - OU ils ont le même titre normalisé OU titre original normalisé
 *     ET la même année OU le même réalisateur
 *
 * Stratégie de fusion :
 *   - Garder le film "canonique" (avec tmdbId + le plus de séances)
 *   - Déplacer toutes les relations (séances, avis, films vus, favoris,
 *     watchlist) vers le canonique
 *   - Supprimer le doublon
 *
 * Usage :
 *   npx tsx src/scripts/dedup-films.ts            # dry-run
 *   npx tsx src/scripts/dedup-films.ts --apply    # appliquer
 * ─────────────────────────────────────────────────────────────────
 */
export {};
//# sourceMappingURL=dedup-films.d.ts.map