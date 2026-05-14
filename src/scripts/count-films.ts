import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
dotenv.config();
const prisma = new PrismaClient();
async function main() {
  const total = await prisma.film.count();
  const classics = await prisma.film.count({ where: { annee: { lte: 2000 } } });
  const noAffiche = await prisma.film.count({ where: { affiche: null } });
  const noTmdb = await prisma.film.count({ where: { tmdbId: null } });
  console.log(`Total: ${total} | Classiques (<=2000): ${classics} | Sans affiche: ${noAffiche} | Sans tmdbId: ${noTmdb}`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
