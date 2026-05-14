"use strict";
// ─────────────────────────────────────────────────────────
//  GET /api/stats
//  Retourne le nombre total de films, cinémas et séances futures.
// ─────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_js_1 = require("../lib/prisma.js");
const redis_js_1 = require("../lib/redis.js");
const TTL = 60 * 15; // 15 minutes
const statsRoutes = async (fastify) => {
    fastify.get("/stats", async (_request, reply) => {
        const cacheKey = "global:stats";
        const cached = await (0, redis_js_1.cacheGet)(cacheKey);
        if (cached) {
            reply.header("X-Cache", "HIT");
            return cached;
        }
        const now = new Date();
        const [films, cinemas, seances] = await Promise.all([
            prisma_js_1.prisma.film.count(),
            prisma_js_1.prisma.cinema.count(),
            prisma_js_1.prisma.seance.count({ where: { dateHeure: { gte: now } } }),
        ]);
        const stats = { films, cinemas, seances };
        await (0, redis_js_1.cacheSet)(cacheKey, stats, TTL);
        reply.header("X-Cache", "MISS");
        return stats;
    });
};
exports.default = statsRoutes;
//# sourceMappingURL=stats.js.map