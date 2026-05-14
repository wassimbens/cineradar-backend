export declare function connectRedis(): Promise<void>;
/**
 * Lit une valeur depuis le cache Redis.
 * Retourne null si Redis indisponible ou clé absente.
 */
export declare function cacheGet<T>(key: string): Promise<T | null>;
/**
 * Écrit une valeur dans le cache Redis.
 * Ne fait rien si Redis est indisponible.
 */
export declare function cacheSet<T>(key: string, value: T, ttl?: number): Promise<void>;
/**
 * Invalide une entrée du cache.
 */
export declare function cacheDel(key: string): Promise<void>;
//# sourceMappingURL=redis.d.ts.map