import { config } from "dotenv";
config(); // Charge .env avant tout le reste
// Updated: 2026-05-13

import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import cron from "node-cron";
import { spawn } from "child_process";
import { connectRedis } from "./lib/redis.js";
import { prisma } from "./lib/prisma.js";
import { registerScrapeJob, runAllScrapers } from "./jobs/scrape.job.js";
import filmsRoutes from "./routes/films.js";
import cinemasRoutes from "./routes/cinemas.js";
import searchRoutes from "./routes/search.js";
import alertesRoutes from "./routes/alertes.js";
import statsRoutes from "./routes/stats.js";
import profilRoutes from "./routes/profil.js";
import authRoutes from "./routes/auth.js";
import usersRoutes from "./routes/users.js";
// import stripeRoutes from "./routes/stripe.js"; // ⏸ Désactivé temporairement (sera activé après URSSAF + SIRET)
import notifRoutes from "./routes/notifications.js";
import listesRoutes from "./routes/listes.js";

const PORT = Number(process.env["PORT"] ?? 3001);
const HOST = process.env["NODE_ENV"] === "production" ? "0.0.0.0" : "127.0.0.1";

const app = Fastify({
  logger: {
    transport:
      process.env["NODE_ENV"] === "development"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  },
});

// ─── Démarrage ───────────────────────────────────────────

async function start() {
  // Plugins
  await app.register(cors, {
    origin:
      process.env["NODE_ENV"] === "production"
        ? process.env["FRONTEND_URL"]
        : true,   // dev : autorise tous les ports (3000, 3002, etc.)
    credentials: true,
  });

  // En-têtes de sécurité HTTP (Content-Security-Policy, etc.)
  await app.register(helmet, {
    contentSecurityPolicy: false, // géré par le frontend Next.js
    crossOriginEmbedderPolicy: false,  // requis pour les iframes YouTube (trailers)
  });

  await app.register(cookie, {
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
    runAllScrapers().catch((err) =>
      console.error("[ADMIN] Erreur scraping manuel :", err)
    );
    return { message: "Scraping lancé en arrière-plan" };
  });

  // Routes métier
  await app.register(filmsRoutes,   { prefix: "/api" });
  await app.register(cinemasRoutes, { prefix: "/api" });
  await app.register(searchRoutes,  { prefix: "/api" });
  await app.register(alertesRoutes, { prefix: "/api" });
  await app.register(statsRoutes,   { prefix: "/api" });
  await app.register(profilRoutes,  { prefix: "/api" });
  await app.register(authRoutes,    { prefix: "/api" });
  await app.register(usersRoutes,   { prefix: "/api" });
  // await app.register(stripeRoutes,  { prefix: "/api" }); // ⏸ Désactivé temporairement
  await app.register(notifRoutes,   { prefix: "/api" });
  await app.register(listesRoutes,  { prefix: "/api" });

  // Connexions externes
  await connectRedis();
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

  registerScrapeJob();

  // ─── Cron nocturne 3h00 (tous les scrapers via child_process) ───
  //
  //  Expression : "0 3 * * *" = chaque nuit à 03:00 (Europe/Paris)
  //  Lance `npm run scrape` en sous-processus non bloquant.
  //  Ce cron est complémentaire à registerScrapeJob() (06:00).
  cron.schedule(
    "0 3 * * *",
    () => {
      const startedAt = new Date().toISOString();
      console.log(`[CRON 03:00] Démarrage du scraping nocturne — ${startedAt}`);

      const child = spawn("npm", ["run", "scrape"], {
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
        } else {
          console.warn(
            `[CRON 03:00] Scraping nocturne terminé avec le code ${code} — ${finishedAt}`
          );
        }
      });
    },
    { timezone: "Europe/Paris" }
  );

  console.log('✅ Cron nocturne planifié : "0 3 * * *" (Europe/Paris)');
}

// ─── Arrêt propre ────────────────────────────────────────

const shutdown = async () => {
  console.log("\n⏹  Arrêt du serveur…");
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start().catch((err) => {
  console.error("Erreur au démarrage :", err);
  process.exit(1);
});
