import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const KEEP_ID   = "cmonllu6c0a3410znvuq12st8"; // BILLIE EILISH HIT ME HARD AND SOFT TOUR 3D (tmdb=1515899, 21 séances)
const DELETE_ID = "cmopzmhe000j056vq3yaaxtcm"; // Billie Eilish - Hit Me Hard And Soft: The Tour Live In 3D (tmdb=null, 13 séances)

async function main() {
  console.log("=== fix-billie: merge duplicate Billie Eilish film ===\n");

  // ── 0. Sanity check ──────────────────────────────────────
  const keeper  = await prisma.film.findUnique({ where: { id: KEEP_ID },   include: { _count: { select: { seances: true } } } });
  const deleted = await prisma.film.findUnique({ where: { id: DELETE_ID }, include: { _count: { select: { seances: true } } } });

  if (!keeper)  { console.error(`KEEPER not found (id=${KEEP_ID})`);  process.exit(1); }
  if (!deleted) { console.error(`DUPLICATE not found (id=${DELETE_ID}). Already deleted?`); process.exit(1); }

  console.log(`KEEP   → id=${keeper.id}  titre="${keeper.titre}"  tmdb=${keeper.tmdbId}  séances=${keeper._count.seances}`);
  console.log(`DELETE → id=${deleted.id}  titre="${deleted.titre}"  tmdb=${deleted.tmdbId}  séances=${deleted._count.seances}`);
  console.log();

  // ── 1. Reassign séances ──────────────────────────────────
  const { count: seancesReassigned } = await prisma.seance.updateMany({
    where:  { filmId: DELETE_ID },
    data:   { filmId: KEEP_ID },
  });
  console.log(`✓ Séances reassigned: ${seancesReassigned}`);

  // ── 2. Clean up FilmFavori ───────────────────────────────
  const { count: favorisDeleted } = await prisma.filmFavori.deleteMany({
    where: { filmId: DELETE_ID },
  });
  console.log(`✓ FilmFavori deleted: ${favorisDeleted}`);

  // ── 3. Clean up WatchlistItem ────────────────────────────
  const { count: watchlistDeleted } = await prisma.watchlistItem.deleteMany({
    where: { filmId: DELETE_ID },
  });
  console.log(`✓ WatchlistItem deleted: ${watchlistDeleted}`);

  // ── 4. Clean up Avis ─────────────────────────────────────
  const { count: avisDeleted } = await prisma.avis.deleteMany({
    where: { filmId: DELETE_ID },
  });
  console.log(`✓ Avis deleted: ${avisDeleted}`);

  // ── 5. Nullify alerte.filmId ─────────────────────────────
  const { count: alertesNullified } = await prisma.alerte.updateMany({
    where: { filmId: DELETE_ID },
    data:  { filmId: null },
  });
  console.log(`✓ Alertes nullified: ${alertesNullified}`);

  // ── 6. Delete the duplicate film ─────────────────────────
  await prisma.film.delete({ where: { id: DELETE_ID } });
  console.log(`✓ Duplicate film deleted (id=${DELETE_ID})`);

  // ── 7. Verify keeper ─────────────────────────────────────
  const keeperAfter = await prisma.film.findUnique({
    where:   { id: KEEP_ID },
    include: { _count: { select: { seances: true } } },
  });
  console.log();
  console.log(`=== Result ===`);
  console.log(`Keeper now has ${keeperAfter!._count.seances} séances (was ${keeper._count.seances}, reassigned ${seancesReassigned})`);
  console.log(`Done.`);

  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
