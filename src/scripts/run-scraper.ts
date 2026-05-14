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
import { scraperService } from "../services/scraper.service.js";
import { BaseScraper } from "../scrapers/base.scraper.js";
import { prisma } from "../lib/prisma.js";
import { spawnSync } from "child_process";

const ALL_SCRAPERS: Record<string, BaseScraper> = {
  ugc: new UgcScraper(),
  allocine: new AllocineScraper(),
  pathe: new PatheScraper(),
  mk2: new Mk2Scraper(),
};

async function main() {
  const target = process.argv[2]?.toLowerCase();

  const scrapers = target
    ? ALL_SCRAPERS[target]
      ? [ALL_SCRAPERS[target]]
      : (console.error(`Scraper inconnu : "${target}". Choix : ${Object.keys(ALL_SCRAPERS).join(", ")}`), process.exit(1))
    : Object.values(ALL_SCRAPERS);

  console.log(`\n🚀 Lancement de ${(scrapers as BaseScraper[]).length} scraper(s)…\n`);

  for (const scraper of scrapers as BaseScraper[]) {
    console.log(`\n📡 ${scraper.name.toUpperCase()} — démarrage`);
    const startedAt = Date.now();

    try {
      const result = await scraper.scrape();

      const filmCount = result.cinemas.reduce((acc, c) => acc + c.films.length, 0);
      const seanceCount = result.cinemas.reduce(
        (acc, c) => acc + c.films.reduce((a, f) => a + f.seances.length, 0),
        0
      );

      console.log(`\n💾 Sauvegarde en base…`);
      const stats = await scraperService.save(result);

      const duration = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`
✅ ${scraper.name.toUpperCase()} terminé en ${duration}s
   Cinémas  : ${result.cinemas.length} scrapés (${stats.cinemasCreated} créés, ${stats.cinemasUpdated} màj)
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
