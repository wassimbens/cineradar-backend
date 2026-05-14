/**
 * audit-posters-trailers.ts
 * ─────────────────────────────────────────────────────────────────
 * Audit générique des associations film ↔ TMDB.
 *
 * Pour chaque film de la base ayant un tmdbId :
 *  1. Fetch TMDB details (titre, année, réalisateur)
 *  2. Calcule un score de matching (titre + année + réalisateur)
 *  3. Si score faible → re-recherche TMDB et propose un meilleur match
 *  4. Met à jour tmdbId + affiche si --apply (sinon dry-run)
 *
 * Pour les films sans tmdbId :
 *  - Tente une recherche TMDB et associe si match haute-confiance
 *
 * Usage :
 *   npx tsx src/scripts/audit-posters-trailers.ts            # dry-run + rapport
 *   npx tsx src/scripts/audit-posters-trailers.ts --apply    # appliquer corrections
 *   npx tsx src/scripts/audit-posters-trailers.ts --limit 50 # limiter (debug)
 *   npx tsx src/scripts/audit-posters-trailers.ts --threshold 0.7 # seuil match
 * ─────────────────────────────────────────────────────────────────
 */
export {};
//# sourceMappingURL=audit-posters-trailers.d.ts.map