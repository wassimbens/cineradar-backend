import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
dotenv.config();
const prisma = new PrismaClient();

const TMDB_KEY = process.env["TMDB_API_KEY"]!;
const TMDB_BASE = "https://api.themoviedb.org/3";
const POSTER = "https://image.tmdb.org/t/p/w500";

async function fetchPoster(tmdbId: string): Promise<string | null> {
  try {
    const res = await fetch(`${TMDB_BASE}/movie/${tmdbId}?api_key=${TMDB_KEY}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { poster_path: string | null };
    return data.poster_path ? `${POSTER}${data.poster_path}` : null;
  } catch {
    return null;
  }
}

async function main() {
  // Apocalypse Now: tmdbId=28
  const apoc = await prisma.film.findFirst({ where: { titre: { contains: "Apocalypse", mode: "insensitive" } } });
  if (apoc) {
    const poster = await fetchPoster("28");
    if (poster) {
      await prisma.film.update({ where: { id: apoc.id }, data: { tmdbId: "28", affiche: poster } });
      console.log(`✅ Apocalypse Now: ${poster}`);
    } else {
      // Set direct known value
      await prisma.film.update({ where: { id: apoc.id }, data: { tmdbId: "28", affiche: `${POSTER}/gQB8Y5RCMkv2zwzFHbUJX3kAhvA.jpg` } });
      console.log("✅ Apocalypse Now: affiche directe");
    }
  }

  // Barry Lyndon: tmdbId=3175
  const barry = await prisma.film.findFirst({ where: { titre: { contains: "Barry Lyndon", mode: "insensitive" } } });
  if (barry) {
    const poster = await fetchPoster("3175");
    if (poster) {
      await prisma.film.update({ where: { id: barry.id }, data: { tmdbId: "3175", affiche: poster } });
      console.log(`✅ Barry Lyndon: ${poster}`);
    } else {
      await prisma.film.update({ where: { id: barry.id }, data: { tmdbId: "3175", affiche: `${POSTER}/A0byHUHMwZ7dtBQtfZ44QIgDbjo.jpg` } });
      console.log("✅ Barry Lyndon: affiche directe");
    }
  }

  // Amour (2012) - Michael Haneke - tmdbId=81000
  const amour = await prisma.film.findFirst({ where: { titre: "Amour", annee: 2012 } });
  if (amour) {
    const poster = await fetchPoster("81000");
    if (poster) {
      await prisma.film.update({ where: { id: amour.id }, data: { tmdbId: "81000", affiche: poster } });
      console.log(`✅ Amour: ${poster}`);
    } else {
      await prisma.film.update({ where: { id: amour.id }, data: { tmdbId: "81000", affiche: `${POSTER}/1uCq1Qk5l9mGW7kfmOxbkOBF6eU.jpg` } });
      console.log("✅ Amour: affiche directe");
    }
  } else {
    console.log("ℹ️  Amour non trouvé en base");
  }

  // Lady Bird - tmdbId=434630
  const lb = await prisma.film.findFirst({ where: { titre: { contains: "Lady Bird", mode: "insensitive" } } });
  if (lb) {
    const poster = await fetchPoster("434630");
    if (poster) {
      await prisma.film.update({ where: { id: lb.id }, data: { tmdbId: "434630", affiche: poster } });
      console.log(`✅ Lady Bird: ${poster}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
