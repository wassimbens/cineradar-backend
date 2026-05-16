// ─────────────────────────────────────────────────────────
//  Routes Profil utilisateur (style Letterboxd)
//
//  GET    /api/profil/:email               Récupère le profil complet
//  PUT    /api/profil/:email               Mise à jour nom/avatar
//
//  POST   /api/profil/:email/favoris       Ajoute un film en favori
//  DELETE /api/profil/:email/favoris/:filmId  Retire un favori
//
//  POST   /api/profil/:email/watchlist     Ajoute un film à la watchlist
//  DELETE /api/profil/:email/watchlist/:filmId  Retire de la watchlist
//
//  POST   /api/profil/:email/cinemas       Ajoute un cinéma favori
//  DELETE /api/profil/:email/cinemas/:cinemaId  Retire un cinéma favori
//
//  PUT    /api/profil/:email/avis/:filmId  Crée ou met à jour un avis
//  DELETE /api/profil/:email/avis/:filmId  Supprime un avis
// ─────────────────────────────────────────────────────────

import { FastifyPluginAsync } from "fastify";
import { PrismaClient } from "@prisma/client";
import { extractUser } from "../middleware/auth.js";

const prisma = new PrismaClient();

// ── Helpers ───────────────────────────────────────────────

async function getOrCreateUser(email: string) {
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
  });
}

// ── Plugin ────────────────────────────────────────────────

const profilRoutes: FastifyPluginAsync = async (fastify) => {

  // ── GET /api/profil/:email ────────────────────────────
  fastify.get<{ Params: { email: string } }>("/profil/:email", async (req, reply) => {
    const { email } = req.params;

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        filmsFavoris: {
          orderBy: { position: "asc" },
          include: {
            film: {
              select: {
                id: true, titre: true, titreOriginal: true,
                affiche: true, annee: true, realisateur: true, genres: true,
              },
            },
          },
        },
        watchlist: {
          orderBy: { createdAt: "desc" },
          include: {
            film: {
              select: {
                id: true, titre: true, titreOriginal: true,
                affiche: true, annee: true, realisateur: true, genres: true,
              },
            },
          },
        },
        cinemasFavoris: {
          orderBy: { createdAt: "desc" },
          include: {
            cinema: {
              select: {
                id: true, nom: true, adresse: true, ville: true, chaine: true,
              },
            },
          },
        },
        avis: {
          orderBy: { updatedAt: "desc" },
          include: {
            film: {
              select: {
                id: true, titre: true, titreOriginal: true,
                affiche: true, annee: true, realisateur: true, genres: true,
              },
            },
          },
        },
        filmsVus: {
          orderBy: { dateVu: "desc" },
          take: 200,
          include: {
            film: {
              select: {
                id: true, titre: true, titreOriginal: true,
                affiche: true, annee: true, realisateur: true, genres: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      // Crée un profil minimal si l'utilisateur n'existe pas encore
      const newUser = await prisma.user.create({ data: { email } });
      return reply.send({
        id: newUser.id, email: newUser.email, nom: newUser.nom,
        pseudo: (newUser as { pseudo?: string | null }).pseudo ?? null,
        avatar: newUser.avatar, bio: null, ville: null, genresPreferes: [],
        createdAt: newUser.createdAt,
        filmsFavoris: [], watchlist: [], cinemasFavoris: [], avis: [], filmsVus: [],
        stats: { favoris: 0, watchlist: 0, avis: 0, cinemas: 0, filmsVus: 0 },
        genresStats: [],
        realisateursStats: [],
      });
    }

    // ── Calcul des stats genres / réalisateurs ──────────
    const genreCount = new Map<string, number>();
    const realCount  = new Map<string, number>();

    for (const fv of user.filmsVus) {
      for (const g of fv.film.genres) {
        genreCount.set(g, (genreCount.get(g) ?? 0) + 1);
      }
      if (fv.film.realisateur) {
        realCount.set(fv.film.realisateur, (realCount.get(fv.film.realisateur) ?? 0) + 1);
      }
    }

    const genresStats = [...genreCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([genre, count]) => ({ genre, count }));

    const realisateursStats = [...realCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([realisateur, count]) => ({ realisateur, count }));

    return reply.send({
      id: user.id,
      email: user.email,
      nom: user.nom,
      avatar: user.avatar,
      bio: (user as { bio?: string | null }).bio ?? null,
      ville: (user as { ville?: string | null }).ville ?? null,
      genresPreferes: (user as { genresPreferes?: string[] }).genresPreferes ?? [],
      createdAt: user.createdAt,
      filmsFavoris: user.filmsFavoris.map((f) => ({ ...f.film, position: f.position })),
      pseudo: (user as { pseudo?: string | null }).pseudo ?? null,
      isPremium: (user as { isPremium?: boolean }).isPremium ?? false,
      watchlist: user.watchlist.map((w) => w.film),
      cinemasFavoris: user.cinemasFavoris.map((c) => c.cinema),
      avis: user.avis.map((a) => ({
        filmId: a.filmId,
        film: a.film,
        note: a.note,
        texte: a.texte,
        updatedAt: a.updatedAt,
      })),
      filmsVus: user.filmsVus.map((fv) => ({
        id: fv.id,
        film: fv.film,
        cinemaId: fv.cinemaId,
        dateVu: fv.dateVu,
      })),
      stats: {
        favoris: user.filmsFavoris.length,
        watchlist: user.watchlist.length,
        avis: user.avis.length,
        cinemas: user.cinemasFavoris.length,
        filmsVus: user.filmsVus.length,
      },
      genresStats,
      realisateursStats,
    });
  });

  // ── PUT /api/profil/:email ────────────────────────────
  fastify.put<{
    Params: { email: string };
    Body: { nom?: string; avatar?: string; bio?: string; ville?: string; genresPreferes?: string[] };
  }>("/profil/:email", async (req, reply) => {
    const { email } = req.params;
    const { nom, avatar, bio, ville, genresPreferes } = req.body ?? {};

    const updateData: Record<string, unknown> = {};
    if (nom !== undefined)            updateData["nom"] = nom;
    if (avatar !== undefined)         updateData["avatar"] = avatar;
    if (bio !== undefined)            updateData["bio"] = bio;
    if (ville !== undefined)          updateData["ville"] = ville;
    if (genresPreferes !== undefined) updateData["genresPreferes"] = genresPreferes;
    // pseudo via profil update (legacy mode, sans JWT)
    if ((req.body as { pseudo?: string }).pseudo !== undefined) {
      const newPseudo = (req.body as { pseudo?: string }).pseudo ?? null;
      if (newPseudo) {
        const PSEUDO_RE = /^[a-zA-Z0-9_-]{3,20}$/;
        if (!PSEUDO_RE.test(newPseudo)) {
          return reply.status(400).send({ error: "Pseudo invalide (3–20 chars, lettres, chiffres, _ -)" });
        }
        const taken = await prisma.user.findFirst({ where: { pseudo: newPseudo, NOT: { email } } });
        if (taken) return reply.status(409).send({ error: "Pseudo déjà pris" });
      }
      updateData["pseudo"] = newPseudo;
    }

    const user = await prisma.user.upsert({
      where: { email },
      update: updateData,
      create: { email, ...updateData },
    });
    return reply.send({ ok: true, user });
  });

  // ── POST /api/profil/:email/films-vus ─────────────────
  fastify.post<{
    Params: { email: string };
    Body: { filmId: string; cinemaId?: string; dateVu?: string };
  }>("/profil/:email/films-vus", async (req, reply) => {
    const { email } = req.params;
    const { filmId, cinemaId, dateVu } = req.body ?? {};
    if (!filmId) return reply.status(400).send({ error: "filmId requis" });

    const user = await getOrCreateUser(email);
    const filmVu = await prisma.filmVu.create({
      data: {
        userId: user.id,
        filmId,
        cinemaId: cinemaId ?? null,
        dateVu: dateVu ? new Date(dateVu) : new Date(),
      },
    });
    return reply.send({ ok: true, filmVu });
  });

  // ── DELETE /api/profil/:email/films-vus/:id ───────────
  fastify.delete<{
    Params: { email: string; id: string };
  }>("/profil/:email/films-vus/:id", async (req, reply) => {
    const { email, id } = req.params;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return reply.send({ ok: true });

    await prisma.filmVu.deleteMany({
      where: { id, userId: user.id },
    });
    return reply.send({ ok: true });
  });

  // ── POST /api/profil/:email/favoris ───────────────────
  fastify.post<{
    Params: { email: string };
    Body: { filmId: string; position?: number };
  }>("/profil/:email/favoris", async (req, reply) => {
    const { email } = req.params;
    const { filmId, position } = req.body ?? {};
    if (!filmId) return reply.status(400).send({ error: "filmId requis" });

    const user = await getOrCreateUser(email);
    await prisma.filmFavori.upsert({
      where: { userId_filmId: { userId: user.id, filmId } },
      update: { position: position ?? 0 },
      create: { userId: user.id, filmId, position: position ?? 0 },
    });
    return reply.send({ ok: true });
  });

  // ── PUT /api/profil/:email/favoris/reorder ─────────────
  // Body: [{ filmId, position }] — réordonne les films favoris
  fastify.put<{
    Params: { email: string };
    Body: { filmId: string; position: number }[];
  }>("/profil/:email/favoris/reorder", async (req, reply) => {
    const { email } = req.params;
    const items = req.body ?? [];

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return reply.send({ ok: true });

    await Promise.all(
      items.map(({ filmId, position }) =>
        prisma.filmFavori.updateMany({
          where: { userId: user.id, filmId },
          data: { position },
        })
      )
    );
    return reply.send({ ok: true });
  });

  // ── DELETE /api/profil/:email/favoris/:filmId ─────────
  fastify.delete<{
    Params: { email: string; filmId: string };
  }>("/profil/:email/favoris/:filmId", async (req, reply) => {
    const { email, filmId } = req.params;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return reply.send({ ok: true });

    await prisma.filmFavori.deleteMany({
      where: { userId: user.id, filmId },
    });
    return reply.send({ ok: true });
  });

  // ── POST /api/profil/:email/watchlist ─────────────────
  fastify.post<{
    Params: { email: string };
    Body: { filmId: string };
  }>("/profil/:email/watchlist", async (req, reply) => {
    const { email } = req.params;
    const { filmId } = req.body ?? {};
    if (!filmId) return reply.status(400).send({ error: "filmId requis" });

    const user = await getOrCreateUser(email);
    await prisma.watchlistItem.upsert({
      where: { userId_filmId: { userId: user.id, filmId } },
      update: {},
      create: { userId: user.id, filmId },
    });
    return reply.send({ ok: true });
  });

  // ── DELETE /api/profil/:email/watchlist/:filmId ───────
  fastify.delete<{
    Params: { email: string; filmId: string };
  }>("/profil/:email/watchlist/:filmId", async (req, reply) => {
    const { email, filmId } = req.params;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return reply.send({ ok: true });

    await prisma.watchlistItem.deleteMany({
      where: { userId: user.id, filmId },
    });
    return reply.send({ ok: true });
  });

  // ── POST /api/profil/:email/cinemas ───────────────────
  fastify.post<{
    Params: { email: string };
    Body: { cinemaId: string };
  }>("/profil/:email/cinemas", async (req, reply) => {
    const { email } = req.params;
    const { cinemaId } = req.body ?? {};
    if (!cinemaId) return reply.status(400).send({ error: "cinemaId requis" });

    const user = await getOrCreateUser(email);
    await prisma.cinemaFavori.upsert({
      where: { userId_cinemaId: { userId: user.id, cinemaId } },
      update: {},
      create: { userId: user.id, cinemaId },
    });
    return reply.send({ ok: true });
  });

  // ── DELETE /api/profil/:email/cinemas/:cinemaId ───────
  fastify.delete<{
    Params: { email: string; cinemaId: string };
  }>("/profil/:email/cinemas/:cinemaId", async (req, reply) => {
    const { email, cinemaId } = req.params;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return reply.send({ ok: true });

    await prisma.cinemaFavori.deleteMany({
      where: { userId: user.id, cinemaId },
    });
    return reply.send({ ok: true });
  });

  // ── PUT /api/profil/:email/avis/:filmId ───────────────
  fastify.put<{
    Params: { email: string; filmId: string };
    Body: { note?: number; texte?: string };
  }>("/profil/:email/avis/:filmId", async (req, reply) => {
    const { email, filmId } = req.params;
    const { note, texte } = req.body ?? {};

    if (note !== undefined && (note < 0.5 || note > 5)) {
      return reply.status(400).send({ error: "Note entre 0.5 et 5" });
    }

    const user = await getOrCreateUser(email);
    const avis = await prisma.avis.upsert({
      where: { userId_filmId: { userId: user.id, filmId } },
      update: { note: note ?? null, texte: texte ?? null },
      create: { userId: user.id, filmId, note: note ?? null, texte: texte ?? null },
    });
    return reply.send({ ok: true, avis });
  });

  // ── DELETE /api/profil/:email/avis/:filmId ────────────
  fastify.delete<{
    Params: { email: string; filmId: string };
  }>("/profil/:email/avis/:filmId", async (req, reply) => {
    const { email, filmId } = req.params;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return reply.send({ ok: true });

    await prisma.avis.deleteMany({
      where: { userId: user.id, filmId },
    });
    return reply.send({ ok: true });
  });

  // ════════════════════════════════════════════════════════
  //  Profils publics — par pseudo
  // ════════════════════════════════════════════════════════

  const FILM_SELECT = {
    id: true, titre: true, titreOriginal: true,
    affiche: true, annee: true, realisateur: true, genres: true,
  } as const;

  // ── GET /api/profils/:pseudo ──────────────────────────
  fastify.get<{ Params: { pseudo: string } }>("/profils/:pseudo", async (req, reply) => {
    const { pseudo } = req.params;

    const user = await prisma.user.findUnique({
      where: { pseudo },
      include: {
        filmsFavoris: {
          orderBy: { position: "asc" },
          include: { film: { select: FILM_SELECT } },
        },
        watchlist: {
          orderBy: { createdAt: "desc" },
          include: { film: { select: FILM_SELECT } },
        },
        avis: {
          orderBy: { updatedAt: "desc" },
          include: { film: { select: FILM_SELECT } },
        },
        filmsVus: {
          orderBy: { dateVu: "desc" },
          take: 200,
          include: { film: { select: FILM_SELECT } },
        },
        _count: { select: { followers: true, following: true } },
      },
    });

    if (!user) return reply.status(404).send({ error: "Profil introuvable" });
    if (!user.isPublic) return reply.status(403).send({ error: "Ce profil est privé" });

    return reply.send({
      id: user.id,
      pseudo: user.pseudo,
      nom: user.nom,
      avatar: user.avatar,
      bio: (user as { bio?: string | null }).bio ?? null,
      ville: (user as { ville?: string | null }).ville ?? null,
      createdAt: user.createdAt,
      followersCount: user._count.followers,
      followingCount: user._count.following,
      filmsFavoris: user.filmsFavoris.map((f) => ({ ...f.film, position: f.position })),
      watchlist: user.watchlist.map((w) => w.film),
      avis: user.avis.map((a) => ({
        filmId: a.filmId,
        film: a.film,
        note: a.note,
        texte: a.texte,
        updatedAt: a.updatedAt,
      })),
      filmsVus: user.filmsVus.map((fv) => ({
        id: fv.id,
        film: fv.film,
        cinemaId: fv.cinemaId,
        dateVu: fv.dateVu,
      })),
      stats: {
        filmsVus: user.filmsVus.length,
        watchlist: user.watchlist.length,
        avis: user.avis.length,
        favoris: user.filmsFavoris.length,
      },
    });
  });

  // ── POST /api/profils/:pseudo/follow ──────────────────
  fastify.post<{ Params: { pseudo: string } }>(
    "/profils/:pseudo/follow",
    async (req, reply) => {
      const authUser = extractUser(req);
      if (!authUser) return reply.status(401).send({ error: "Authentification requise" });

      const target = await prisma.user.findUnique({ where: { pseudo: req.params.pseudo } });
      if (!target) return reply.status(404).send({ error: "Utilisateur introuvable" });
      if (target.id === authUser.userId) {
        return reply.status(400).send({ error: "Vous ne pouvez pas vous suivre vous-même" });
      }

      const existing = await prisma.follow.findUnique({
        where: { followerId_followedId: { followerId: authUser.userId, followedId: target.id } },
      });

      await prisma.follow.upsert({
        where: {
          followerId_followedId: { followerId: authUser.userId, followedId: target.id },
        },
        update: {},
        create: { followerId: authUser.userId, followedId: target.id },
      });

      // Notification au suivi (seulement si c'est un nouveau follow)
      if (!existing) {
        const follower = await prisma.user.findUnique({
          where:  { id: authUser.userId },
          select: { pseudo: true, nom: true, avatar: true },
        });
        const followerName = follower?.pseudo ?? follower?.nom ?? "Quelqu'un";
        await prisma.notification.create({
          data: {
            userId:   target.id,
            type:     "follow",
            titre:    `${followerName} vous suit maintenant`,
            corps:    `Vous avez un nouvel abonné sur CinéRadar.`,
            lien:     follower?.pseudo ? `/profils/${follower.pseudo}` : null,
            imageUrl: follower?.avatar ?? null,
          },
        }).catch(() => {}); // silencieux si erreur
      }

      return reply.send({ ok: true });
    }
  );

  // ── DELETE /api/profils/:pseudo/follow ────────────────
  fastify.delete<{ Params: { pseudo: string } }>(
    "/profils/:pseudo/follow",
    async (req, reply) => {
      const authUser = extractUser(req);
      if (!authUser) return reply.status(401).send({ error: "Authentification requise" });

      const target = await prisma.user.findUnique({ where: { pseudo: req.params.pseudo } });
      if (!target) return reply.send({ ok: true });

      await prisma.follow.deleteMany({
        where: { followerId: authUser.userId, followedId: target.id },
      });

      return reply.send({ ok: true });
    }
  );

  // ── GET /api/profils/:pseudo/followers ────────────────
  fastify.get<{ Params: { pseudo: string } }>(
    "/profils/:pseudo/followers",
    async (req, reply) => {
      const user = await prisma.user.findUnique({ where: { pseudo: req.params.pseudo } });
      if (!user) return reply.status(404).send({ error: "Utilisateur introuvable" });

      const follows = await prisma.follow.findMany({
        where: { followedId: user.id },
        include: {
          follower: {
            select: { id: true, pseudo: true, nom: true, avatar: true, bio: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return reply.send(follows.map((f) => f.follower));
    }
  );

  // ── GET /api/profils/:pseudo/following ────────────────
  fastify.get<{ Params: { pseudo: string } }>(
    "/profils/:pseudo/following",
    async (req, reply) => {
      const user = await prisma.user.findUnique({ where: { pseudo: req.params.pseudo } });
      if (!user) return reply.status(404).send({ error: "Utilisateur introuvable" });

      const follows = await prisma.follow.findMany({
        where: { followerId: user.id },
        include: {
          followed: {
            select: { id: true, pseudo: true, nom: true, avatar: true, bio: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return reply.send(follows.map((f) => f.followed));
    }
  );

  // ── GET /api/profils/:pseudo/is-following ─────────────
  // Retourne { following: bool } pour l'utilisateur authentifié
  fastify.get<{ Params: { pseudo: string } }>(
    "/profils/:pseudo/is-following",
    async (req, reply) => {
      const authUser = extractUser(req);
      if (!authUser) return reply.send({ following: false });

      const target = await prisma.user.findUnique({ where: { pseudo: req.params.pseudo } });
      if (!target) return reply.send({ following: false });

      const follow = await prisma.follow.findUnique({
        where: {
          followerId_followedId: { followerId: authUser.userId, followedId: target.id },
        },
      });

      return reply.send({ following: !!follow });
    }
  );

  // ── PUT /api/profil/:email/poster-choice ─────────────
  // Sauvegarde le choix d'affiche personnalisée d'un membre Pro
  fastify.put<{
    Params: { email: string };
    Body: { filmId: string; posterUrl: string };
  }>("/profil/:email/poster-choice", async (req, reply) => {
    const { email } = req.params;
    const { filmId, posterUrl } = req.body ?? {};
    if (!filmId || !posterUrl) return reply.status(400).send({ error: "filmId et posterUrl requis" });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return reply.status(404).send({ error: "Utilisateur introuvable" });
    if (!user.isPremium) return reply.status(403).send({ error: "Fonctionnalité réservée aux membres Pro" });

    await prisma.userPosterChoice.upsert({
      where: { userId_filmId: { userId: user.id, filmId } },
      update: { posterUrl },
      create: { userId: user.id, filmId, posterUrl },
    });

    return reply.send({ ok: true });
  });

  // ── GET /api/profil/:email/poster-choices ────────────
  // Retourne tous les choix d'affiches personnalisées de l'utilisateur
  fastify.get<{ Params: { email: string } }>(
    "/profil/:email/poster-choices",
    async (req, reply) => {
      const { email } = req.params;
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return reply.send({});

      const choices = await prisma.userPosterChoice.findMany({
        where: { userId: user.id },
        select: { filmId: true, posterUrl: true },
      });

      // Retourner un objet { filmId: posterUrl }
      const map: Record<string, string> = {};
      for (const c of choices) map[c.filmId] = c.posterUrl;
      return reply.send(map);
    }
  );

  // ── DELETE /api/profil/:email/poster-choice/:filmId ──
  // Réinitialise l'affiche d'un film (revient à l'affiche par défaut)
  fastify.delete<{ Params: { email: string; filmId: string } }>(
    "/profil/:email/poster-choice/:filmId",
    async (req, reply) => {
      const { email, filmId } = req.params;
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return reply.send({ ok: true });

      await prisma.userPosterChoice.deleteMany({
        where: { userId: user.id, filmId },
      });
      return reply.send({ ok: true });
    }
  );

  // ── GET /api/profil/:email/recommandations ───────────
  // Retourne jusqu'à 20 films recommandés (Pro only)
  // Basé sur les genres et réalisateurs des films vus
  fastify.get<{ Params: { email: string } }>(
    "/profil/:email/recommandations",
    async (req, reply) => {
      const { email } = req.params;
      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          isPremium: true,
          filmsVus: {
            take: 200,
            select: { filmId: true, film: { select: { genres: true, realisateur: true } } },
          },
          watchlist: { select: { filmId: true } },
          filmsFavoris: { select: { filmId: true } },
        },
      });

      if (!user) return reply.status(404).send({ error: "Utilisateur introuvable" });
      if (!user.isPremium) return reply.status(403).send({ error: "Fonctionnalité réservée aux membres Pro" });

      // Construire la liste des IDs déjà vus/watchlist/favoris
      const seenIds = new Set<string>([
        ...user.filmsVus.map((fv) => fv.filmId),
        ...user.watchlist.map((w) => w.filmId),
        ...user.filmsFavoris.map((f) => f.filmId),
      ]);

      // Calculer les genres et réalisateurs préférés (score par fréquence)
      const genreScore = new Map<string, number>();
      const realScore  = new Map<string, number>();

      for (const fv of user.filmsVus) {
        for (const g of fv.film.genres) {
          genreScore.set(g, (genreScore.get(g) ?? 0) + 1);
        }
        if (fv.film.realisateur) {
          realScore.set(fv.film.realisateur, (realScore.get(fv.film.realisateur) ?? 0) + 1);
        }
      }

      const topGenres = [...genreScore.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g);
      const topReals  = [...realScore.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([r]) => r);

      if (topGenres.length === 0 && topReals.length === 0) {
        return reply.send([]);
      }

      // Requête films candidats : match genre ou réalisateur, non vus
      const candidats = await prisma.film.findMany({
        where: {
          id: { notIn: [...seenIds] },
          OR: [
            ...(topGenres.length > 0 ? [{ genres: { hasSome: topGenres } }] : []),
            ...(topReals.length > 0  ? [{ realisateur: { in: topReals } }] : []),
          ],
        },
        select: {
          id: true, titre: true, titreOriginal: true,
          affiche: true, annee: true, realisateur: true,
          genres: true, imdbNote: true, synopsis: true,
        },
        take: 200,
      });

      // Scorer chaque candidat
      const scored = candidats.map((film) => {
        let score = 0;
        for (const g of film.genres) {
          const w = genreScore.get(g) ?? 0;
          score += w;
        }
        if (film.realisateur) {
          const w = realScore.get(film.realisateur) ?? 0;
          score += w * 3; // bonus réalisateur
        }
        // Bonus note IMDB
        if (film.imdbNote && film.imdbNote >= 7) score += 2;
        return { ...film, score };
      });

      scored.sort((a, b) => b.score - a.score || (b.imdbNote ?? 0) - (a.imdbNote ?? 0));

      return reply.send(scored.slice(0, 20));
    }
  );

  // ── GET /api/profil/:email/calendar ──────────────────
  // Exporte les films récemment vus en .ics (Pro only)
  fastify.get<{ Params: { email: string } }>(
    "/profil/:email/calendar",
    async (req, reply) => {
      const { email } = req.params;
      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          isPremium: true,
          nom: true,
          filmsVus: {
            orderBy: { dateVu: "desc" },
            take: 100,
            select: {
              id: true,
              dateVu: true,
              film: { select: { id: true, titre: true, annee: true, genres: true, synopsis: true } },
            },
          },
        },
      });

      if (!user) return reply.status(404).send({ error: "Utilisateur introuvable" });
      if (!user.isPremium) return reply.status(403).send({ error: "Fonctionnalité réservée aux membres Pro" });

      const now = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";
      const uid = (id: string) => `${id}@cineradar.fr`;

      const toIcsDate = (d: Date) =>
        d.toISOString().replace(/[-:.]/g, "").slice(0, 8);

      const escape = (s: string) =>
        s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

      const events = user.filmsVus.map((fv) => {
        const date = toIcsDate(fv.dateVu);
        const title = escape(fv.film.titre);
        const desc  = escape(fv.film.synopsis?.slice(0, 200) ?? "");
        return [
          "BEGIN:VEVENT",
          `UID:${uid(fv.id)}`,
          `DTSTAMP:${now}`,
          `DTSTART;VALUE=DATE:${date}`,
          `DTEND;VALUE=DATE:${date}`,
          `SUMMARY:🎬 ${title}`,
          desc ? `DESCRIPTION:${desc}` : null,
          `CATEGORIES:${fv.film.genres.join(",")}`,
          `URL:https://cineradar.fr/films/${fv.film.id}`,
          "END:VEVENT",
        ].filter(Boolean).join("\r\n");
      }).join("\r\n");

      const ics = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//CinéRadar//FR",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        `X-WR-CALNAME:CinéRadar — ${escape(user.nom ?? email)}`,
        "X-WR-TIMEZONE:Europe/Paris",
        events,
        "END:VCALENDAR",
      ].join("\r\n");

      reply
        .header("Content-Type", "text/calendar; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="cineradar.ics"`)
        .send(ics);
    }
  );
};

export default profilRoutes;
