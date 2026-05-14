/**
 * complete-franchises.ts
 * ─────────────────────────────────────────────────────────────────
 * Pour chaque film en base appartenant à une "collection" TMDB
 * (Star Wars, Le Seigneur des anneaux, Le Parrain, Harry Potter,
 * James Bond, Mission Impossible, Indiana Jones, MCU, etc.),
 * ajoute tous les films manquants de la collection.
 *
 * Algorithme :
 *   1. Pour chaque film avec tmdbId, récupère TMDB detail
 *   2. Si belongs_to_collection présent, fetch /collection/{id}
 *   3. Pour chaque film de la collection absent en base, l'ajoute
 *
 * Usage :
 *   npx tsx src/scripts/complete-franchises.ts [--dry-run]
 * ─────────────────────────────────────────────────────────────────
 */
export {};
//# sourceMappingURL=complete-franchises.d.ts.map