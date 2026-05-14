// ─────────────────────────────────────────────────────────
//  Types partagés entre tous les scrapers
// ─────────────────────────────────────────────────────────

import { Version } from "@prisma/client";

// ── Film extrait depuis une page web ─────────────────────

export interface ScrapedFilm {
  /** Titre dans la langue de diffusion */
  titre: string;
  /** Titre original (si différent) */
  titreOriginal?: string;
  /** Durée en minutes */
  duree?: number;
  genres?: string[];
  realisateur?: string;
  synopsis?: string;
  /** URL absolue de l'affiche */
  affiche?: string;
  /** Identifiant interne de la source (ex : ugcFilmId = "17706") */
  sourceId?: string;
}

// ── Séance extraite ───────────────────────────────────────

export interface ScrapedSeance {
  dateHeure: Date;
  version: Version;
  /** "2D" | "3D" | "IMAX" | "Dolby Atmos" */
  format?: string;
  /** Nom de la salle, ex: "Salle 3" */
  salleNom?: string;
  prix?: number;
}

// ── Programme d'un film dans un cinéma ───────────────────

export interface ScrapedCinemaFilm {
  film: ScrapedFilm;
  seances: ScrapedSeance[];
}

// ── Cinéma entier ─────────────────────────────────────────

export interface ScrapedCinema {
  /** Identifiant dans la source, ex: "41" pour ugc.fr */
  sourceId: string;
  nom: string;
  adresse: string;
  ville: string;
  codePostal: string;
  siteWeb?: string;
  latitude?: number;
  longitude?: number;
  films: ScrapedCinemaFilm[];
}

// ── Résultat complet d'un scraper ────────────────────────

export interface ScraperResult {
  /** Identifiant de la source, ex: "ugc" */
  source: string;
  scrapedAt: Date;
  cinemas: ScrapedCinema[];
  /** Erreurs non-bloquantes (un cinéma qui a échoué, etc.) */
  errors: string[];
}
