import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const film = await prisma.film.findFirst({
    where: { titre: { contains: "VENGEANCE EST", mode: "insensitive" } },
    select: { id: true, titre: true, annee: true },
  });

  if (!film) { console.log("Film not found"); return; }
  console.log(`\nFilm: ${film.titre} (${film.annee})`);

  const seances = await prisma.seance.findMany({
    where: { filmId: film.id, dateHeure: { gte: new Date() } },
    select: {
      dateHeure: true,
      version: true,
      source: true,
      salle: {
        select: {
          nom: true,
          cinema: { select: { nom: true, ville: true } },
        },
      },
    },
    orderBy: [
      { salle: { cinema: { nom: "asc" } } },
      { dateHeure: "asc" },
    ],
  });

  console.log(`\n${seances.length} séances futures :\n`);

  const byCinema = new Map<string, string[]>();
  for (const s of seances) {
    const key = `${s.salle.cinema.nom} (${s.salle.cinema.ville})`;
    const arr = byCinema.get(key) ?? [];
    arr.push(`${s.dateHeure.toISOString().slice(0, 16)} [${s.version}] via ${s.source}`);
    byCinema.set(key, arr);
  }

  for (const [cinema, dates] of byCinema) {
    console.log(`  ${cinema} (${dates.length} séances):`);
    for (const d of dates) console.log(`    - ${d}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
