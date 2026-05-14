// ─────────────────────────────────────────────────────────
//  GET /api/stats
//  Retourne le nombre total de films, cinémas et séances futures.
// ─────────────────────────────────────────────────────────

import { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { cacheGet, cacheSet } from "../lib/redis.js";

const TTL = 60 * 15; // 15 minutes

const statsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/stats", async (_request, reply) => {
    const cacheKey = "global:stats";

    const cached = await cacheGet(cacheKey);
    if (cached) {
      reply.header("X-Cache", "HIT");
      return cached;
    }

    const now = new Date();
    const [films, cinemas, seances] = await Promise.all([
      prisma.film.count(),
      prisma.cinema.count(),
      prisma.seance.count({ where: { dateHeure: { gte: now } } }),
    ]);

    const stats = { films, cinemas, seances };
    await cacheSet(cacheKey, stats, TTL);
    reply.header("X-Cache", "MISS");
    return stats;
  });
};

export default statsRoutes;
