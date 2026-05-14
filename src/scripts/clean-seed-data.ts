// Script one-shot : supprime les données test insérées par prisma/seed.ts
// - Séances avec source = "seed"
// - Films du seed qui n'ont plus aucune séance scraped
// - Cinémas du seed qui n'ont plus aucune séance

import { prisma } from "../lib/prisma.js";

// tmdbIds des films insérés par le seed — permet de les cibler précisément
const SEED_TMDB_IDS = [
  "693134", // Dune: Part Two
  "872585", // Oppenheimer
  "1075794", // Past Lives
  "792307",  // Poor Things
  "1008042", // Anatomie d'une chute
  "930564",  // The Zone of Interest
  "933260",  // Les Trois Mousquetaires
  "466420",  // Killers of the Flower Moon
  "575264",  // Mission: Impossible DR1
  "1009248", // La Salle des profs
];

// Noms des cinémas créés par le seed (tous à Paris)
const SEED_CINEMA_NOMS = [
  "UGC Ciné Cité Les Halles",
  "MK2 Bibliothèque",
  "Pathé Wepler",
  "Le Grand Rex",
  "Cinéma du Panthéon",
];

async function main() {
  console.log("\n🧹 Nettoyage des données test (seed)\n");

  // 1. Supprimer les séances avec source = "seed"
  const { count: seancesDeleted } = await prisma.seance.deleteMany({
    where: { source: "seed" },
  });
  console.log(`✅ ${seancesDeleted} séance(s) test supprimée(s)`);

  // 2. Supprimer les films du seed qui n'ont plus aucune séance
  //    (les films scrapés ont pu reprendre les mêmes entrées via upsert titre+réalisateur)
  let filmsDeleted = 0;
  for (const tmdbId of SEED_TMDB_IDS) {
    const film = await prisma.film.findUnique({ where: { tmdbId } });
    if (!film) continue;

    const seancesCount = await prisma.seance.count({ where: { filmId: film.id } });
    if (seancesCount === 0) {
      // Nettoyer d'abord les alertes liées
      await prisma.alerte.updateMany({
        where: { filmId: film.id },
        data: { filmId: null },
      });
      await prisma.film.delete({ where: { id: film.id } });
      console.log(`  🗑️  Film supprimé : ${film.titre}`);
      filmsDeleted++;
    } else {
      console.log(`  ℹ️  Film conservé (${seancesCount} séances) : ${film.titre}`);
    }
  }
  console.log(`\n✅ ${filmsDeleted} film(s) test sans séances supprimé(s)`);

  // 3. Supprimer les cinémas seed qui n'ont plus de séances scraped
  let cinemasDeleted = 0;
  for (const nom of SEED_CINEMA_NOMS) {
    const cinema = await prisma.cinema.findFirst({
      where: { nom: { equals: nom, mode: "insensitive" } },
      include: { salles: { include: { seances: true } } },
    });
    if (!cinema) continue;

    const totalSeances = cinema.salles.reduce(
      (acc, s) => acc + s.seances.filter((seq) => seq.source !== "seed").length,
      0
    );

    if (totalSeances === 0) {
      // Cascade supprime salles + séances
      await prisma.cinema.delete({ where: { id: cinema.id } });
      console.log(`  🗑️  Cinéma supprimé : ${cinema.nom}`);
      cinemasDeleted++;
    } else {
      console.log(`  ℹ️  Cinéma conservé (${totalSeances} séances scraped) : ${cinema.nom}`);
    }
  }
  console.log(`\n✅ ${cinemasDeleted} cinéma(s) test sans séances supprimé(s)`);

  console.log("\n🎉 Nettoyage terminé !\n");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
