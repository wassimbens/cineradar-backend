// Script de secours : corrige manuellement l'affiche d'un film
// via son tmdbId connu quand la recherche automatique échoue.
//
// Usage : npx tsx src/scripts/fix-one-poster.ts

import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
dotenv.config();

const prisma = new PrismaClient();

// ── Films à corriger manuellement ────────────────────────
// Ajoutez ici tous les films dont le poster ne se trouve pas automatiquement
const FIXES = [
  {
    titreLike: "Anatomie d",
    tmdbId: "962080",
    affiche: "https://image.tmdb.org/t/p/w500/kQs6keheMwCxJxrzV83VUwFtHkB.jpg",
  },
];

async function main() {
  console.log("🔧 Correction manuelle des affiches…\n");

  for (const fix of FIXES) {
    const films = await prisma.film.findMany({
      where: { titre: { contains: fix.titreLike, mode: "insensitive" } },
    });

    if (films.length === 0) {
      console.log(`❌  Aucun film contenant "${fix.titreLike}"`);
      continue;
    }

    for (const film of films) {
      await prisma.film.update({
        where: { id: film.id },
        data: { tmdbId: fix.tmdbId, affiche: fix.affiche },
      });
      console.log(`✅  "${film.titre}" → affiche mise à jour`);
    }
  }

  await prisma.$disconnect();
  console.log("\nTerminé.");
}

main().catch((e) => { console.error(e); process.exit(1); });
