// ─────────────────────────────────────────────────────────
//  Routes Listes thématiques
//
//  GET  /api/listes/:slug              Liste publique par slug
//  GET  /api/listes/mes-listes         Listes de l'utilisateur connecté
//  POST /api/listes                    Créer une liste
//  PUT  /api/listes/:slug              Modifier une liste (auteur/admin)
//  DELETE /api/listes/:slug            Supprimer une liste (auteur)
//  POST /api/listes/:slug/films        Ajouter un film
//  DELETE /api/listes/:slug/films/:filmId Retirer un film
//  POST /api/listes/:slug/membres      Inviter un membre
// ─────────────────────────────────────────────────────────

import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { extractUser } from "../middleware/auth.js";

// ── Helpers ───────────────────────────────────────────────

/** Génère un slug à partir d'un titre + suffix aléatoire court */
function toSlug(titre: string): string {
  const base = titre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base}-${suffix}`;
}

// ── Schémas ───────────────────────────────────────────────

const createListeSchema = z.object({
  titre:       z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  isPublic:    z.boolean().default(true),
  emoji:       z.string().max(4).default("🎬"),
});

const addFilmSchema = z.object({
  filmId:   z.string().min(1),
  position: z.number().int().optional(),
  note:     z.string().max(300).optional(),
});

const inviteMembreSchema = z.object({
  pseudo: z.string().min(1),
  role:   z.enum(["VIEWER", "EDITOR"]).default("VIEWER"),
});

// ── Plugin Fastify ────────────────────────────────────────

const listesRoutes: FastifyPluginAsync = async (fastify) => {

  // ── GET /api/listes/mes-listes ────────────────────────
  fastify.get("/listes/mes-listes", async (request, reply) => {
    const user = extractUser(request);
    if (!user) return reply.code(401).send({ error: "Non authentifié" });

    const listes = await prisma.liste.findMany({
      where: {
        OR: [
          { authorId: user.userId },
          { membres: { some: { userId: user.userId } } },
        ],
      },
      include: {
        _count: { select: { films: true, membres: true } },
        author:  { select: { pseudo: true, avatar: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    return listes;
  });

  // ── GET /api/listes/:slug ─────────────────────────────
  fastify.get<{ Params: { slug: string } }>("/listes/:slug", async (request, reply) => {
    const { slug } = request.params;
    const user = extractUser(request);

    const liste = await prisma.liste.findUnique({
      where: { slug },
      include: {
        author:  { select: { id: true, pseudo: true, avatar: true } },
        membres: {
          include: { user: { select: { id: true, pseudo: true, avatar: true } } },
        },
        films: {
          orderBy: { position: "asc" },
          include: {
            film: {
              select: {
                id: true, titre: true, affiche: true,
                annee: true, genres: true, realisateur: true,
                imdbNote: true, tmdbNote: true,
              },
            },
          },
        },
      },
    });

    if (!liste) return reply.code(404).send({ error: "Liste introuvable" });

    // Vérifier l'accès si privée
    if (!liste.isPublic) {
      if (!user) return reply.code(403).send({ error: "Liste privée" });
      const isAuthor  = liste.author.id === user.userId;
      const isMembre  = liste.membres.some(m => m.user.id === user.userId);
      if (!isAuthor && !isMembre) return reply.code(403).send({ error: "Accès refusé" });
    }

    return liste;
  });

  // ── POST /api/listes ──────────────────────────────────
  fastify.post("/listes", async (request, reply) => {
    const user = extractUser(request);
    if (!user) return reply.code(401).send({ error: "Non authentifié" });

    const parsed = createListeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Données invalides", details: parsed.error.flatten() });

    const { titre, description, isPublic, emoji } = parsed.data;

    // Vérifier les doublons de titre pour cet utilisateur (max 50 listes)
    const count = await prisma.liste.count({ where: { authorId: user.userId } });
    if (count >= 50) return reply.code(429).send({ error: "Limite de 50 listes atteinte" });

    let slug = toSlug(titre);
    // S'assurer de l'unicité du slug
    let attempts = 0;
    while (await prisma.liste.findUnique({ where: { slug } })) {
      slug = toSlug(titre);
      if (++attempts > 10) slug = `liste-${Date.now()}`;
    }

    const liste = await prisma.liste.create({
      data: { titre, description, isPublic, emoji, slug, authorId: user.userId },
      include: { _count: { select: { films: true } } },
    });

    reply.code(201);
    return liste;
  });

  // ── PUT /api/listes/:slug ─────────────────────────────
  fastify.put<{ Params: { slug: string } }>("/listes/:slug", async (request, reply) => {
    const user = extractUser(request);
    if (!user) return reply.code(401).send({ error: "Non authentifié" });

    const liste = await prisma.liste.findUnique({ where: { slug: request.params.slug } });
    if (!liste) return reply.code(404).send({ error: "Liste introuvable" });
    if (liste.authorId !== user.userId) return reply.code(403).send({ error: "Accès refusé" });

    const parsed = createListeSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Données invalides" });

    const updated = await prisma.liste.update({
      where: { slug: request.params.slug },
      data: parsed.data,
    });

    return updated;
  });

  // ── DELETE /api/listes/:slug ──────────────────────────
  fastify.delete<{ Params: { slug: string } }>("/listes/:slug", async (request, reply) => {
    const user = extractUser(request);
    if (!user) return reply.code(401).send({ error: "Non authentifié" });

    const liste = await prisma.liste.findUnique({ where: { slug: request.params.slug } });
    if (!liste) return reply.code(404).send({ error: "Liste introuvable" });
    if (liste.authorId !== user.userId) return reply.code(403).send({ error: "Seul l'auteur peut supprimer" });

    await prisma.liste.delete({ where: { slug: request.params.slug } });
    return { ok: true };
  });

  // ── POST /api/listes/:slug/films ──────────────────────
  fastify.post<{ Params: { slug: string } }>("/listes/:slug/films", async (request, reply) => {
    const user = extractUser(request);
    if (!user) return reply.code(401).send({ error: "Non authentifié" });

    const liste = await prisma.liste.findUnique({
      where: { slug: request.params.slug },
      include: { membres: true },
    });
    if (!liste) return reply.code(404).send({ error: "Liste introuvable" });

    const canEdit = liste.authorId === user.userId ||
      liste.membres.some(m => m.userId === user.userId && m.role !== "VIEWER");
    if (!canEdit) return reply.code(403).send({ error: "Accès éditeur requis" });

    const parsed = addFilmSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Données invalides" });

    const { filmId, position, note } = parsed.data;

    // Vérifier que le film existe
    const film = await prisma.film.findUnique({ where: { id: filmId } });
    if (!film) return reply.code(404).send({ error: "Film introuvable" });

    const listeFilm = await prisma.listeFilm.upsert({
      where: { listeId_filmId: { listeId: liste.id, filmId } },
      create: { listeId: liste.id, filmId, position: position ?? 0, note },
      update: { position: position ?? 0, note },
    });

    // Mettre à jour updatedAt de la liste
    await prisma.liste.update({ where: { id: liste.id }, data: { updatedAt: new Date() } });

    reply.code(201);
    return listeFilm;
  });

  // ── DELETE /api/listes/:slug/films/:filmId ────────────
  fastify.delete<{ Params: { slug: string; filmId: string } }>(
    "/listes/:slug/films/:filmId",
    async (request, reply) => {
      const user = extractUser(request);
      if (!user) return reply.code(401).send({ error: "Non authentifié" });

      const liste = await prisma.liste.findUnique({
        where: { slug: request.params.slug },
        include: { membres: true },
      });
      if (!liste) return reply.code(404).send({ error: "Liste introuvable" });

      const canEdit = liste.authorId === user.userId ||
        liste.membres.some(m => m.userId === user.userId && m.role !== "VIEWER");
      if (!canEdit) return reply.code(403).send({ error: "Accès éditeur requis" });

      await prisma.listeFilm.deleteMany({
        where: { listeId: liste.id, filmId: request.params.filmId },
      });

      return { ok: true };
    }
  );

  // ── POST /api/listes/:slug/membres ────────────────────
  fastify.post<{ Params: { slug: string } }>("/listes/:slug/membres", async (request, reply) => {
    const user = extractUser(request);
    if (!user) return reply.code(401).send({ error: "Non authentifié" });

    const liste = await prisma.liste.findUnique({ where: { slug: request.params.slug } });
    if (!liste) return reply.code(404).send({ error: "Liste introuvable" });
    if (liste.authorId !== user.userId) return reply.code(403).send({ error: "Seul l'auteur peut inviter" });

    const parsed = inviteMembreSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Données invalides" });

    const invitee = await prisma.user.findUnique({
      where: { pseudo: parsed.data.pseudo },
      select: { id: true, pseudo: true },
    });
    if (!invitee) return reply.code(404).send({ error: "Utilisateur introuvable" });
    if (invitee.id === user.userId) return reply.code(400).send({ error: "Vous êtes déjà auteur" });

    const membre = await prisma.listeMembre.upsert({
      where: { listeId_userId: { listeId: liste.id, userId: invitee.id } },
      create: { listeId: liste.id, userId: invitee.id, role: parsed.data.role },
      update: { role: parsed.data.role },
    });

    return membre;
  });

};

export default listesRoutes;
