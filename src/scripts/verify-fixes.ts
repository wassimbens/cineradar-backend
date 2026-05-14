import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const films = await prisma.film.findMany({
    where: {
      OR: [
        { titre: { contains: "anatomie", mode: "insensitive" } },
        { titre: { contains: "sound of metal", mode: "insensitive" } },
        { titre: { contains: "american history", mode: "insensitive" } },
        { titre: { contains: "mario galaxy", mode: "insensitive" } },
      ],
    },
    select: { titre: true, tmdbId: true, affiche: true, tmdbPopularite: true },
  });
  films.forEach((f) =>
    console.log(`${f.titre}\n  tmdb=${f.tmdbId} pop=${f.tmdbPopularite.toFixed(1)} affiche=...${f.affiche?.slice(-50) ?? "NULL"}\n`)
  );

  // Compter les doublons restants
  const allFilms = await prisma.film.findMany({ select: { id: true, titre: true, tmdbId: true } });
  const byTitle: Record<string, number> = {};
  for (const f of allFilms) {
    const k = f.titre.trim().toLowerCase();
    byTitle[k] = (byTitle[k] ?? 0) + 1;
  }
  const dups = Object.entries(byTitle).filter(([, v]) => v > 1);
  console.log(`Total films: ${allFilms.length}, doublons restants: ${dups.length}`);

  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
