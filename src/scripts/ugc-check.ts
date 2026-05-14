import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const in7 = new Date(now); in7.setDate(in7.getDate() + 7);

  const ugcCinemas = await prisma.cinema.findMany({
    where: { chaine: { contains: "ugc", mode: "insensitive" } },
    select: { id: true, nom: true, ville: true },
  });

  console.log(`=== CINÉMAS UGC (${ugcCinemas.length}) ===`);
  for (const c of ugcCinemas) {
    const futureSeances = await prisma.seance.count({
      where: { salle: { cinemaId: c.id }, dateHeure: { gte: now, lte: in7 } },
    });
    const totalSeances = await prisma.seance.count({
      where: { salle: { cinemaId: c.id } },
    });
    console.log(`  [${futureSeances} séances/7j | ${totalSeances} total] ${c.nom} (${c.ville})`);
  }

  // Total global
  const totalFuture = await prisma.seance.count({ where: { dateHeure: { gte: now, lte: in7 } } });
  const totalAll = await prisma.seance.count();
  console.log(`\nTotal séances futures (7j): ${totalFuture}`);
  console.log(`Total séances en base: ${totalAll}`);

  // Source des séances
  const bySrc = await prisma.seance.groupBy({ by: ["source"], _count: true });
  console.log("\nSéances par source scraper:");
  bySrc.forEach(s => console.log(`  ${s.source}: ${s._count} séances`));

  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
