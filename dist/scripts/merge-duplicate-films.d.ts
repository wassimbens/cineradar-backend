/**
 * merge-duplicate-films.ts
 * ─────────────────────────────────────────────────────────
 * Fusionne les films en double créés par des différences de
 * casse / accents / ponctuation entre les scrapers.
 *
 * Exemples de doublons :
 *   "SUPER MARIO GALAXY, LE FILM"  ↔  "Super Mario Galaxy Le Film"
 *   "LA VENUS ELECTRIQUE"          ↔  "La Vénus électrique"
 *   "C'EST QUOI L'AMOUR ?"         ↔  "C'est quoi l'amour ?"
 *
 * Stratégie :
 *   1. Charger tous les films
 *   2. Grouper par titre normalisé (lowercase + no accents + no punctuation)
 *   3. Pour chaque groupe avec ≥ 2 films, désigner un canonique :
 *      → préférer celui avec tmdbId, puis le plus de séances, puis le plus ancien
 *   4. Transférer séances, alertes, favoris, watchlist, avis vers le canonique
 *   5. Supprimer les doublons
 *
 * Usage :
 *   node --loader ts-node/esm src/scripts/merge-duplicate-films.ts [--dry-run]
 */
export {};
//# sourceMappingURL=merge-duplicate-films.d.ts.map