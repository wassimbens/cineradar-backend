"use strict";
// ─────────────────────────────────────────────────────────
//  Routes Cinémas
//
//  GET /api/cinemas?ville=          Liste des cinémas par ville
//  GET /api/cinemas/:id             Fiche complète d'un cinéma
//  GET /api/cinemas/:id/programme   Programme du jour (ou d'une date)
//                                   ?date=YYYY-MM-DD
// ─────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
const zod_1 = require("zod");
const cinemas_service_js_1 = require("../services/cinemas.service.js");
const redis_js_1 = require("../lib/redis.js");
const TTL = 60 * 30; // 30 minutes
// ── Schémas de validation ─────────────────────────────────
const villeQuerySchema = zod_1.z.object({
    ville: zod_1.z.string().max(100).trim().optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(200).optional(),
    offset: zod_1.z.coerce.number().int().min(0).optional(),
});
const programmeQuerySchema = zod_1.z.object({
    date: zod_1.z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Format attendu : YYYY-MM-DD")
        .optional(),
});
// ── Plugin Fastify ────────────────────────────────────────
const cinemasRoutes = async (fastify) => {
    // ── GET /api/cinemas?ville= ───────────────────────────
    /**
     * Liste les cinémas d'une ville, triés par nombre de séances du jour.
     * @query ville {string} Nom de la ville (ex: "Paris")
     * @returns CinemaSummary[]
     */
    fastify.get("/cinemas", async (request, reply) => {
        const parsed = villeQuerySchema.safeParse(request.query);
        if (!parsed.success) {
            return reply.code(400).send({
                error: "Paramètre invalide",
                details: parsed.error.flatten().fieldErrors,
            });
        }
        const { ville = "", limit, offset } = parsed.data;
        const cacheKey = `cinemas:list:${ville.toLowerCase()}:${limit ?? ""}:${offset ?? ""}`;
        const cached = await (0, redis_js_1.cacheGet)(cacheKey);
        if (cached) {
            reply.header("X-Cache", "HIT");
            return cached;
        }
        let cinemas = await cinemas_service_js_1.cinemasService.getCinemasByVille(ville);
        if (offset)
            cinemas = cinemas.slice(offset);
        if (limit)
            cinemas = cinemas.slice(0, limit);
        await (0, redis_js_1.cacheSet)(cacheKey, cinemas, TTL);
        reply.header("X-Cache", "MISS");
        return cinemas;
    });
    // ── GET /api/cinemas/:id ──────────────────────────────
    /**
     * Fiche complète d'un cinéma avec ses salles.
     * @param id {string} Identifiant Prisma du cinéma
     * @returns Cinema | 404
     */
    fastify.get("/cinemas/:id", async (request, reply) => {
        const { id } = request.params;
        const cacheKey = `cinemas:detail:${id}`;
        const cached = await (0, redis_js_1.cacheGet)(cacheKey);
        if (cached) {
            reply.header("X-Cache", "HIT");
            return cached;
        }
        const cinema = await cinemas_service_js_1.cinemasService.getCinemaById(id);
        if (!cinema) {
            return reply.code(404).send({ error: "Cinéma introuvable" });
        }
        await (0, redis_js_1.cacheSet)(cacheKey, cinema, TTL);
        reply.header("X-Cache", "MISS");
        return cinema;
    });
    // ── GET /api/cinemas/:id/programme ────────────────────
    /**
     * Programme d'un cinéma pour une date, groupé par film.
     * @param id   {string} Identifiant Prisma du cinéma
     * @query date {string} Date "YYYY-MM-DD" (défaut: aujourd'hui)
     * @returns ProgrammeLigne[]
     */
    fastify.get("/cinemas/:id/programme", async (request, reply) => {
        const { id } = request.params;
        const parsed = programmeQuerySchema.safeParse(request.query);
        if (!parsed.success) {
            return reply.code(400).send({
                error: "Paramètre invalide",
                details: parsed.error.flatten().fieldErrors,
            });
        }
        const { date } = parsed.data;
        const cacheKey = `cinemas:${id}:programme:${date ?? "today"}`;
        const cached = await (0, redis_js_1.cacheGet)(cacheKey);
        if (cached) {
            reply.header("X-Cache", "HIT");
            return cached;
        }
        // Vérifier que le cinéma existe
        const cinema = await cinemas_service_js_1.cinemasService.getCinemaById(id);
        if (!cinema) {
            return reply.code(404).send({ error: "Cinéma introuvable" });
        }
        const programme = await cinemas_service_js_1.cinemasService.getCinemaProgramme(id, date);
        await (0, redis_js_1.cacheSet)(cacheKey, programme, TTL);
        reply.header("X-Cache", "MISS");
        return programme;
    });
};
exports.default = cinemasRoutes;
//# sourceMappingURL=cinemas.js.map