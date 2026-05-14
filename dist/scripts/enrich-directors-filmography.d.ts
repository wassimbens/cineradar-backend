/**
 * enrich-directors-filmography.ts
 * ─────────────────────────────────────────────────────────────────
 * Pour chaque réalisateur présent en base, récupère sa filmographie
 * complète depuis TMDB et ajoute les films manquants.
 *
 * Heuristiques "film sorti en salle" (pas de court-métrage, pas de
 * direct-to-video) :
 *   - vote_count >= 25   (les courts-métrages ont rarement autant de votes)
 *   - poster_path non nul
 *   - runtime > 45 min si disponible (détail TMDB)
 *   - adult === false
 *
 * Usage :
 *   npx tsx src/scripts/enrich-directors-filmography.ts [--dry-run] [--director "Denis Villeneuve"]
 * ─────────────────────────────────────────────────────────────────
 */
export {};
//# sourceMappingURL=enrich-directors-filmography.d.ts.map