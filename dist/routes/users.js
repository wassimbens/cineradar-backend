"use strict";
// ─────────────────────────────────────────────────────────
//  Routes utilisateurs — recherche de profils publics
//
//  GET /api/users/search?q=pseudo    Recherche par pseudo / nom
// ─────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const usersRoutes = async (fastify) => {
    // ── GET /api/users/search?q= ──────────────────────────
    fastify.get("/users/search", async (req, reply) => {
        const q = (req.query.q ?? "").trim();
        if (q.length < 2)
            return reply.send([]);
        const users = await prisma.user.findMany({
            where: {
                OR: [
                    { pseudo: { contains: q, mode: "insensitive" } },
                    { nom: { contains: q, mode: "insensitive" } },
                ],
                NOT: { pseudo: null },
                isPublic: true,
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
                        filmsVus: true,
                        avis: true,
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
exports.default = usersRoutes;
//# sourceMappingURL=users.js.map