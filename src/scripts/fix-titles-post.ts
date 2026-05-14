import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
dotenv.config();

const prisma = new PrismaClient();

async function main() {
  // Fix Puffin Rock duplicate
  const puffins = await prisma.film.findMany({
    where: { titre: { contains: "puffin", mode: "insensitive" } },
    select: { id: true, titre: true, annee: true, affiche: true, tmdbId: true },
  });
  console.log("Puffin films:", puffins.map(f => `${f.id} "${f.titre}" tmdbId=${f.tmdbId} affiche=${!!f.affiche}`));

  if (puffins.length > 1) {
    const keeper = puffins.find(f => f.affiche && f.tmdbId) ?? puffins.find(f => f.affiche) ?? puffins[0];
    const toDelete = puffins.filter(f => f.id !== keeper.id);
    for (const dup of toDelete) {
      // Transfer seances
      const seances = await prisma.seance.findMany({ where: { filmId: dup.id } });
      for (const s of seances) {
        const existing = await prisma.seance.findFirst({
          where: { filmId: keeper.id, cinemaId: s.cinemaId, horaire: s.horaire, version: s.version },
        });
        if (!existing) {
          await prisma.seance.update({ where: { id: s.id }, data: { filmId: keeper.id } });
        } else {
          await prisma.seance.delete({ where: { id: s.id } });
        }
      }
      await prisma.alerte.deleteMany({ where: { filmId: dup.id } });
      await prisma.film.delete({ where: { id: dup.id } });
      console.log(`✅ Doublon Puffin Rock supprimé: ${dup.id}`);
    }
    // Ensure proper title on keeper
    await prisma.film.update({
      where: { id: keeper.id },
      data: { titre: "Nouveaux copains à Puffin Rock" },
    });
    console.log("✅ Titre Puffin Rock normalisé");
  }

  // Fix 8½ title (tmdbId=819 is correct for Fellini)
  const huitEtDemi = await prisma.film.findFirst({ where: { tmdbId: "819" } });
  if (huitEtDemi && huitEtDemi.titre !== "8½") {
    await prisma.film.update({ where: { id: huitEtDemi.id }, data: { titre: "8½", titreOriginal: "8½" } });
    console.log("✅ 8½ titre mis à jour");
  } else if (huitEtDemi) {
    console.log(`ℹ️  8½ déjà correct: "${huitEtDemi.titre}"`);
  }

  console.log("✅ Done");
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
