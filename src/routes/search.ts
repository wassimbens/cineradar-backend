// ─────────────────────────────────────────────────────────
//  Route Recherche Globale
//
//  GET /api/search?q=   Recherche simultanée films + cinémas
//
//  Retourne :
//  {
//    films:   FilmSummary[]    (max 10)
//    cinemas: CinemaSummary[]  (max 10)
//    total:   number
//  }
// ─────────────────────────────────────────────────────────

import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { filmsService } from "../services/films.service.js";
import { cinemasService } from "../services/cinemas.service.js";
import { cacheGet, cacheSet } from "../lib/redis.js";

const TTL = 60 * 30; // 30 minutes

// ── Schéma de validation ──────────────────────────────────

const searchQuerySchema = z.object({
  q: z.string().min(1).max(100).trim(),
});

// ── Plugin Fastify ────────────────────────────────────────

const searchRoutes: FastifyPluginAsync = async (fastify) => {

  // ── GET /api/search?q= ────────────────────────────────
  /**
   * Recherche globale : films ET cinémas en un seul appel.
   *
   * Stratégie :
   *  - Les deux requêtes Prisma tournent en parallèle (Promise.all)
   *  - Les résultats sont limités à 10 par catégorie côté API
   *    (le frontend peut en demander plus via les routes dédiées)
   *
   * @query q {string} Terme de recherche
   * @returns { films, cinemas, total }
   */
  fastify.get("/search", async (request, reply) => {
    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Paramètre invalide",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { q } = parsed.data;
    const cacheKey = `search:${q.toLowerCase()}`;

    // Lecture cache
    const cached = await cacheGet(cacheKey);
    if (cached) {
      reply.header("X-Cache", "HIT");
      return cached;
    }

    // Requêtes films et cinémas en parallèle
    const [filmsRaw, cinemasRaw] = await Promise.all([
      filmsService.searchFilms(q),
      // Pour les cinémas : on cherche aussi dans toutes les villes
      // en utilisant le nom du cinéma plutôt que la ville
      searchCinemasByName(q),
    ]);

    const result = {
      films: filmsRaw.slice(0, 10),
      cinemas: cinemasRaw.slice(0, 10),
      total: filmsRaw.length + cinemasRaw.length,
    };

    await cacheSet(cacheKey, result, TTL);
    reply.header("X-Cache", "MISS");
    return result;
  });

};

// ── Helper : recherche cinémas par nom ────────────────────
// (CinemasService.getCinemasByVille filtre par ville ;
//  ici on filtre par nom pour la recherche globale)

async function searchCinemasByName(q: string) {
  const { prisma } = await import("../lib/prisma.js");

  const today = new Date();
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setHours(23, 59, 59, 999);

  const cinemas = await prisma.cinema.findMany({
    where: {
      OR: [
        { nom:    { contains: q, mode: "insensitive" } },
        { ville:  { contains: q, mode: "insensitive" } },
        { chaine: { contains: q, mode: "insensitive" } },
      ],
    },
    include: {
      _count: { select: { salles: true } },
      salles: {
        include: {
          _count: {
            select: {
              seances: { where: { dateHeure: { gte: start, lte: end } } },
            },
          },
        },
      },
    },
    orderBy: { nom: "asc" },
    take: 20,
  });

  return cinemas.map((c) => ({
    id: c.id,
    nom: c.nom,
    adresse: c.adresse,
    ville: c.ville,
    codePostal: c.codePostal,
    latitude: c.latitude,
    longitude: c.longitude,
    siteWeb: c.siteWeb,
    telephone: c.telephone,
    chaine: c.chaine,
    sallesCount: c._count.salles,
    seancesAujourdhui: c.salles.reduce((acc, s) => acc + s._count.seances, 0),
  }));
}

export default searchRoutes;
