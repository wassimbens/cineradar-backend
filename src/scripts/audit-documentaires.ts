/**
 * Audit des documentaires en base.
 * Pour chaque film marqué "Documentaire", vérifie sur TMDB :
 *   - Si TMDB confirme "Documentary" → à supprimer
 *   - Si TMDB dit autre chose → mettre à jour les genres depuis TMDB
 *
 * Usage : npx ts-node --project tsconfig.scripts.json src/scripts/audit-documentaires.ts [--dry-run] [--delete]
 *   --dry-run  : affiche uniquement, ne touche pas la DB
 *   --delete   : supprime les vrais documentaires (sans --dry-run)
 */

import { config } from "dotenv";
config();

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TMDB_KEY = process.env["TMDB_API_KEY"];
const DRY_RUN = process.argv.includes("--dry-run");
const DO_DELETE = process.argv.includes("--delete");
const DELAY_MS = 300; // entre chaque requête TMDB

if (!TMDB_KEY) {
  console.error("TMDB_API_KEY manquant dans .env");
  process.exit(1);
}

interface TmdbGenre { id: number; name: string; }
interface TmdbMovie {
  id: number;
  title: string;
  genres?: TmdbGenre[];
  genre_ids?: number[];
  runtime?: number;
  release_date?: string;
  overview?: string;
}

const TMDB_GENRE_MAP: Record<number, string> = {
  28: "Action", 12: "Aventure", 16: "Animation", 35: "Comédie",
  80: "Crime", 99: "Documentaire", 18: "Drame", 10751: "Famille",
  14: "Fantastique", 36: "Histoire", 27: "Horreur", 10402: "Musique",
  9648: "Mystère", 10749: "Romance", 878: "Science-Fiction",
  10770: "Téléfilm", 53: "Thriller", 10752: "Guerre", 37: "Western",
};
const TMDB_DOCUMENTARY_GENRE_ID = 99;

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchTmdbById(tmdbId: string): Promise<TmdbMovie | null> {
  const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_KEY}&language=fr-FR`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json() as Promise<TmdbMovie>;
}

async function searchTmdb(titre: string, annee?: number | null): Promise<TmdbMovie | null> {
  const q = encodeURIComponent(titre);
  const yearParam = annee ? `&year=${annee}` : "";
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&language=fr-FR&query=${q}${yearParam}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json() as { results: TmdbMovie[] };
  return data.results?.[0] ?? null;
}

async function main() {
  console.log(`\n🎬 Audit des documentaires (${DRY_RUN ? "DRY-RUN" : "LIVE"})\n`);

  const docs = await prisma.film.findMany({
    where: { genres: { has: "Documentaire" } },
    select: { id: true, titre: true, titreOriginal: true, annee: true, tmdbId: true, genres: true, duree: true },
    orderBy: { titre: "asc" },
  });

  console.log(`📊 ${docs.length} films marqués "Documentaire" en base\n`);

  const toDelete: string[] = [];
  const toFix: { id: string; titre: string; newGenres: string[] }[] = [];
  const errors: string[] = [];

  for (let i = 0; i < docs.length; i++) {
    const film = docs[i];
    await sleep(DELAY_MS);

    let tmdb: TmdbMovie | null = null;

    // 1. Chercher par tmdbId si disponible
    if (film.tmdbId) {
      tmdb = await fetchTmdbById(film.tmdbId);
    }

    // 2. Fallback : recherche par titre
    if (!tmdb) {
      const searchTitre = film.titreOriginal ?? film.titre;
      tmdb = await searchTmdb(searchTitre, film.annee);
    }

    const progress = `[${i + 1}/${docs.length}]`;

    if (!tmdb) {
      console.log(`${progress} ⚠️  ${film.titre} (${film.annee}) — TMDB introuvable, conservé`);
      errors.push(film.id);
      continue;
    }

    const tmdbGenres = (tmdb.genres ?? []).map(g => g.id);
    const isDocOnTmdb = tmdbGenres.includes(TMDB_DOCUMENTARY_GENRE_ID);

    if (isDocOnTmdb) {
      console.log(`${progress} 🗑️  ${film.titre} (${film.annee}) — Documentaire confirmé TMDB → À SUPPRIMER`);
      toDelete.push(film.id);
    } else {
      // TMDB ne le considère pas documentaire → corriger genres
      const correctedGenres = (tmdb.genres ?? [])
        .map(g => TMDB_GENRE_MAP[g.id])
        .filter(Boolean) as string[];

      if (correctedGenres.length === 0) {
        console.log(`${progress} ⚠️  ${film.titre} (${film.annee}) — TMDB sans genres → conservé`);
        errors.push(film.id);
      } else {
        console.log(`${progress} ✏️  ${film.titre} (${film.annee}) — MAL CLASSÉ! TMDB: [${correctedGenres.join(", ")}] → À CORRIGER`);
        toFix.push({ id: film.id, titre: film.titre, newGenres: correctedGenres });
      }
    }
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`✅ Vrais documentaires à supprimer : ${toDelete.length}`);
  console.log(`✏️  Films mal classés à corriger   : ${toFix.length}`);
  console.log(`⚠️  Erreurs/introuvables            : ${errors.length}`);
  console.log(`${"─".repeat(60)}\n`);

  if (!DRY_RUN) {
    // Corriger les films mal classés
    if (toFix.length > 0) {
      console.log("📝 Correction des genres mal classés...");
      for (const fix of toFix) {
        await prisma.film.update({
          where: { id: fix.id },
          data: { genres: fix.newGenres },
        });
        console.log(`  ✅ ${fix.titre} → [${fix.newGenres.join(", ")}]`);
      }
    }

    // Supprimer les vrais documentaires
    if (DO_DELETE && toDelete.length > 0) {
      console.log(`\n🗑️  Suppression de ${toDelete.length} documentaires...`);
      // D'abord nettoyer les références (favoris, vus, watchlist, avis)
      await prisma.filmFavori.deleteMany({ where: { filmId: { in: toDelete } } });
      await prisma.filmVu.deleteMany({ where: { filmId: { in: toDelete } } });
      await prisma.watchlistItem.deleteMany({ where: { filmId: { in: toDelete } } });
      await prisma.avis.deleteMany({ where: { filmId: { in: toDelete } } });
      await prisma.alerte.deleteMany({ where: { filmId: { in: toDelete } } });
      // Supprimer séances
      const seances = await prisma.seance.findMany({ where: { filmId: { in: toDelete } }, select: { id: true } });
      const seanceIds = seances.map(s => s.id);
      if (seanceIds.length > 0) {
        await prisma.seance.deleteMany({ where: { id: { in: seanceIds } } });
      }
      // Supprimer les films
      const deleted = await prisma.film.deleteMany({ where: { id: { in: toDelete } } });
      console.log(`  ✅ ${deleted.count} documentaires supprimés`);
    } else if (toDelete.length > 0) {
      console.log("ℹ️  Relancer avec --delete pour supprimer les documentaires confirmés.");
    }
  }

  await prisma.$disconnect();
  console.log("\n✨ Audit terminé.");
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
