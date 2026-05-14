import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
dotenv.config();
const prisma = new PrismaClient();

async function main() {
  const titre = process.argv[2] ?? "Anatomie";
  const film = await prisma.film.findFirst({
    where: { titre: { contains: titre, mode: "insensitive" } },
    select: { id: true, titre: true, annee: true },
  });
  if (!film) { console.log("Film non trouvé:", titre); return; }
  console.log(`\nFilm: "${film.titre}" (${film.annee})`);

  const seances = await prisma.seance.findMany({
    where: { filmId: film.id, dateHeure: { gte: new Date() } },
    select: {
      dateHeure: true, source: true,
      salle: { select: { cinema: { select: { nom: true, ville: true } } } },
    },
    orderBy: { dateHeure: "asc" },
  });

  console.log(`\n${seances.length} séances futures\n`);

  // Par source
  const bySource: Record<string, number> = {};
  for (const s of seances) bySource[s.source] = (bySource[s.source] ?? 0) + 1;
  console.log("Par source:", bySource);

  // Par cinéma
  const byCinema = new Map<string, { count: number; dates: Set<string> }>();
  for (const s of seances) {
    const key = `${s.salle.cinema.nom} (${s.salle.cinema.ville})`;
    const e = byCinema.get(key) ?? { count: 0, dates: new Set() };
    e.count++;
    e.dates.add(s.dateHeure.toISOString().slice(0, 10));
    byCinema.set(key, e);
  }
  console.log("\nPar cinéma:");
  [...byCinema.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .forEach(([c, v]) =>
      console.log(`  ${v.count.toString().padStart(3)} séances  |  ${c}  |  jours: ${[...v.dates].slice(0, 4).join(", ")}${v.dates.size > 4 ? " ..." : ""}`)
    );

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
