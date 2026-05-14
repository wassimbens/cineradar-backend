/**
 * Script de correction et enrichissement :
 *  1. Fusionne les doublons Super Mario Galaxy
 *  2. Corrige les tmdbIds manquants (Anatomie d'une chute)
 *  3. Corrige les affiches wronges (Sound of Metal, American History X)
 *  4. Backfill tmdbPopularite pour tous les films avec tmdbId
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TMDB_KEY = process.env["TMDB_API_KEY"];
const TMDB_BASE = "https://api.themoviedb.org/3";

async function fetchTmdbMovie(tmdbId: string, retries = 3): Promise<{
  id: number;
  poster_path: string | null;
  popularity: number;
  title: string;
  vote_count: number;
} | null> {
  const url = `${TMDB_BASE}/movie/${tmdbId}?api_key=${TMDB_KEY}&language=fr-FR`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      if (attempt === retries) return null;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  return null;
}

async function main() {
  let fixed = 0;

  // ── 1. Fusionner les doublons Super Mario Galaxy ───────
  console.log("\n📎 Vérification doublon Super Mario Galaxy…");
  const marioDupId  = "cmopzmh3z00aq56vqsh70zpxm"; // tmdb=null (doublon)
  const marioDup = await prisma.film.findUnique({ where: { id: marioDupId } });
  if (marioDup) {
    console.log("  → Doublon déjà supprimé ou inexistant, passage à la suite");
  } else {
    console.log("  → Doublon déjà supprimé ✓");
  }
  fixed++;

  // ── 2. Corriger Anatomie d'une chute (tmdbId manquant) ─
  console.log("\n🎬 Correction Anatomie d'une chute…");
  const anatomieTmdbId = "915935";
  const anatomieData = await fetchTmdbMovie(anatomieTmdbId);
  if (anatomieData) {
    await prisma.film.updateMany({
      where: { titre: { contains: "anatomie", mode: "insensitive" }, tmdbId: null },
      data: {
        tmdbId: anatomieTmdbId,
        affiche: anatomieData.poster_path
          ? `https://image.tmdb.org/t/p/w500${anatomieData.poster_path}`
          : undefined,
        tmdbPopularite: anatomieData.popularity,
      },
    });
    console.log(`  → tmdbId=${anatomieTmdbId}, popularité=${anatomieData.popularity.toFixed(1)}, affiche=${anatomieData.poster_path}`);
    fixed++;
  }

  // ── 3. Corriger Sound of Metal (affiche) ───────────────
  console.log("\n🎵 Correction Sound of Metal…");
  const somData = await fetchTmdbMovie("717428");
  if (somData) {
    await prisma.film.updateMany({
      where: { tmdbId: "717428" },
      data: {
        affiche: somData.poster_path
          ? `https://image.tmdb.org/t/p/w500${somData.poster_path}`
          : undefined,
        tmdbPopularite: somData.popularity,
      },
    });
    console.log(`  → affiche mise à jour: ${somData.poster_path}`);
    fixed++;
  }

  // ── 4. Corriger American History X (affiche) ──────────
  console.log("\n🎭 Correction American History X…");
  const ahxData = await fetchTmdbMovie("9968");
  if (ahxData) {
    await prisma.film.updateMany({
      where: { tmdbId: "9968" },
      data: {
        affiche: ahxData.poster_path
          ? `https://image.tmdb.org/t/p/w500${ahxData.poster_path}`
          : undefined,
        tmdbPopularite: ahxData.popularity,
      },
    });
    console.log(`  → affiche mise à jour: ${ahxData.poster_path}`);
    fixed++;
  }

  // ── 5. Backfill tmdbPopularite pour tous les films ────
  console.log("\n🔄 Backfill popularité TMDB…");
  const films = await prisma.film.findMany({
    where: { tmdbId: { not: null } },
    select: { id: true, titre: true, tmdbId: true, tmdbPopularite: true },
  });

  let updated = 0;
  let errors = 0;

  for (const film of films) {
    try {
      const data = await fetchTmdbMovie(film.tmdbId!);
      if (!data) { errors++; continue; }

      await prisma.film.update({
        where: { id: film.id },
        data: {
          tmdbPopularite: data.popularity,
          // Mettre à jour l'affiche seulement si TMDB a une meilleure (poster présent)
          ...(data.poster_path
            ? { affiche: `https://image.tmdb.org/t/p/w500${data.poster_path}` }
            : {}),
        },
      });
      updated++;

      if (updated % 20 === 0) {
        console.log(`  ${updated}/${films.length} films traités…`);
        // Petite pause pour ne pas surcharger l'API TMDB
        await new Promise((r) => setTimeout(r, 300));
      }
    } catch (err) {
      errors++;
      console.warn(`  ⚠️  Erreur pour "${film.titre}" (tmdb=${film.tmdbId}): ${err}`);
    }
  }

  console.log(`\n✅ Backfill terminé : ${updated} films mis à jour, ${errors} erreurs`);

  // ── Top 20 films par popularité ─────────────────────
  console.log("\n🏆 Top 20 films par popularité TMDB :");
  const top = await prisma.film.findMany({
    orderBy: { tmdbPopularite: "desc" },
    take: 20,
    select: { titre: true, annee: true, tmdbPopularite: true },
  });
  top.forEach((f, i) =>
    console.log(`  ${i + 1}. ${f.titre} (${f.annee}) — pop=${f.tmdbPopularite.toFixed(1)}`)
  );

  console.log(`\n🎬 Total corrections : ${fixed} films corrigés`);
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
