// ─────────────────────────────────────────────────────────
//  AlertesService — création et gestion des alertes email
// ─────────────────────────────────────────────────────────

import { prisma } from "../lib/prisma.js";

export interface CreateAlerteInput {
  email: string;
  filmTitre: string;
  ville: string;
  rayon: number;
}

export class AlertesService {
  /**
   * Crée une alerte en base de données.
   * Si une alerte identique (même email + filmTitre + ville) existe déjà,
   * on la retourne sans doublon.
   */
  async createAlerte(input: CreateAlerteInput) {
    const { email, filmTitre, ville, rayon } = input;

    // Chercher un film correspondant au titre (pour lier l'alerte si possible)
    const film = await prisma.film.findFirst({
      where: { titre: { contains: filmTitre, mode: "insensitive" } },
    });

    // Vérifier si une alerte identique existe déjà
    const existing = await prisma.alerte.findFirst({
      where: {
        email: { equals: email, mode: "insensitive" },
        filmTitre: { equals: filmTitre, mode: "insensitive" },
        ville: { equals: ville, mode: "insensitive" },
        active: true,
      },
    });

    if (existing) {
      return { alerte: existing, created: false };
    }

    const alerte = await prisma.alerte.create({
      data: {
        email,
        filmTitre,
        ville,
        rayon,
        ...(film ? { filmId: film.id } : {}),
      },
    });

    return { alerte, created: true };
  }

  /**
   * Désactive une alerte (désabonnement).
   */
  async deactivateAlerte(id: string) {
    return prisma.alerte.update({
      where: { id },
      data: { active: false },
    });
  }

  /**
   * Récupère toutes les alertes actives pour un email.
   */
  async getAlertesByEmail(email: string) {
    return prisma.alerte.findMany({
      where: { email: { equals: email, mode: "insensitive" }, active: true },
      orderBy: { createdAt: "desc" },
    });
  }
}

export const alertesService = new AlertesService();
