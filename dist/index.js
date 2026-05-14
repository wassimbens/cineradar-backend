"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)(); // Charge .env avant tout le reste
// Updated: 2026-05-12
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const cookie_1 = __importDefault(require("@fastify/cookie"));
const helmet_1 = __importDefault(require("@fastify/helmet"));
const redis_js_1 = require("./lib/redis.js");
const prisma_js_1 = require("./lib/prisma.js");
const scrape_job_js_1 = require("./jobs/scrape.job.js");
const films_js_1 = __importDefault(require("./routes/films.js"));
const cinemas_js_1 = __importDefault(require("./routes/cinemas.js"));
const search_js_1 = __importDefault(require("./routes/search.js"));
const alertes_js_1 = __importDefault(require("./routes/alertes.js"));
const stats_js_1 = __importDefault(require("./routes/stats.js"));
const profil_js_1 = __importDefault(require("./routes/profil.js"));
const auth_js_1 = __importDefault(require("./routes/auth.js"));
const users_js_1 = __importDefault(require("./routes/users.js"));
const PORT = Number(process.env["PORT"] ?? 3001);
const HOST = process.env["NODE_ENV"] === "production" ? "0.0.0.0" : "127.0.0.1";
const app = (0, fastify_1.default)({
    logger: {
        transport: process.env["NODE_ENV"] === "development"
            ? { target: "pino-pretty", options: { colorize: true } }
            : undefined,
    },
});
// ─── Démarrage ───────────────────────────────────────────
async function start() {
    // Plugins
    await app.register(cors_1.default, {
        origin: process.env["NODE_ENV"] === "production"
            ? process.env["FRONTEND_URL"]
            : true, // dev : autorise tous les ports (3000, 3002, etc.)
        credentials: true,
    });
    // En-têtes de sécurité HTTP (Content-Security-Policy, etc.)
    await app.register(helmet_1.default, {
        contentSecurityPolicy: false, // géré par le frontend Next.js
        crossOriginEmbedderPolicy: false, // requis pour les iframes YouTube (trailers)
    });
    await app.register(cookie_1.default, {
        secret: process.env["JWT_SECRET"] ?? "cineradar-secret",
    });
    // Routes système
    app.get("/health", async () => ({
        status: "ok",
        timestamp: new Date().toISOString(),
    }));
    app.post("/admin/scrape", async (request, reply) => {
        const secret = request.headers["x-admin-secret"];
        if (secret !== process.env["ADMIN_SECRET"]) {
            return reply.code(401).send({ error: "Non autorisé" });
        }
        (0, scrape_job_js_1.runAllScrapers)().catch((err) => console.error("[ADMIN] Erreur scraping manuel :", err));
        return { message: "Scraping lancé en arrière-plan" };
    });
    // Routes métier
    await app.register(films_js_1.default, { prefix: "/api" });
    await app.register(cinemas_js_1.default, { prefix: "/api" });
    await app.register(search_js_1.default, { prefix: "/api" });
    await app.register(alertes_js_1.default, { prefix: "/api" });
    await app.register(stats_js_1.default, { prefix: "/api" });
    await app.register(profil_js_1.default, { prefix: "/api" });
    await app.register(auth_js_1.default, { prefix: "/api" });
    await app.register(users_js_1.default, { prefix: "/api" });
    // Connexions externes
    await (0, redis_js_1.connectRedis)();
    await app.listen({ port: PORT, host: HOST });
    console.log(`\n🚀 CinéRadar API démarrée sur http://${HOST}:${PORT}\n`);
    console.log("  Routes disponibles :");
    console.log("  GET  /health");
    console.log("  GET  /api/films?q=");
    console.log("  GET  /api/films/:id");
    console.log("  GET  /api/films/:id/seances");
    console.log("  GET  /api/cinemas?ville=");
    console.log("  GET  /api/cinemas/:id");
    console.log("  GET  /api/cinemas/:id/programme");
    console.log("  GET  /api/search?q=");
    console.log("  POST /admin/scrape\n");
    (0, scrape_job_js_1.registerScrapeJob)();
}
// ─── Arrêt propre ────────────────────────────────────────
const shutdown = async () => {
    console.log("\n⏹  Arrêt du serveur…");
    await app.close();
    await prisma_js_1.prisma.$disconnect();
    process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
start().catch((err) => {
    console.error("Erreur au démarrage :", err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map