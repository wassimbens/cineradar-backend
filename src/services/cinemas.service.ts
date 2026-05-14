// ─────────────────────────────────────────────────────────
//  CinemasService — requêtes Prisma liées aux cinémas
// ─────────────────────────────────────────────────────────

import { prisma } from "../lib/prisma.js";

// ── Types retournés ───────────────────────────────────────

export interface CinemaSummary {
  id: string;
  nom: string;
  adresse: string;
  ville: string;
  codePostal: string;
  latitude: number | null;
  longitude: number | null;
  siteWeb: string | null;
  telephone: string | null;
  chaine: string | null;
  sallesCount: number;
  seancesAujourdhui: number;
}

/** Une ligne du programme : un film avec ses séances du jour */
export interface ProgrammeLigne {
  film: {
    id: string;
    titre: string;
    titreOriginal: string | null;
    affiche: string | null;
    duree: number | null;
    genres: string[];
    realisateur: string | null;
  };
  seances: {
    id: string;
    dateHeure: Date;
    version: string;
    format: string | null;
    prix: number | null;
    salleNom: string;
  }[];
}

// ── Service ───────────────────────────────────────────────

export class CinemasService {
  /**
   * Liste les cinémas d'une ville, triés par nombre de séances du jour.
   *
   * GET /api/cinemas?ville=Paris
   */
  async getCinemasByVille(ville: string): Promise<CinemaSummary[]> {
    const today = new Date();
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setHours(23, 59, 59, 999);

    const cinemas = await prisma.cinema.findMany({
      where: {
        ville: { contains: ville, mode: "insensitive" },
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
    });

    return cinemas
      .map((c) => {
        const seancesAujourdhui = c.salles.reduce(
          (acc, s) => acc + s._count.seances,
          0
        );
        return {
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
          seancesAujourdhui,
        };
      })
      .sort((a, b) => b.seancesAujourdhui - a.seancesAujourdhui);
  }

  /**
   * Retourne les informations complètes d'un cinéma.
   *
   * Utilisé par la fiche cinéma.
   */
  async getCinemaById(id: string) {
    return prisma.cinema.findUnique({
      where: { id },
      include: {
        salles: {
          select: { id: true, nom: true, capacite: true },
          orderBy: { nom: "asc" },
        },
      },
    });
  }

  /**
   * Retourne le programme d'un cinéma pour une date donnée,
   * groupé par film et trié par premier horaire.
   *
   * GET /api/cinemas/:id/programme?date=2026-04-07
   */
  async getCinemaProgramme(
    cinemaId: string,
    dateStr?: string
  ): Promise<ProgrammeLigne[]> {
    const targetDate = dateStr ? new Date(dateStr) : new Date();
    const start = new Date(targetDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(targetDate);
    end.setHours(23, 59, 59, 999);

    const seances = await prisma.seance.findMany({
      where: {
        salle: { cinemaId },
        dateHeure: { gte: start, lte: end },
      },
      include: {
        film: true,
        salle: { select: { nom: true } },
      },
      orderBy: { dateHeure: "asc" },
    });

    // Grouper par film
    const byFilm = new Map<string, ProgrammeLigne>();

    for (const s of seances) {
      const filmId = s.film.id;

      if (!byFilm.has(filmId)) {
        byFilm.set(filmId, {
          film: {
            id: s.film.id,
            titre: s.film.titre,
            titreOriginal: s.film.titreOriginal,
            affiche: s.film.affiche,
            duree: s.film.duree,
            genres: s.film.genres,
            realisateur: s.film.realisateur,
          },
          seances: [],
        });
      }

      byFilm.get(filmId)!.seances.push({
        id: s.id,
        dateHeure: s.dateHeure,
        version: s.version,
        format: s.format,
        prix: s.prix,
        salleNom: s.salle.nom,
      });
    }

    // Trier par titre de film
    return Array.from(byFilm.values()).sort((a, b) =>
      a.film.titre.localeCompare(b.film.titre, "fr")
    );
  }
}

export const cinemasService = new CinemasService();
