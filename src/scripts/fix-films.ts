import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  // ── 1. Diagnostic Mario Galaxy ──────────────────────────
  const marios = await prisma.film.findMany({
    where: { titre: { contains: "mario galaxy", mode: "insensitive" } },
    include: { _count: { select: { seances: true } } },
  });
  console.log("=== MARIO GALAXY ===");
  marios.forEach((f) =>
    console.log(`  id=${f.id} titre="${f.titre}" tmdb=${f.tmdbId} seancesTotal=${f._count.seances}`)
  );

  // ── 2. Séances des films stars dans 30 jours ──────────
  const now = new Date();
  const in30 = new Date(now); in30.setDate(in30.getDate() + 30);
  const targets = ["MICHAEL", "SUPER MARIO GALAXY", "DIABLE", "MORTAL KOMBAT", "Obsession", "anatomie"];
  for (const t of targets) {
    const film = await prisma.film.findFirst({
      where: { titre: { contains: t, mode: "insensitive" } },
      include: { _count: { select: { seances: { where: { dateHeure: { gte: now, lte: in30 } } } } } },
    });
    if (film) console.log(`[${film._count.seances} séances/30j] "${film.titre}" (${film.annee}) tmdb=${film.tmdbId}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
