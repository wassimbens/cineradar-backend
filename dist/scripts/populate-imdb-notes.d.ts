/**
 * populate-imdb-notes.ts
 * ─────────────────────────────────────────────────────────────────
 * Pour chaque film en base :
 *   1. Si imdbId est déjà connu, utilise-le directement
 *   2. Sinon, récupère l'imdb_id depuis TMDB (si tmdbId disponible)
 *   3. Appelle OMDB pour obtenir imdbRating + imdbVotes
 *   4. Met à jour le film en base
 *
 * Usage :
 *   npx tsx src/scripts/populate-imdb-notes.ts [--dry-run] [--limit 100]
 *
 * Variables d'environnement requises :
 *   TMDB_API_KEY   — clé TMDB
 *   OMDB_API_KEY   — clé OMDB (gratuite sur omdbapi.com)
 * ─────────────────────────────────────────────────────────────────
 */
export {};
//# sourceMappingURL=populate-imdb-notes.d.ts.map