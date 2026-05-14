import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
dotenv.config();
const prisma = new PrismaClient();
async function main() {
  const now = new Date();
  const future = await prisma.seance.count({ where: { dateHeure: { gte: now } } });
  const total = await prisma.seance.count();
  const last = await prisma.seance.findFirst({
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true, salle: { select: { cinema: { select: { nom: true, ville: true } } } } },
  });
  console.log(`Séances futures : ${future}`);
  console.log(`Total séances   : ${total}`);
  console.log(`Dernière mise à jour: ${last?.updatedAt?.toISOString()} — ${last?.salle?.cinema?.nom} (${last?.salle?.cinema?.ville})`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
