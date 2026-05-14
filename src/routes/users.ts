// ─────────────────────────────────────────────────────────
//  Routes utilisateurs — recherche de profils publics
//
//  GET /api/users/search?q=pseudo    Recherche par pseudo / nom
// ─────────────────────────────────────────────────────────

import { FastifyPluginAsync } from "fastify";
import { PrismaClient } from "@prisma/client";
import { extractUser } from "../middleware/auth.js";

const prisma = new PrismaClient();

const usersRoutes: FastifyPluginAsync = async (fastify) => {

  // ── GET /api/users/search?q= ──────────────────────────
  fastify.get<{ Querystring: { q?: string } }>("/users/search", async (req, reply) => {
    const q = (req.query.q ?? "").trim();
    if (q.length < 2) return reply.send([]);

    const me = extractUser(req);

    const users = await prisma.user.findMany({
      where: {
        OR: [
          { pseudo: { contains: q, mode: "insensitive" } },
          { nom:    { contains: q, mode: "insensitive" } },
        ],
        NOT: { pseudo: null },
        isPublic: true,
        // Exclure l'utilisateur connecté de ses propres résultats
        ...(me ? { id: { not: me.userId } } : {}),
      },
      select: {
        id: true,
        pseudo: true,
        nom: true,
        avatar: true,
        bio: true,
        ville: true,
        _count: {
          select: {
            filmsVus:  true,
            avis:      true,
            following: true,
            followers: true,
          },
        },
      },
      take: 20,
    });

    return reply.send(users);
  });
};

export default usersRoutes;
