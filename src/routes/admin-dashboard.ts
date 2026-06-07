// ─────────────────────────────────────────────────────────
//  Routes admin dashboard — statistiques complètes
//  Toutes les routes sont protégées par X-Admin-Secret
// ─────────────────────────────────────────────────────────

import { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";

const ADMIN_SECRET = process.env["ADMIN_SECRET"] ?? "";

function checkSecret(secret: string | undefined): boolean {
  return !!ADMIN_SECRET && secret === ADMIN_SECRET;
}

const adminDashboardRoutes: FastifyPluginAsync = async (fastify) => {

  // ── Middleware secret ─────────────────────────────────
  fastify.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/admin/dashboard")) return;
    const secret = request.headers["x-admin-secret"] as string | undefined;
    if (!checkSecret(secret)) {
      reply.code(401).send({ error: "Non autorisé" });
    }
  });

  // ── GET /admin/dashboard/overview ────────────────────
  fastify.get("/admin/dashboard/overview", async () => {
    const now = new Date();
    const il7j = new Date(now); il7j.setDate(il7j.getDate() - 7);
    const il30j = new Date(now); il30j.setDate(il30j.getDate() - 30);
    const debutMois = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalUsers,
      usersVerifies,
      usersPremium,
      newUsersWeek,
      newUsersMonth,
      totalFilms,
      totalCinemas,
      totalSeancesFutures,
      totalAvis,
      totalAlertes,
      totalFilmsVus,
      totalWatchlist,
      totalListes,
      newAvisWeek,
      newAlertesMonth,
      inscriptionsMois,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { emailVerified: true } }),
      prisma.user.count({ where: { isPremium: true } }),
      prisma.user.count({ where: { createdAt: { gte: il7j } } }),
      prisma.user.count({ where: { createdAt: { gte: il30j } } }),
      prisma.film.count(),
      prisma.cinema.count(),
      prisma.seance.count({ where: { dateHeure: { gte: now } } }),
      prisma.avis.count(),
      prisma.alerte.count({ where: { active: true } }),
      prisma.filmVu.count(),
      prisma.watchlistItem.count(),
      prisma.liste.count(),
      prisma.avis.count({ where: { createdAt: { gte: il7j } } }),
      prisma.alerte.count({ where: { createdAt: { gte: il30j } } }),
      // Inscriptions par jour ce mois-ci
      prisma.user.groupBy({
        by: ["createdAt"],
        where: { createdAt: { gte: debutMois } },
        _count: true,
        orderBy: { createdAt: "asc" },
      }),
    ]);

    // Agrégation des inscriptions par jour
    const inscriptionsParJour: Record<string, number> = {};
    for (const r of inscriptionsMois) {
      const day = (r.createdAt as Date).toISOString().slice(0, 10);
      inscriptionsParJour[day] = (inscriptionsParJour[day] ?? 0) + r._count;
    }

    return {
      users: {
        total: totalUsers,
        verifies: usersVerifies,
        premium: usersPremium,
        newThisWeek: newUsersWeek,
        newThisMonth: newUsersMonth,
        tauxVerification: totalUsers > 0 ? Math.round((usersVerifies / totalUsers) * 100) : 0,
        tauxPremium: totalUsers > 0 ? Math.round((usersPremium / totalUsers) * 100) : 0,
      },
      contenu: {
        films: totalFilms,
        cinemas: totalCinemas,
        seancesFutures: totalSeancesFutures,
        avis: totalAvis,
        alertesActives: totalAlertes,
        filmsVus: totalFilmsVus,
        watchlist: totalWatchlist,
        listes: totalListes,
      },
      activiteRecente: {
        newAvisWeek,
        newAlertesMonth,
      },
      inscriptionsParJour,
    };
  });

  // ── GET /admin/dashboard/users ────────────────────────
  fastify.get("/admin/dashboard/users", async (request) => {
    const q = (request.query as Record<string, string>);
    const page  = Math.max(1, parseInt(q["page"] ?? "1"));
    const limit = Math.min(100, parseInt(q["limit"] ?? "50"));
    const skip  = (page - 1) * limit;
    const search = q["q"] ?? "";

    const where = search
      ? {
          OR: [
            { pseudo:  { contains: search, mode: "insensitive" as const } },
            { email:   { contains: search, mode: "insensitive" as const } },
            { nom:     { contains: search, mode: "insensitive" as const } },
            { ville:   { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {};

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          pseudo: true,
          nom: true,
          email: true,
          avatar: true,
          ville: true,
          isPremium: true,
          emailVerified: true,
          isPublic: true,
          createdAt: true,
          genresPreferes: true,
          _count: {
            select: {
              filmsVus: true,
              filmsFavoris: true,
              watchlist: true,
              alertes: true,
              avis: true,
              following: true,
              followers: true,
              listesCreees: true,
            },
          },
        },
      }),
    ]);

    return { total, page, limit, users };
  });

  // ── GET /admin/dashboard/films ────────────────────────
  fastify.get("/admin/dashboard/films", async () => {
    const now = new Date();

    // Films les plus vus (FilmVu)
    const topVus = await prisma.filmVu.groupBy({
      by: ["filmId"],
      _count: { filmId: true },
      orderBy: { _count: { filmId: "desc" } },
      take: 30,
    });

    // Films les plus en watchlist
    const topWatchlist = await prisma.watchlistItem.groupBy({
      by: ["filmId"],
      _count: { filmId: true },
      orderBy: { _count: { filmId: "desc" } },
      take: 30,
    });

    // Films les plus favoris
    const topFavoris = await prisma.filmFavori.groupBy({
      by: ["filmId"],
      _count: { filmId: true },
      orderBy: { _count: { filmId: "desc" } },
      take: 30,
    });

    // Films avec le plus d'alertes actives
    const topAlertes = await prisma.alerte.groupBy({
      by: ["filmId"],
      where: { active: true, filmId: { not: null } },
      _count: { filmId: true },
      orderBy: { _count: { filmId: "desc" } },
      take: 30,
    });

    // Films avec le plus d'avis
    const topAvis = await prisma.avis.groupBy({
      by: ["filmId"],
      _count: { filmId: true },
      orderBy: { _count: { filmId: "desc" } },
      take: 30,
    });

    // Récupérer les détails des films concernés
    const allFilmIds = [
      ...new Set([
        ...topVus.map(r => r.filmId),
        ...topWatchlist.map(r => r.filmId),
        ...topFavoris.map(r => r.filmId),
        ...topAlertes.map(r => r.filmId).filter(Boolean) as string[],
        ...topAvis.map(r => r.filmId),
      ]),
    ];

    const films = await prisma.film.findMany({
      where: { id: { in: allFilmIds } },
      select: {
        id: true,
        titre: true,
        affiche: true,
        annee: true,
        genres: true,
        realisateur: true,
        _count: {
          select: {
            seances: { where: { dateHeure: { gte: now } } },
          },
        },
      },
    });

    const filmMap = new Map(films.map(f => [f.id, f]));

    // Helpers pour extraire le count depuis groupBy (Prisma retourne _count comme objet)
    const getCount = (arr: Array<{ filmId: string; _count: { filmId: number } | number | boolean }>, id: string): number => {
      const row = arr.find(r => r.filmId === id);
      if (!row) return 0;
      const c = row._count;
      if (typeof c === "object" && c !== null && "filmId" in c) return (c as { filmId: number }).filmId;
      return 0;
    };
    const getAlertCount = (arr: Array<{ filmId: string | null; _count: { filmId: number } | number | boolean }>, id: string): number => {
      const row = arr.find(r => r.filmId === id);
      if (!row) return 0;
      const c = row._count;
      if (typeof c === "object" && c !== null && "filmId" in c) return (c as { filmId: number }).filmId;
      return 0;
    };

    // Score composite : vus×4 + watchlist×3 + favoris×3 + alertes×2 + avis×2
    const scores = new Map<string, number>();
    for (const r of topVus) {
      const c = typeof r._count === "object" && "filmId" in r._count ? r._count.filmId : 0;
      scores.set(r.filmId, (scores.get(r.filmId) ?? 0) + c * 4);
    }
    for (const r of topWatchlist) {
      const c = typeof r._count === "object" && "filmId" in r._count ? r._count.filmId : 0;
      scores.set(r.filmId, (scores.get(r.filmId) ?? 0) + c * 3);
    }
    for (const r of topFavoris) {
      const c = typeof r._count === "object" && "filmId" in r._count ? r._count.filmId : 0;
      scores.set(r.filmId, (scores.get(r.filmId) ?? 0) + c * 3);
    }
    for (const r of topAlertes) {
      if (r.filmId) {
        const c = typeof r._count === "object" && "filmId" in r._count ? r._count.filmId : 0;
        scores.set(r.filmId, (scores.get(r.filmId) ?? 0) + c * 2);
      }
    }
    for (const r of topAvis) {
      const c = typeof r._count === "object" && "filmId" in r._count ? r._count.filmId : 0;
      scores.set(r.filmId, (scores.get(r.filmId) ?? 0) + c * 2);
    }

    const ranked = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([filmId, score]) => {
        const film = filmMap.get(filmId);
        return {
          film,
          score,
          vus:       getCount(topVus as Parameters<typeof getCount>[0], filmId),
          watchlist: getCount(topWatchlist as Parameters<typeof getCount>[0], filmId),
          favoris:   getCount(topFavoris as Parameters<typeof getCount>[0], filmId),
          alertes:   getAlertCount(topAlertes as Parameters<typeof getAlertCount>[0], filmId),
          avis:      getCount(topAvis as Parameters<typeof getCount>[0], filmId),
          seancesActives: film?._count.seances ?? 0,
        };
      });

    return { top25: ranked };
  });

  // ── GET /admin/dashboard/geo ──────────────────────────
  fastify.get("/admin/dashboard/geo", async () => {
    // Distribution des utilisateurs par ville
    const villeGroups = await prisma.user.groupBy({
      by: ["ville"],
      where: { ville: { not: null } },
      _count: { ville: true },
      orderBy: { _count: { ville: "desc" } },
    });

    // Distribution des cinémas par ville
    const cinemaGroups = await prisma.cinema.groupBy({
      by: ["ville"],
      _count: { ville: true },
      orderBy: { _count: { ville: "desc" } },
      take: 30,
    });

    // Séances par ville (via cinema)
    const seancesParVille = await prisma.cinema.findMany({
      select: {
        ville: true,
        _count: {
          select: {
            salles: true,
          },
        },
      },
      orderBy: { ville: "asc" },
    });

    const villesUsersMap: Record<string, number> = {};
    for (const g of villeGroups) {
      if (g.ville) villesUsersMap[g.ville] = g._count.ville;
    }

    const villesCinemasMap: Record<string, number> = {};
    for (const g of cinemaGroups) {
      villesCinemasMap[g.ville] = g._count.ville;
    }

    const usersParVille = Object.entries(villesUsersMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([ville, count]) => ({ ville, count }));

    const cinemasParVille = Object.entries(villesCinemasMap)
      .slice(0, 20)
      .map(([ville, count]) => ({ ville, count }));

    // Utilisateurs sans ville renseignée
    const sansVille = await prisma.user.count({ where: { ville: null } });
    const avecVille = await prisma.user.count({ where: { ville: { not: null } } });

    return {
      usersParVille,
      cinemasParVille,
      couverture: { avecVille, sansVille },
    };
  });

  // ── GET /admin/dashboard/activity ────────────────────
  fastify.get("/admin/dashboard/activity", async () => {
    const now = new Date();
    const il30j = new Date(now); il30j.setDate(il30j.getDate() - 30);

    // Derniers inscrits
    const derniersInscrits = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        pseudo: true,
        nom: true,
        email: true,
        avatar: true,
        ville: true,
        isPremium: true,
        emailVerified: true,
        createdAt: true,
      },
    });

    // Derniers avis postés
    const derniersAvis = await prisma.avis.findMany({
      orderBy: { createdAt: "desc" },
      take: 15,
      include: {
        user: { select: { pseudo: true, avatar: true } },
        film: { select: { titre: true, affiche: true } },
      },
    });

    // Dernières alertes créées
    const dernieresAlertes = await prisma.alerte.findMany({
      where: { active: true },
      orderBy: { createdAt: "desc" },
      take: 15,
      include: {
        user: { select: { pseudo: true } },
        film: { select: { titre: true, affiche: true } },
      },
    });

    // Inscriptions par jour (30 derniers jours)
    const inscriptions30j = await prisma.user.findMany({
      where: { createdAt: { gte: il30j } },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    const inscParJour: Record<string, number> = {};
    for (let i = 0; i < 30; i++) {
      const d = new Date(il30j);
      d.setDate(d.getDate() + i);
      inscParJour[d.toISOString().slice(0, 10)] = 0;
    }
    for (const u of inscriptions30j) {
      const day = (u.createdAt as Date).toISOString().slice(0, 10);
      if (inscParJour[day] !== undefined) inscParJour[day]++;
    }

    // Genres les plus suivis (via genresPreferes)
    const allUsers = await prisma.user.findMany({
      where: { genresPreferes: { isEmpty: false } },
      select: { genresPreferes: true },
    });
    const genreCount: Record<string, number> = {};
    for (const u of allUsers) {
      for (const g of u.genresPreferes) {
        genreCount[g] = (genreCount[g] ?? 0) + 1;
      }
    }
    const topGenres = Object.entries(genreCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([genre, count]) => ({ genre, count }));

    return {
      derniersInscrits,
      derniersAvis,
      dernieresAlertes,
      inscriptionsParJour: inscParJour,
      topGenres,
    };
  });
};

export default adminDashboardRoutes;
