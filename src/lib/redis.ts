import { createClient } from "redis";

// Redis est optionnel : si non configuré, le cache est simplement désactivé
let redis: ReturnType<typeof createClient> | null = null;

export async function connectRedis(): Promise<void> {
  const REDIS_URL = process.env["REDIS_URL"];
  if (!REDIS_URL) {
    console.warn("[Redis] REDIS_URL non défini — cache désactivé");
    return;
  }

  redis = createClient({ url: REDIS_URL });

  redis.on("error", (err) => {
    console.error("[Redis] Erreur de connexion :", err);
  });

  try {
    await redis.connect();
    console.log("[Redis] Connecté");
  } catch (err) {
    console.warn("[Redis] Impossible de se connecter — cache désactivé :", err);
    redis = null;
  }
}

// ─── Helpers cache ────────────────────────────────────────

const DEFAULT_TTL = 60 * 30; // 30 minutes

/**
 * Lit une valeur depuis le cache Redis.
 * Retourne null si Redis indisponible ou clé absente.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Écrit une valeur dans le cache Redis.
 * Ne fait rien si Redis est indisponible.
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  ttl: number = DEFAULT_TTL
): Promise<void> {
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(value), { EX: ttl });
  } catch {
    // Échec silencieux
  }
}

/**
 * Invalide une entrée du cache.
 */
export async function cacheDel(key: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.del(key);
  } catch {
    // Échec silencieux
  }
}
