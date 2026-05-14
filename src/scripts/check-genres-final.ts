import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
dotenv.config();
const prisma = new PrismaClient();
async function main() {
  const films = await prisma.film.findMany({ select: { genres: true } });
  const allGenres = new Set<string>();
  for (const f of films) f.genres.forEach(g => allGenres.add(g));
  const sorted = Array.from(allGenres).sort();
  console.log(`\n${sorted.length} genres distincts en base :`);
  for (const g of sorted) {
    const count = films.filter(f => f.genres.includes(g)).length;
    console.log(`  "${g}" (${count} films)`);
  }
  const total = await prisma.film.count();
  const classics = await prisma.film.count({ where: { annee: { lte: 2000 } } });
  console.log(`\nTotal: ${total} films | Classiques ≤ 2000: ${classics}`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
