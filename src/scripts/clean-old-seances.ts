// Supprime les séances passées de plus de 2 jours pour alléger la base
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 2); // garde 2 jours de marge

  const before = await prisma.seance.count();
  const { count } = await prisma.seance.deleteMany({
    where: { dateHeure: { lt: cutoff } },
  });

  const after = await prisma.seance.count();
  console.log(`🧹 ${count} séances périmées supprimées`);
  console.log(`   Avant : ${before} | Après : ${after}`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
