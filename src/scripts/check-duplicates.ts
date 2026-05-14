import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const films = await prisma.film.findMany({
    select: { id: true, titre: true, tmdbId: true, annee: true, affiche: true, realisateur: true },
  });

  // Doublons par titre normalisé
  const byTitle: Record<string, typeof films> = {};
  for (const f of films) {
    const key = f.titre.trim().toLowerCase().replace(/\s+/g, " ");
    if (!byTitle[key]) byTitle[key] = [];
    byTitle[key].push(f);
  }
  const doublons = Object.entries(byTitle).filter(([, v]) => v.length > 1);
  console.log(`=== DOUBLONS PAR TITRE (${doublons.length}) ===`);
  for (const [titre, list] of doublons) {
    console.log(titre + ":");
    for (const f of list) console.log(`  id=${f.id} tmdbId=${f.tmdbId} annee=${f.annee}`);
  }

  // Doublons par tmdbId
  const byTmdb: Record<string, typeof films> = {};
  for (const f of films) {
    if (!f.tmdbId) continue;
    if (!byTmdb[f.tmdbId]) byTmdb[f.tmdbId] = [];
    byTmdb[f.tmdbId].push(f);
  }
  const tmdbDups = Object.entries(byTmdb).filter(([, v]) => v.length > 1);
  console.log(`\n=== DOUBLONS PAR TMDB ID (${tmdbDups.length}) ===`);
  for (const [tmdbId, list] of tmdbDups) {
    console.log(`tmdbId=${tmdbId}`);
    for (const f of list) console.log(`  id=${f.id} titre=${f.titre}`);
  }

  // Anatomie d'une chute
  const anatomie = films.filter((f) => f.titre.toLowerCase().includes("anatomie"));
  console.log("\n=== ANATOMIE ===");
  console.log(JSON.stringify(anatomie, null, 2));

  // Films sans affiche
  const noAffiche = films.filter((f) => !f.affiche);
  console.log(`\n=== SANS AFFICHE (${noAffiche.length}) ===`);
  for (const f of noAffiche.slice(0, 20)) console.log(`  ${f.titre} (${f.annee})`);

  console.log(`\nTotal: ${films.length} films, ${doublons.length} doublons titre, ${tmdbDups.length} doublons tmdb`);
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
