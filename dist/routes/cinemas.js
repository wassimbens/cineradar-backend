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
const nearbyQuerySchema = zod_1.z.object({
    lat: zod_1.z.coerce.number().min(-90).max(90),
    lng: zod_1.z.coerce.number().min(-180).max(180),
    radius: zod_1.z.coerce.number().min(0.5).max(100).default(15), // km
    limit: zod_1.z.coerce.number().int().min(1).max(50).default(10),
});
/** Formule de Haversine — retourne la distance en km */
function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
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
    // ── GET /api/cinemas/nearby?lat=&lng=&radius= ────────
    /**
     * Cinémas proches d'une position géographique, triés par distance.
     * @query lat    {number} Latitude
     * @query lng    {number} Longitude
     * @query radius {number} Rayon en km (défaut 15)
     * @query limit  {number} Nombre max de résultats (défaut 10)
     */
    fastify.get("/cinemas/nearby", async (request, reply) => {
        const parsed = nearbyQuerySchema.safeParse(request.query);
        if (!parsed.success) {
            return reply.code(400).send({ error: "Paramètres invalides", details: parsed.error.flatten().fieldErrors });
        }
        const { lat, lng, radius, limit } = parsed.data;
        const cacheKey = `cinemas:nearby:${lat.toFixed(3)}:${lng.toFixed(3)}:${radius}`;
        const cached = await (0, redis_js_1.cacheGet)(cacheKey);
        if (cached) {
            reply.header("X-Cache", "HIT");
            return cached;
        }
        // Récupérer tous les cinémas avec coordonnées
        const all = await cinemas_service_js_1.cinemasService.getCinemasByVille(""); // all = pas de filtre ville
        const nearby = all
            .filter(c => c.latitude != null && c.longitude != null)
            .map(c => ({
            ...c,
            distanceKm: haversineKm(lat, lng, c.latitude, c.longitude),
        }))
            .filter(c => c.distanceKm <= radius)
            .sort((a, b) => a.distanceKm - b.distanceKm)
            .slice(0, limit);
        await (0, redis_js_1.cacheSet)(cacheKey, nearby, 60 * 5); // 5 min (position change fréquente)
        reply.header("X-Cache", "MISS");
        return nearby;
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