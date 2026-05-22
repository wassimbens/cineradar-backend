// ─────────────────────────────────────────────────────────
//  Script manuel : lance un ou tous les scrapers
//
//  Usage :
//    npx tsx src/scripts/run-scraper.ts          → tous (chacun dans son propre process)
//    npx tsx src/scripts/run-scraper.ts ugc       → UGC seulement
//    npx tsx src/scripts/run-scraper.ts allocine  → AlloCiné seulement
//
//  Mode batch (sans argument) :
//    Chaque scraper est lancé dans un process isolé via spawnSync.
//    La RAM est libérée entre chaque scraper → évite l'OOM.
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
const HTTP_SCRAPER_NAMES = ["ugc", "allocine", "pathe", "mk2"];

// Scrapers Playwright — lourds en RAM, lancés séparément (cron 09:00 ou manuellement)
const HTTP_SCRAPERS: Record<string, BaseScraper> = {
  ugc: new UgcScraper(),
  allocine: new AllocineScraper(),
  pathe: new PatheScraper(),
  mk2: new Mk2Scraper(),
};

const PLAYWRIGHT_SCRAPERS: Record<string, BaseScraper> = {
  cgr: new CgrScraper(),
};

const ALL_SCRAPERS: Record<string, BaseScraper> = { ...HTTP_SCRAPERS, ...PLAYWRIGHT_SCRAPERS };

// ── Mode batch : coordonnateur ────────────────────────────
// Chaque scraper HTTP tourne dans son propre process Node.js.
// Quand un process se termine, V8 libère toute sa RAM avant
// de lancer le suivant → élimine l'accumulation mémoire inter-scrapers.

async function runBatch(): Promise<void> {
  const startedAt = Date.now();
  console.log(`\n${"─".repeat(50)}`);
  console.log(`🚀 Mode batch : ${HTTP_SCRAPER_NAMES.join(", ")} (processes isolés)`);
  console.log(`${"─".repeat(50)}\n`);

  for (const name of HTTP_SCRAPER_NAMES) {
    console.log(`\n${"─".repeat(40)}`);
    console.log(`▶  Lancement process isolé : ${name.toUpperCase()}`);
    console.log(`${"─".repeat(40)}`);

    const result = spawnSync(
      "node",
      ["dist/scripts/run-scraper.js", name],
      { stdio: "inherit", cwd: process.cwd(), shell: true }
    );

    if (result.status !== 0) {
      console.warn(`\n⚠️  ${name.toUpperCase()} terminé avec le code ${result.status} — on continue`);
    } else {
      console.log(`\n✅ ${name.toUpperCase()} terminé avec succès`);
    }
  }

  // Nettoyage des séances passées (une seule fois après tous les scrapers)
  try {
    const deleted = await scraperService.cleanOldSeances();
    if (deleted > 0) console.log(`\n🧹 ${deleted} séance(s) passée(s) supprimée(s)`);
  } catch (err) {
    console.error("⚠️  Erreur nettoyage séances :", err);
  }

  await prisma.$disconnect();

  // ── Auto-fix des affiches manquantes ──────────────────
  console.log("\n🖼️  Enrichissement automatique des affiches…");
  const autoFixResult = spawnSync(
    "node",
    ["dist/scripts/auto-fix-posters.js"],
    { stdio: "inherit", cwd: process.cwd(), shell: true }
  );
  if (autoFixResult.status !== 0) {
    console.warn("⚠️  auto-fix-posters a signalé une erreur (non bloquant)");
  }

  // ── Vérification des alertes ──────────────────────────
  console.log("\n🔔 Vérification des alertes utilisateurs…");
  const checkAlertesResult = spawnSync(
    "node",
    ["dist/scripts/check-alertes.js"],
    { stdio: "inherit", cwd: process.cwd(), shell: true }
  );
  if (checkAlertesResult.status !== 0) {
    console.warn("⚠️  check-alertes a signalé une erreur (non bloquant)");
  }

  const durationMs = Date.now() - startedAt;
  const durationStr = durationMs > 60_000
    ? `${Math.round(durationMs / 60_000)}min`
    : `${Math.round(durationMs / 1_000)}s`;

  console.log(`\n${"─".repeat(50)}`);
  console.log(`✅ Batch HTTP terminé en ${durationStr}`);
  console.log(`${"─".repeat(50)}\n`);

  process.exit(0);
}

// ── Mode scraper unique ───────────────────────────────────

async function runSingle(target: string): Promise<void> {
  const scraper = ALL_SCRAPERS[target];
  if (!scraper) {
    console.error(`Scraper inconnu : "${target}". Choix : ${Object.keys(ALL_SCRAPERS).join(", ")}`);
    process.exit(1);
  }

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

  await prisma.$disconnect();
  process.exit(0);
}

// ── Point d'entrée ────────────────────────────────────────

async function main() {
  const target = process.argv[2]?.toLowerCase();

  if (!target) {
    // Mode batch : chaque scraper dans son propre process
    await runBatch();
  } else {
    // Mode scraper unique
    await runSingle(target);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
