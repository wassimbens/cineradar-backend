import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
dotenv.config();

const prisma = new PrismaClient();

async function main() {
  // Lister tous les films avec séances futures
  const films = await prisma.film.findMany({
    where: {
      seances: { some: { dateHeure: { gte: new Date() } } },
    },
    select: {
      id: true,
      titre: true,
      annee: true,
      _count: { select: { seances: { where: { dateHeure: { gte: new Date() } } } } },
    },
    orderBy: { titre: "asc" },
  });

  console.log(`\n${films.length} films avec séances futures :\n`);
  for (const f of films) {
    console.log(`  [${f._count.seances}] ${f.titre} (${f.annee ?? "?"}) — ${f.id}`);
  }

  // Chercher aussi les films avec "vengeance" ou "moi" dans le titre
  const special = films.filter(f =>
    f.titre.toLowerCase().includes("vengeance") ||
    f.titre.toLowerCase().includes("moi")
  );
  if (special.length) {
    console.log("\n--- Films correspondants ---");
    special.forEach(f => console.log(`  ${f.titre} (${f.annee}) — ${f._count.seances} séances`));
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
