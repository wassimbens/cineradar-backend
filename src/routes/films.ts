// ─────────────────────────────────────────────────────────
//  Routes Films
//
//  GET /api/films?q=           Recherche par titre
//  GET /api/films/:id          Fiche complète d'un film
//  GET /api/films/:id/seances  Séances groupées par cinéma
//  GET /api/films/:id/trailer  YouTube trailer via TMDB
// ─────────────────────────────────────────────────────────

import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { Version } from "@prisma/client";
import { filmsService, type CatalogSort } from "../services/films.service.js";
import { cacheGet, cacheSet } from "../lib/redis.js";
import { prisma } from "../lib/prisma.js";

const TMDB_KEY = process.env["TMDB_API_KEY"];
const TMDB_BASE = "https://api.themoviedb.org/3";

const TTL = 60 * 30; // 30 minutes

// ── Schémas de validation ─────────────────────────────────

const searchQuerySchema = z.object({
  q:        z.string().max(100).trim().optional(),
  genre:    z.string().max(80).trim().optional(),
  decennie: z.coerce.number().int().min(1900).max(2030).optional(),
  sort:     z.enum(["titre", "annee_desc", "annee_asc", "seances"]).optional(),
  page:     z.coerce.number().int().min(1).optional(),
  limit:    z.coerce.number().int().min(1).max(200).optional(),
  offset:   z.coerce.number().int().min(0).optional(),
});

const seancesQuerySchema = z.object({
  ville:   z.string().trim().optional(),
  date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format attendu : YYYY-MM-DD").optional(),
  version: z.nativeEnum(Version).optional(),
});

// ── Plugin Fastify ────────────────────────────────────────

const filmsRoutes: FastifyPluginAsync = async (fastify) => {

  // ── GET /api/films/trending ───────────────────────────
  fastify.get("/films/trending", async (request, reply) => {
    const { limit = "8", ville = "" } = request.query as { limit?: string; ville?: string };
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 8, 1), 20);
    const villeKey = ville.trim().toLowerCase();
    const cacheKey = `films:trending:${limitNum}:${villeKey}`;
    const cached = await cacheGet(cacheKey);
    if (cached) { reply.header("X-Cache", "HIT"); return cached; }

    const films = await filmsService.getTrendingFilms(limitNum, ville.trim());
    await cacheSet(cacheKey, films, 60 * 10); // 10 min
    reply.header("X-Cache", "MISS");
    return films;
  });

  // ── GET /api/films/classics ───────────────────────────
  fastify.get("/films/classics", async (_request, reply) => {
    const cacheKey = "films:classics";
    const cached = await cacheGet(cacheKey);
    if (cached) { reply.header("X-Cache", "HIT"); return cached; }

    const films = await filmsService.getClassicFilms(18);
    await cacheSet(cacheKey, films, 60 * 60); // 1h
    reply.header("X-Cache", "MISS");
    return films;
  });

  // ── GET /api/films/all-classics ───────────────────────
  fastify.get("/films/all-classics", async (_request, reply) => {
    const cacheKey = "films:all-classics";
    const cached = await cacheGet(cacheKey);
    if (cached) { reply.header("X-Cache", "HIT"); return cached; }

    const films = await filmsService.getAllClassicFilms();
    await cacheSet(cacheKey, films, 60 * 60 * 2); // 2h
    reply.header("X-Cache", "MISS");
    return films;
  });

  // ── GET /api/films?q= ─────────────────────────────────
  /**
   * Recherche des films par titre.
   * @query q {string} Terme de recherche (min 1 car.)
   * @returns FilmSummary[]
   */
  fastify.get("/films", async (request, reply) => {
    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Paramètre invalide",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { q = "", genre, decennie, sort, page, limit, offset } = parsed.data;

    // Route catalogue enrichie (avec filtres avancés ou pagination)
    if (genre !== undefined || decennie !== undefined || sort !== undefined || page !== undefined) {
      const effectiveLimit = limit ?? 48;
      const cacheKey = `films:catalog:${q}:${genre ?? ""}:${decennie ?? ""}:${sort ?? ""}:${page ?? 1}:${effectiveLimit}`;
      const cached = await cacheGet(cacheKey);
      if (cached) { reply.header("X-Cache", "HIT"); return cached; }

      const result = await filmsService.getCatalogFilms({
        q,
        genre,
        decennie,
        sort: sort as CatalogSort | undefined,
        page: page ?? 1,
        limit: effectiveLimit,
      });

      await cacheSet(cacheKey, result, TTL);
      reply.header("X-Cache", "MISS");
      return result;
    }

    // Route recherche simple (compat ascendante)
    const cacheKey = `films:search:${q.toLowerCase()}:${limit ?? ""}:${offset ?? ""}`;
    const cached = await cacheGet(cacheKey);
    if (cached) {
      reply.header("X-Cache", "HIT");
      return cached;
    }

    let films = await filmsService.searchFilms(q);
    if (offset) films = films.slice(offset);
    if (limit)  films = films.slice(0, limit);

    await cacheSet(cacheKey, films, TTL);
    reply.header("X-Cache", "MISS");
    return films;
  });


  // ── GET /api/films/:id ────────────────────────────────
  /**
   * Fiche complète d'un film (synopsis, acteurs, etc.).
   * @param id {string} Identifiant Prisma du film
   * @returns Film | 404
   */
  fastify.get<{ Params: { id: string } }>("/films/:id", async (request, reply) => {
    const { id } = request.params;
    const cacheKey = `films:detail:${id}`;

    const cached = await cacheGet(cacheKey);
    if (cached) {
      reply.header("X-Cache", "HIT");
      return cached;
    }

    const film = await filmsService.getFilmById(id);
    if (!film) {
      return reply.code(404).send({ error: "Film introuvable" });
    }

    await cacheSet(cacheKey, film, TTL);
    reply.header("X-Cache", "MISS");
    return film;
  });


  // ── GET /api/films/:id/seances ────────────────────────
  /**
   * Séances d'un film groupées par cinéma.
   * @param id      {string} Identifiant Prisma du film
   * @query ville   {string} Filtre par ville (ex: "Paris")
   * @query date    {string} Filtre par date "YYYY-MM-DD" (défaut: aujourd'hui)
   * @query version {Version} Filtre par version VO | VF | VOSTFR
   * @returns SeancesParCinema[]
   */
  fastify.get<{ Params: { id: string } }>("/films/:id/seances", async (request, reply) => {
    const { id } = request.params;

    const parsed = seancesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Paramètre invalide",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const filters = parsed.data;
    const cacheKey = `films:${id}:seances:${filters.ville ?? ""}:${filters.date ?? "today"}:${filters.version ?? ""}`;

    const cached = await cacheGet(cacheKey);
    if (cached) {
      reply.header("X-Cache", "HIT");
      return cached;
    }

    // Vérifier que le film existe
    const film = await filmsService.getFilmById(id);
    if (!film) {
      return reply.code(404).send({ error: "Film introuvable" });
    }

    const seances = await filmsService.getFilmSeances(id, filters);

    await cacheSet(cacheKey, seances, TTL);
    reply.header("X-Cache", "MISS");
    return seances;
  });


  // ── GET /api/films/:id/dates ─────────────────────────
  /**
   * Retourne les dates (YYYY-MM-DD) des 30 prochains jours où le film
   * a au moins une séance. Utilisé par le DayPicker pour afficher
   * un contour rouge sur les jours disponibles.
   */
  fastify.get<{ Params: { id: string } }>("/films/:id/dates", async (request, reply) => {
    const { id } = request.params;

    const cacheKey = `films:dates:${id}`;
    const cached = await cacheGet(cacheKey);
    if (cached) { reply.header("X-Cache", "HIT"); return cached; }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + 30);

    const seances = await prisma.seance.findMany({
      where: { filmId: id, dateHeure: { gte: today, lte: horizon } },
      select: { dateHeure: true },
    });

    const dateSet = new Set<string>();
    for (const s of seances) {
      const d = new Date(s.dateHeure);
      // Timezone Paris (UTC+1/+2)
      const paris = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
      const iso = `${paris.getFullYear()}-${String(paris.getMonth() + 1).padStart(2, "0")}-${String(paris.getDate()).padStart(2, "0")}`;
      dateSet.add(iso);
    }

    const result = { dates: [...dateSet].sort() };
    await cacheSet(cacheKey, result, 60 * 15); // 15 min
    reply.header("X-Cache", "MISS");
    return result;
  });

  // ── GET /api/films/:id/trailer ────────────────────────
  /**
   * Retourne l'ID YouTube de la bande annonce d'un film.
   * Stratégie : TMDB d'abord, puis recherche YouTube en fallback.
   * @returns { youtubeId: string | null }
   */
  fastify.get<{ Params: { id: string } }>("/films/:id/trailer", async (request, reply) => {
    const { id } = request.params;

    const cacheKey = `films:trailer:${id}`;
    const cached = await cacheGet(cacheKey);
    if (cached) { reply.header("X-Cache", "HIT"); return cached; }

    const film = await filmsService.getFilmById(id);
    if (!film) return reply.code(404).send({ error: "Film introuvable" });

    let youtubeId: string | null = null;
    let tmdbIsLowQuality = false; // true si TMDB n'a que du SD (<720p)

    // ── 1. TMDB ──────────────────────────────────────────
    // Priorité : bandes annonces officielles récentes VF/VO
    if (TMDB_KEY && film.tmdbId) {
      try {
        const tmdbId = film.tmdbId;

        type TmdbVideo = {
          type: string; site: string; key: string; iso_639_1: string;
          official: boolean; published_at: string; name: string; size: number;
        };

        const fetcher = (lang: string) =>
          fetch(`${TMDB_BASE}/movie/${tmdbId}/videos?api_key=${TMDB_KEY}&language=${lang}`, {
            signal: AbortSignal.timeout(6_000),
          }).then(r => r.ok ? r.json() as Promise<{ results: TmdbVideo[] }> : { results: [] as TmdbVideo[] })
            .catch(() => ({ results: [] as TmdbVideo[] }));

        const [fr, en] = await Promise.all([fetcher("fr-FR"), fetcher("en-US")]);
        const frVids = fr.results ?? [];
        const enVids = en.results ?? [];

        // Dédupliquer : garder les vidéos fr en priorité, ajouter les en non présentes
        const frKeys = new Set(frVids.map(v => v.key));
        const all = [...frVids, ...enVids.filter(v => !frKeys.has(v.key))];

        // Canaux YouTube officiels connus (matchés dans le nom de la vidéo)
        const OFFICIAL_CHANNELS = [
          "pathé", "pathe", "ugc", "mk2", "allociné", "allocine",
          "warner", "sony", "disney", "universal", "paramount",
          "netflix", "amazon", "apple", "studio canal", "studiocanal",
          "gaumont", "ad vitam", "wild bunch",
        ];

        const isOfficialChannel = (v: TmdbVideo) =>
          v.official ||
          OFFICIAL_CHANNELS.some(ch => v.name.toLowerCase().includes(ch));

        /**
         * Score de sélection :
         *   +100  vidéo officielle TMDB (flag official=true ou nom de canal connu)
         *   + 50  type Trailer (vs Teaser ou autre)
         *   + 20  langue française (VF)
         *   + 10  résolution ≥ 1080p
         *   +  5  résolution ≥ 720p
         *   + 0…30 récence (année de publication, max 2030 → 30 pts)
         *   -999  non YouTube → éliminé
         */
        const scoreVideo = (v: TmdbVideo): number => {
          if (v.site !== "YouTube") return -999;
          let s = 0;
          if (isOfficialChannel(v))    s += 100;
          if (v.type === "Trailer")    s += 50;
          if (v.iso_639_1 === "fr")    s += 20;
          if (v.size >= 1080)          s += 10;
          else if (v.size >= 720)      s += 5;
          // Récence : chaque année après 2000 = +1 pt (max ~30 pts pour 2030)
          if (v.published_at) {
            const year = new Date(v.published_at).getFullYear();
            s += Math.max(0, Math.min(30, year - 2000));
          }
          return s;
        };

        // Filtrer les vidéos YouTube pertinentes (Trailer ou Teaser)
        const candidates = all
          .filter(v => v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser"))
          .sort((a, b) => scoreVideo(b) - scoreVideo(a));

        const best = candidates[0];
        if (best) {
          youtubeId = best.key;
          // Si la meilleure vidéo TMDB est en SD (<720p), on tentera YouTube
          // pour trouver une version HD (remaster, reupload officiel)
          if (best.size < 720) tmdbIsLowQuality = true;
        }
      } catch {
        // TMDB indisponible → fallback YouTube
      }
    }

    // ── 2. Fallback YouTube ───────────────────────────────
    // Activé si : pas de trailer TMDB OU TMDB n'a que du SD (<720p)
    // Priorité : canaux officiels VF → bande annonce officielle → VO
    if (!youtubeId || tmdbIsLowQuality) {
      const titre = film.titre;
      const annee = film.annee ? ` ${film.annee}` : "";
      const titreOrig = film.titreOriginal && film.titreOriginal !== film.titre
        ? film.titreOriginal : null;

      // Pour les films dont TMDB n'a que du SD, on cherche une version HD sur YT
      const hdSuffix = tmdbIsLowQuality ? " HD" : "";

      // Canaux officiels à cibler en priorité dans la requête
      const OFFICIAL_CHANNEL_QUERIES = [
        `${titre}${annee} bande annonce officielle Pathé${hdSuffix}`,
        `${titre}${annee} bande annonce officielle UGC${hdSuffix}`,
        `${titre}${annee} bande annonce officielle MK2${hdSuffix}`,
        `${titre}${annee} bande annonce officielle AlloCiné${hdSuffix}`,
        `${titre}${annee} bande annonce VF${hdSuffix}`,
        `${titre}${annee} bande annonce officielle`,
        titreOrig ? `${titreOrig}${annee} official trailer HD` : null,
        titreOrig ? `${titreOrig}${annee} official trailer` : null,
        `${titre}${annee} trailer`,
      ].filter(Boolean) as string[];

      // Identifiants de chaînes YouTube officielles connues
      const OFFICIAL_YT_CHANNELS = new Set([
        // Distribution France
        "UCe1sq4dOGaOuuBhXVA4W6Zw", // Pathé Films
        "UC9yqFE_r0bfKe0ymUEQj2Wg", // UGC
        "UC7q5GBFOkqJYFIjlXM9nxNg", // MK2
        "UCbmNph6atAoGfqLoCL_duAg", // AlloCiné
        // Studios américains (chaînes FR)
        "UCjmJDjCkMBTRnHLNAkEoMCA", // Warner Bros France
        "UCpZ5xPFAuTa0nD-SCl-SROA", // Sony Pictures France
        "UCgGs-HUAthZQdROkBrfFRcw", // Disney FR
        "UCn3sQnZR7WllLFKCFj0Jwnw", // Universal Pictures FR
        "UCddiUEpeqJcYeBxX1IVBKvQ", // Paramount Pictures FR
      ]);

      const extractVideoIds = (html: string): string[] => {
        const ids: string[] = [];
        for (const m of html.matchAll(/"videoId"\s*:\s*"([A-Za-z0-9_-]{11})"/g)) {
          if (!ids.includes(m[1])) ids.push(m[1]);
          if (ids.length >= 5) break; // garder les 5 premiers résultats
        }
        return ids;
      };

      const extractChannelIds = (html: string): Map<string, string> => {
        // Associe videoId → channelId depuis le JSON YouTube embarqué
        const map = new Map<string, string>();
        // Pattern : "videoId":"XXXXX"... "channelId":"YYYYY"
        const chunks = html.split(/"videoId"\s*:\s*"/);
        for (const chunk of chunks.slice(1)) {
          const vid = chunk.slice(0, 11);
          const chMatch = chunk.match(/"channelId"\s*:\s*"([A-Za-z0-9_-]+)"/);
          if (vid.length === 11 && chMatch) map.set(vid, chMatch[1]);
        }
        return map;
      };

      for (const query of OFFICIAL_CHANNEL_QUERIES) {
        try {
          const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
          const res = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              "Accept-Language": "fr-FR,fr;q=0.9",
            },
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) continue;
          const html = await res.text();
          const ids = extractVideoIds(html);
          if (ids.length === 0) continue;

          // Préférer un résultat d'une chaîne officielle connue
          const channelMap = extractChannelIds(html);
          const official = ids.find(id => {
            const ch = channelMap.get(id);
            return ch && OFFICIAL_YT_CHANNELS.has(ch);
          });
          const found = official ?? ids[0];
          if (found) {
            // En mode upgrade HD : remplacer le TMDB SD par le résultat YT
            // En mode fallback pur : utiliser ce qu'on trouve
            youtubeId = found;
            break;
          }
        } catch {
          // essai suivant
        }
      }
    }

    const result = { youtubeId };
    // Cache 24h si trouvé, 20min si non trouvé
    await cacheSet(cacheKey, result, youtubeId ? 60 * 60 * 24 : 60 * 20);
    reply.header("X-Cache", "MISS");
    return result;
  });

  // ── GET /api/films/:id/rating ────────────────────────
  /**
   * Note communauté CinéRadar : moyenne des avis utilisateurs.
   * @returns { note: number | null, count: number }
   */
  fastify.get<{ Params: { id: string } }>("/films/:id/rating", async (request, reply) => {
    const { id } = request.params;

    const cacheKey = `films:rating:${id}`;
    const cached = await cacheGet(cacheKey);
    if (cached) { reply.header("X-Cache", "HIT"); return cached; }

    const agg = await prisma.avis.aggregate({
      where: { filmId: id, note: { not: null } },
      _avg: { note: true },
      _count: { note: true },
    });

    const result = {
      note: agg._avg.note != null ? Math.round(agg._avg.note * 10) / 10 : null,
      count: agg._count.note,
    };

    await cacheSet(cacheKey, result, 60 * 5); // 5 min
    reply.header("X-Cache", "MISS");
    return result;
  });

  // ── GET /api/films/:id/posters ───────────────────────
  /**
   * Retourne les affiches disponibles pour un film (TMDB).
   * Réservé aux membres Pro (vérifié côté frontend, l'endpoint est ouvert
   * car les images TMDB sont publiques de toute façon).
   * @returns { posters: string[] }  URLs complètes (w500)
   */
  fastify.get<{ Params: { id: string } }>("/films/:id/posters", async (request, reply) => {
    const { id } = request.params;

    const cacheKey = `films:posters:${id}`;
    const cached = await cacheGet(cacheKey);
    if (cached) { reply.header("X-Cache", "HIT"); return cached; }

    const film = await filmsService.getFilmById(id);
    if (!film) return reply.code(404).send({ error: "Film introuvable" });

    const posters: string[] = [];

    // Toujours inclure l'affiche principale si elle existe
    if (film.affiche) posters.push(film.affiche);

    if (TMDB_KEY) {
      type TmdbImage  = { file_path: string; vote_average: number; width: number };
      type TmdbImages = { posters?: TmdbImage[] };

      // Helper : récupère les affiches depuis un tmdbId numérique
      const fetchTmdbPosters = async (tmdbId: number): Promise<TmdbImage[]> => {
        const [frRes, enRes] = await Promise.all([
          fetch(`${TMDB_BASE}/movie/${tmdbId}/images?api_key=${TMDB_KEY}&include_image_language=fr,null`, {
            signal: AbortSignal.timeout(6_000),
          }).then(r => r.ok ? r.json() as Promise<TmdbImages> : { posters: [] }),
          fetch(`${TMDB_BASE}/movie/${tmdbId}/images?api_key=${TMDB_KEY}&include_image_language=en,null`, {
            signal: AbortSignal.timeout(6_000),
          }).then(r => r.ok ? r.json() as Promise<TmdbImages> : { posters: [] }),
        ]);
        return [...((frRes as TmdbImages).posters ?? []), ...((enRes as TmdbImages).posters ?? [])];
      };

      try {
        let tmdbImages: TmdbImage[] = [];

        if (film.tmdbId) {
          // Cas 1 : tmdbId connu → fetch direct
          tmdbImages = await fetchTmdbPosters(Number(film.tmdbId));
        } else if (film.titre) {
          // Cas 2 : pas de tmdbId → recherche par titre + année
          const q = encodeURIComponent(film.titre);
          const yearParam = film.annee ? `&year=${film.annee}` : "";
          const searchUrl = `${TMDB_BASE}/search/movie?api_key=${TMDB_KEY}&query=${q}${yearParam}&language=fr-FR`;
          const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(6_000) });
          if (searchRes.ok) {
            type TmdbSearchResult = { results?: { id: number; title: string }[] };
            const searchData = await searchRes.json() as TmdbSearchResult;
            const firstMatch = searchData.results?.[0];
            if (firstMatch?.id) {
              tmdbImages = await fetchTmdbPosters(firstMatch.id);
            }
          }
        }

        // Dédupliquer et trier par vote_average desc, max 12
        const seen = new Set<string>();
        const all = tmdbImages
          .filter(p => { if (seen.has(p.file_path)) return false; seen.add(p.file_path); return true; })
          .sort((a, b) => b.vote_average - a.vote_average)
          .slice(0, 12);

        for (const p of all) {
          const url = `https://image.tmdb.org/t/p/w500${p.file_path}`;
          if (!posters.includes(url)) posters.push(url);
        }
      } catch {
        // TMDB indisponible : retourner juste l'affiche principale
      }
    }

    const result = { posters };
    // Cache court (2h) pour que les nouveaux tmdbId soient pris en compte rapidement
    await cacheSet(cacheKey, result, 60 * 60 * 2);
    reply.header("X-Cache", "MISS");
    return result;
  });

};

export default filmsRoutes;
