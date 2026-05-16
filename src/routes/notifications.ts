// ─────────────────────────────────────────────────────────
//  Routes Notifications
//
//  GET    /api/notifications          Liste des notifs du user (JWT)
//  PATCH  /api/notifications/read-all Marque tout comme lu
//  PATCH  /api/notifications/:id/read Marque une notif comme lue
//  DELETE /api/notifications/:id      Supprime une notif
//
//  POST   /api/notifications/trigger/films-en-salle
//         Vérifie si des films favoris/watchlist sont en salle → crée des notifs
//  POST   /api/notifications/trigger/nouveaute-hebdo
//         Crée une notif "nouveauté à l'affiche" pour tous les users actifs
// ─────────────────────────────────────────────────────────

import { FastifyPluginAsync } from "fastify";
import { PrismaClient } from "@prisma/client";
import { extractUser } from "../middleware/auth.js";

const prisma = new PrismaClient();

const notifRoutes: FastifyPluginAsync = async (fastify) => {

  // ── GET /api/notifications/unread-count ──────────────
  fastify.get("/notifications/unread-count", async (req, reply) => {
    const auth = extractUser(req);
    if (!auth) return reply.send({ count: 0 });
    const count = await prisma.notification.count({
      where: { userId: auth.userId, lu: false },
    });
    return reply.send({ count });
  });

  // ── GET /api/notifications ────────────────────────────
  fastify.get("/notifications", async (req, reply) => {
    const auth = extractUser(req);
    if (!auth) return reply.status(401).send({ error: "Non authentifié" });

    const notifs = await prisma.notification.findMany({
      where:   { userId: auth.userId },
      orderBy: { createdAt: "desc" },
      take:    50,
    });

    const unread = notifs.filter(n => !n.lu).length;
    return reply.send({ notifications: notifs, unread });
  });

  // ── PATCH /api/notifications/read-all ─────────────────
  fastify.patch("/notifications/read-all", async (req, reply) => {
    const auth = extractUser(req);
    if (!auth) return reply.status(401).send({ error: "Non authentifié" });

    await prisma.notification.updateMany({
      where: { userId: auth.userId, lu: false },
      data:  { lu: true },
    });
    return reply.send({ ok: true });
  });

  // ── PATCH /api/notifications/:id/read ─────────────────
  fastify.patch<{ Params: { id: string } }>(
    "/notifications/:id/read",
    async (req, reply) => {
      const auth = extractUser(req);
      if (!auth) return reply.status(401).send({ error: "Non authentifié" });

      await prisma.notification.updateMany({
        where: { id: req.params.id, userId: auth.userId },
        data:  { lu: true },
      });
      return reply.send({ ok: true });
    }
  );

  // ── DELETE /api/notifications/:id ─────────────────────
  fastify.delete<{ Params: { id: string } }>(
    "/notifications/:id",
    async (req, reply) => {
      const auth = extractUser(req);
      if (!auth) return reply.status(401).send({ error: "Non authentifié" });

      await prisma.notification.deleteMany({
        where: { id: req.params.id, userId: auth.userId },
      });
      return reply.send({ ok: true });
    }
  );

  // ── POST /api/notifications/trigger/films-en-salle ────
  // À appeler périodiquement (cron) ou au chargement du profil
  fastify.post("/notifications/trigger/films-en-salle", async (req, reply) => {
    const auth = extractUser(req);
    if (!auth) return reply.status(401).send({ error: "Non authentifié" });

    // Récupère les films favoris + watchlist de l'utilisateur
    const now = new Date();
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      include: {
        filmsFavoris: { include: { film: { select: { id: true, titre: true, affiche: true,
          seances: { where: { dateHeure: { gte: now } }, take: 1, select: { id: true } } } } } },
        watchlist:    { include: { film: { select: { id: true, titre: true, affiche: true,
          seances: { where: { dateHeure: { gte: now } }, take: 1, select: { id: true } } } } } },
      },
    });
    if (!user) return reply.status(404).send({ error: "Utilisateur introuvable" });

    const filmsEnSalle = [
      ...user.filmsFavoris.map((f) => ({ film: f.film, source: "favori" as const })),
      ...user.watchlist.map((w)    => ({ film: w.film,  source: "watchlist" as const })),
    ].filter(({ film }) => film.seances.length > 0);

    // Évite les doublons : vérifier si une notif existe déjà pour ce film cette semaine
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    let created = 0;

    for (const { film, source } of filmsEnSalle) {
      const exists = await prisma.notification.findFirst({
        where: {
          userId:    auth.userId,
          type:      "film_en_salle",
          lien:      `/films/${film.id}`,
          createdAt: { gte: since },
        },
      });
      if (exists) continue;

      await prisma.notification.create({
        data: {
          userId:   auth.userId,
          type:     "film_en_salle",
          titre:    `${film.titre} est en salle !`,
          corps:    `Un film de ${source === "favori" ? "vos favoris" : "votre watchlist"} est actuellement à l'affiche dans les cinémas.`,
          lien:     `/films/${film.id}`,
          imageUrl: film.affiche ?? null,
        },
      });
      created++;
    }

    return reply.send({ ok: true, created });
  });

  // ── POST /api/notifications/trigger/nouveaute-hebdo ───
  // Crée une notif "nouveauté" pour tous les users actifs
  // À appeler via un cron hebdomadaire
  fastify.post<{ Body: { adminSecret?: string } }>(
    "/notifications/trigger/nouveaute-hebdo",
    async (req, reply) => {
      // Sécurité minimale
      const secret = (req.body as { adminSecret?: string })?.adminSecret;
      if (secret !== process.env["ADMIN_SECRET"]) {
        return reply.status(403).send({ error: "Accès refusé" });
      }

      // Film le plus en salle cette semaine (nombre de séances futures le plus élevé)
      const nowHebdo = new Date();
      const filmsAvecSeances = await prisma.film.findMany({
        where:  { seances: { some: { dateHeure: { gte: nowHebdo } } } },
        select: { id: true, titre: true, affiche: true, tmdbNote: true,
          _count: { select: { seances: { where: { dateHeure: { gte: nowHebdo } } } } } },
        orderBy: { tmdbNote: "desc" },
        take: 20,
      });
      // Trie par nombre de séances futures décroissant
      filmsAvecSeances.sort((a, b) => b._count.seances - a._count.seances);
      const topFilm = filmsAvecSeances[0] ?? null;

      if (!topFilm) return reply.send({ ok: true, skipped: "Aucun film en salle" });

      // Vérifie si une notif pour ce film a déjà été envoyée cette semaine
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const alreadySent = await prisma.notification.findFirst({
        where: { type: "nouveaute_hebdo", lien: `/films/${topFilm.id}`, createdAt: { gte: since } },
      });
      if (alreadySent) return reply.send({ ok: true, skipped: "Déjà envoyé cette semaine" });

      // Crée la notif pour tous les utilisateurs ayant un email vérifié
      const users = await prisma.user.findMany({
        where:  { emailVerified: true },
        select: { id: true },
      });

      await prisma.notification.createMany({
        data: users.map(u => ({
          userId:   u.id,
          type:     "nouveaute_hebdo",
          titre:    `🎬 ${topFilm.titre} est maintenant en salles !`,
          corps:    `Cette semaine, ne manquez pas ${topFilm.titre} dans les cinémas près de chez vous.`,
          lien:     `/films/${topFilm.id}`,
          imageUrl: topFilm.affiche ?? null,
        })),
        skipDuplicates: true,
      });

      return reply.send({ ok: true, film: topFilm.titre, users: users.length });
    }
  );
};

export default notifRoutes;
