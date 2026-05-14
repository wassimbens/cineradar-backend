/**
 * dedup-cinemas.ts
 * ─────────────────────────────────────────────────────────────────
 * Fusionne les cinémas en double (créés par plusieurs scrapers).
 *
 * Stratégie :
 *  1. Grouper les cinémas par nom normalisé
 *  2. Pour chaque groupe : garder le "canonique" (plus de salles)
 *  3. Déplacer les salles des doublons vers le canonique
 *  4. Supprimer les cinémas vides restants
 *
 * Usage :
 *   npx tsx src/scripts/dedup-cinemas.ts [--dry-run]
 * ─────────────────────────────────────────────────────────────────
 */
export {};
//# sourceMappingURL=dedup-cinemas.d.ts.map