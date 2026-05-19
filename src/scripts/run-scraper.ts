// ─────────────────────────────────────────────────────────
//  Script manuel : lance un ou tous les scrapers
//
//  Usage :
//    npx tsx src/scripts/run-scraper.ts          → tous
//    npx tsx src/scripts/run-scraper.ts ugc       → UGC seulement
//    npx tsx src/scripts/run-scraper.ts allocine  → AlloCiné seulement
// ─────────────────────────────────────────────────────────

import { UgcScraper } from "../scrapers/ugc.scraper.js";
import { AllocineScraper } from "../scrapers/allocine.scraper.js";
import { PatheScraper } from "../scrapers/pathe.scraper.js";
import { Mk2Scraper } from "../scrapers/mk2.scraper.js";
import { CgrScraper } from "../scrapers/cgr.scraper.js";
import { scraperService, makeEmptyStats } from "../services/scraper.service.js";
import { BaseScraper } from "../scrapers/base.scraper.js";
import { prisma } from "../lib/prisma.js";
import { spawnSync } from "child_process";

// Scrapers HTTP légers (pas de Playwright) — lancés par défaut et par le cron 03:00
const HTTP_SCRAPERS: Record<string, BaseScraper> = {
  ugc: new UgcScraper(),
  allocine: new AllocineScraper(),
  pathe: new PatheScraper(),
  mk2: new Mk2Scraper(),
};

// Scrapers Playwright — lourds en RAM, lancés séparément (cron 09:00 ou manuellement)
const PLAYWRIGHT_SCRAPERS: Record<string, BaseScraper> = {
  cgr: new CgrScraper(),
};

const ALL_SCRAPERS: Record<string, BaseScraper> = { ...HTTP_SCRAPERS, ...PLAYWRIGHT_SCRAPERS };

async function main() {
  const target = process.argv[2]?.toLowerCase();

  // Sans argument → HTTP uniquement (évite l'OOM sur le cron 03:00)
  const scrapers = target
    ? ALL_SCRAPERS[target]
      ? [ALL_SCRAPERS[target]]
      : (console.error(`Scraper inconnu : "${target}". Choix : ${Object.keys(ALL_SCRAPERS).join(", ")}`), process.exit(1))
    : Object.values(HTTP_SCRAPERS);

  console.log(`\n🚀 Lancement de ${(scrapers as BaseScraper[]).length} scraper(s)…\n`);

  for (const scraper of scrapers as BaseScraper[]) {
    console.log(`\n📡 ${scraper.name.toUpperCase()} — démarrage`);
    const startedAt = Date.now();

    // Mode streaming pour AlloCiné : sauvegarde incrémentale cinéma par cinéma
    const streamStats = makeEmptyStats();
    if (scraper instanceof AllocineScraper) {
      scraper.onCinema = async (cinema) => {
        await scraperService.saveCinema(cinema, scraper.name, streamStats);
      };
    }

    try {
      const result = await scraper.scrape();

      // Pour les scrapers non-streaming, sauvegarder l'ensemble du résultat
      const stats = scraper instanceof AllocineScraper
        ? streamStats
        : await scraperService.save(result);

      const filmCount = scraper instanceof AllocineScraper
        ? stats.filmsCreated + stats.filmsUpdated
        : result.cinemas.reduce((acc, c) => acc + c.films.length, 0);
      const seanceCount = scraper instanceof AllocineScraper
        ? stats.seancesCreated + stats.seancesUpdated
        : result.cinemas.reduce((acc, c) => acc + c.films.reduce((a, f) => a + f.seances.length, 0), 0);

      const duration = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`
✅ ${scraper.name.toUpperCase()} terminé en ${duration}s
   Cinémas  : ${stats.cinemasCreated + stats.cinemasUpdated} scrapés (${stats.cinemasCreated} créés, ${stats.cinemasUpdated} màj)
   Films    : ${filmCount} trouvés (${stats.filmsCreated} créés, ${stats.filmsUpdated} màj)
   Séances  : ${seanceCount} trouvées (${stats.seancesCreated} créées, ${stats.seancesUpdated} màj)
   Erreurs  : ${result.errors.length}
      `);

      if (result.errors.length) {
        console.warn("⚠️  Erreurs non-bloquantes :");
        result.errors.forEach((e) => console.warn(`   • ${e}`));
      }
    } catch (err) {
      console.error(`❌ Erreur fatale ${scraper.name} :`, err);
    }
  }

  // Nettoyage des séances passées
  const deleted = await scraperService.cleanOldSeances();
  if (deleted > 0) console.log(`\n🧹 ${deleted} séance(s) passée(s) supprimée(s)`);

  await prisma.$disconnect(); // libérer la connexion avant de spawner

  // ── Auto-fix des affiches manquantes ou non-TMDB ──────────
  console.log("\n🖼️  Enrichissement automatique des affiches…");
  const autoFixResult = spawnSync(
    "npx",
    ["tsx", "src/scripts/auto-fix-posters.ts"],
    { stdio: "inherit", cwd: process.cwd(), shell: true }
  );
  if (autoFixResult.status !== 0) {
    console.warn("⚠️  auto-fix-posters a signalé une erreur (non bloquant)");
  }

  // ── Vérification des alertes ──────────────────────────────
  console.log("\n🔔 Vérification des alertes utilisateurs…");
  const checkAlertesResult = spawnSync(
    "npx",
    ["tsx", "src/scripts/check-alertes.ts"],
    { stdio: "inherit", cwd: process.cwd(), shell: true }
  );
  if (checkAlertesResult.status !== 0) {
    console.warn("⚠️  check-alertes a signalé une erreur (non bloquant)");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
