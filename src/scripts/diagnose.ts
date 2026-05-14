import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  // 1. Billie Eilish doublon
  const billie = await prisma.film.findMany({
    where: { titre: { contains: "billie", mode: "insensitive" } },
    select: { id: true, titre: true, tmdbId: true, affiche: true, annee: true,
      _count: { select: { seances: true } } },
  });
  console.log("=== BILLIE EILISH ===");
  billie.forEach(f => console.log(`  id=${f.id} titre="${f.titre}" tmdb=${f.tmdbId} seances=${f._count.seances}`));

  // 2. Films avec mauvaises affiches (Apocalypse Now, Barry Lyndon)
  const badPosters = ["apocalypse", "barry lyndon", "barry", "lyndon"];
  for (const q of badPosters) {
    const films = await prisma.film.findMany({
      where: { titre: { contains: q, mode: "insensitive" } },
      select: { id: true, titre: true, tmdbId: true, affiche: true, annee: true },
    });
    if (films.length) {
      console.log(`\n=== ${q.toUpperCase()} ===`);
      films.forEach(f => console.log(`  "${f.titre}" (${f.annee}) tmdb=${f.tmdbId} affiche=...${f.affiche?.slice(-45) ?? "NULL"}`));
    }
  }

  // 3. Films sans tmdbId (trailers impossibles)
  const noTmdb = await prisma.film.count({ where: { tmdbId: null } });
  const total = await prisma.film.count();
  console.log(`\n=== FILMS SANS TMDB ID: ${noTmdb}/${total} ===`);
  const samples = await prisma.film.findMany({
    where: { tmdbId: null },
    select: { titre: true, annee: true },
    take: 15,
    orderBy: { titre: "asc" },
  });
  samples.forEach(f => console.log(`  "${f.titre}" (${f.annee})`));

  // 4. Doublons case-insensitive (titres identiques à la casse près)
  const allFilms = await prisma.film.findMany({ select: { id: true, titre: true, tmdbId: true, _count: { select: { seances: true } } } });
  const byNorm: Record<string, typeof allFilms> = {};
  for (const f of allFilms) {
    const k = f.titre.trim().toLowerCase().replace(/\s+/g, " ");
    if (!byNorm[k]) byNorm[k] = [];
    byNorm[k].push(f);
  }
  const dupsCaseSensitive = Object.entries(byNorm).filter(([, v]) => v.length > 1);
  console.log(`\n=== DOUBLONS CASE-INSENSITIVE: ${dupsCaseSensitive.length} ===`);
  dupsCaseSensitive.forEach(([titre, list]) => {
    console.log(`  "${titre}":`);
    list.forEach(f => console.log(`    id=${f.id} titre="${f.titre}" tmdb=${f.tmdbId} seances=${f._count.seances}`));
  });

  // 5. UGC cinemas et leurs séances
  const ugcCinemas = await prisma.cinema.findMany({
    where: { chaine: { contains: "ugc", mode: "insensitive" } },
    include: { _count: { select: { salles: true } } },
    select: { id: true, nom: true, ville: true, chaine: true, _count: true },
  });
  console.log(`\n=== CINÉMAS UGC (${ugcCinemas.length}) ===`);
  for (const c of ugcCinemas) {
    const seancesCount = await prisma.seance.count({
      where: { salle: { cinemaId: c.id }, dateHeure: { gte: new Date() } },
    });
    console.log(`  ${c.nom} (${c.ville}) - ${c._count.salles} salles - ${seancesCount} séances futures`);
  }

  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
