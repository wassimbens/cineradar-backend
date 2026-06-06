"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)(); // Charge .env avant tout le reste
// Updated: 2026-05-13
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const cookie_1 = __importDefault(require("@fastify/cookie"));
const helmet_1 = __importDefault(require("@fastify/helmet"));
const node_cron_1 = __importDefault(require("node-cron"));
const child_process_1 = require("child_process");
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
const stripe_js_1 = __importDefault(require("./routes/stripe.js"));
const notifications_js_1 = __importDefault(require("./routes/notifications.js"));
const listes_js_1 = __importDefault(require("./routes/listes.js"));
const messages_js_1 = __importDefault(require("./routes/messages.js"));
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
            ? ["https://cineradar.fr", "https://www.cineradar.fr", "https://cineradar-frontend.vercel.app"]
            : true,
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
        // Lancé en process isolé pour éviter l'OOM dans le process Fastify principal
        const child = (0, child_process_1.spawn)("node", ["dist/scripts/run-scraper.js"], {
            cwd: process.cwd(), shell: true, stdio: "inherit",
        });
        child.on("error", (err) => console.error("[ADMIN] Erreur scraping HTTP :", err.message));
        child.on("close", (code) => console.log(`[ADMIN] Scraping HTTP terminé (code ${code})`));
        return { message: "Scraping HTTP (UGC/AlloCiné/Pathé/MK2) lancé en arrière-plan" };
    });
    app.post("/admin/scrape/cgr", async (request, reply) => {
        const secret = request.headers["x-admin-secret"];
        if (secret !== process.env["ADMIN_SECRET"]) {
            return reply.code(401).send({ error: "Non autorisé" });
        }
        // Lancé en process isolé (Playwright/Chromium = ~300MB RAM)
        const child = (0, child_process_1.spawn)("node", ["dist/scripts/run-scraper.js", "cgr"], {
            cwd: process.cwd(), shell: true, stdio: "inherit",
        });
        child.on("error", (err) => console.error("[ADMIN] Erreur scraping CGR :", err.message));
        child.on("close", (code) => console.log(`[ADMIN] Scraping CGR terminé (code ${code})`));
        return { message: "Scraping CGR (Playwright) lancé en arrière-plan" };
    });
    // ── Endpoints de maintenance (déduplication, fix affiches) ──
    app.post("/admin/dedup/films", async (request, reply) => {
        const secret = request.headers["x-admin-secret"];
        if (secret !== process.env["ADMIN_SECRET"]) {
            return reply.code(401).send({ error: "Non autorisé" });
        }
        (0, child_process_1.spawn)("node", ["dist/scripts/dedup-films.js", "--apply"], {
            cwd: process.cwd(), shell: true, stdio: "inherit",
        });
        return { message: "Déduplication films lancée en arrière-plan (--apply)" };
    });
    app.post("/admin/dedup/cinemas", async (request, reply) => {
        const secret = request.headers["x-admin-secret"];
        if (secret !== process.env["ADMIN_SECRET"]) {
            return reply.code(401).send({ error: "Non autorisé" });
        }
        (0, child_process_1.spawn)("node", ["dist/scripts/dedup-cinemas.js"], {
            cwd: process.cwd(), shell: true, stdio: "inherit",
        });
        return { message: "Déduplication cinémas lancée en arrière-plan" };
    });
    app.post("/admin/fix/posters", async (request, reply) => {
        const secret = request.headers["x-admin-secret"];
        if (secret !== process.env["ADMIN_SECRET"]) {
            return reply.code(401).send({ error: "Non autorisé" });
        }
        (0, child_process_1.spawn)("node", ["dist/scripts/auto-fix-posters.js"], {
            cwd: process.cwd(), shell: true, stdio: "inherit",
        });
        return { message: "Fix affiches (affiches manquantes/cassées) lancé en arrière-plan" };
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
    await app.register(stripe_js_1.default, { prefix: "/api" });
    await app.register(notifications_js_1.default, { prefix: "/api" });
    await app.register(listes_js_1.default, { prefix: "/api" });
    await app.register(messages_js_1.default, { prefix: "/api" });
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
    // ─── Cron nocturne 3h00 (tous les scrapers via child_process) ───
    //
    //  Expression : "0 3 * * *" = chaque nuit à 03:00 (Europe/Paris)
    //  Lance `npm run scrape` en sous-processus non bloquant.
    //  Ce cron est complémentaire à registerScrapeJob() (06:00).
    node_cron_1.default.schedule("0 3 * * *", () => {
        const startedAt = new Date().toISOString();
        console.log(`[CRON 03:00] Démarrage du scraping nocturne — ${startedAt}`);
        const child = (0, child_process_1.spawn)("node", ["dist/scripts/run-scraper.js"], {
            cwd: process.cwd(),
            shell: true,
            stdio: "inherit",
        });
        child.on("error", (err) => {
            console.error("[CRON 03:00] Erreur au démarrage du processus :", err.message);
        });
        child.on("close", (code) => {
            const finishedAt = new Date().toISOString();
            if (code === 0) {
                console.log(`[CRON 03:00] Scraping nocturne terminé avec succès — ${finishedAt}`);
            }
            else {
                console.warn(`[CRON 03:00] Scraping nocturne terminé avec le code ${code} — ${finishedAt}`);
            }
        });
    }, { timezone: "Europe/Paris" });
    console.log('✅ Cron nocturne planifié : "0 3 * * *" (Europe/Paris)');
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