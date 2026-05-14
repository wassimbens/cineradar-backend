"use strict";
// ─────────────────────────────────────────────────────────
//  Script manuel : lance un ou tous les scrapers
//
//  Usage :
//    npx tsx src/scripts/run-scraper.ts          → tous
//    npx tsx src/scripts/run-scraper.ts ugc       → UGC seulement
//    npx tsx src/scripts/run-scraper.ts allocine  → AlloCiné seulement
// ─────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
const ugc_scraper_js_1 = require("../scrapers/ugc.scraper.js");
const allocine_scraper_js_1 = require("../scrapers/allocine.scraper.js");
const pathe_scraper_js_1 = require("../scrapers/pathe.scraper.js");
const mk2_scraper_js_1 = require("../scrapers/mk2.scraper.js");
const scraper_service_js_1 = require("../services/scraper.service.js");
const prisma_js_1 = require("../lib/prisma.js");
const child_process_1 = require("child_process");
const ALL_SCRAPERS = {
    ugc: new ugc_scraper_js_1.UgcScraper(),
    allocine: new allocine_scraper_js_1.AllocineScraper(),
    pathe: new pathe_scraper_js_1.PatheScraper(),
    mk2: new mk2_scraper_js_1.Mk2Scraper(),
};
async function main() {
    const target = process.argv[2]?.toLowerCase();
    const scrapers = target
        ? ALL_SCRAPERS[target]
            ? [ALL_SCRAPERS[target]]
            : (console.error(`Scraper inconnu : "${target}". Choix : ${Object.keys(ALL_SCRAPERS).join(", ")}`), process.exit(1))
        : Object.values(ALL_SCRAPERS);
    console.log(`\n🚀 Lancement de ${scrapers.length} scraper(s)…\n`);
    for (const scraper of scrapers) {
        console.log(`\n📡 ${scraper.name.toUpperCase()} — démarrage`);
        const startedAt = Date.now();
        try {
            const result = await scraper.scrape();
            const filmCount = result.cinemas.reduce((acc, c) => acc + c.films.length, 0);
            const seanceCount = result.cinemas.reduce((acc, c) => acc + c.films.reduce((a, f) => a + f.seances.length, 0), 0);
            console.log(`\n💾 Sauvegarde en base…`);
            const stats = await scraper_service_js_1.scraperService.save(result);
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
        }
        catch (err) {
            console.error(`❌ Erreur fatale ${scraper.name} :`, err);
        }
    }
    // Nettoyage des séances passées
    const deleted = await scraper_service_js_1.scraperService.cleanOldSeances();
    if (deleted > 0)
        console.log(`\n🧹 ${deleted} séance(s) passée(s) supprimée(s)`);
    await prisma_js_1.prisma.$disconnect(); // libérer la connexion avant de spawner
    // ── Auto-fix des affiches manquantes ou non-TMDB ──────────
    console.log("\n🖼️  Enrichissement automatique des affiches…");
    const autoFixResult = (0, child_process_1.spawnSync)("npx", ["tsx", "src/scripts/auto-fix-posters.ts"], { stdio: "inherit", cwd: process.cwd(), shell: true });
    if (autoFixResult.status !== 0) {
        console.warn("⚠️  auto-fix-posters a signalé une erreur (non bloquant)");
    }
    // ── Vérification des alertes ──────────────────────────────
    console.log("\n🔔 Vérification des alertes utilisateurs…");
    const checkAlertesResult = (0, child_process_1.spawnSync)("npx", ["tsx", "src/scripts/check-alertes.ts"], { stdio: "inherit", cwd: process.cwd(), shell: true });
    if (checkAlertesResult.status !== 0) {
        console.warn("⚠️  check-alertes a signalé une erreur (non bloquant)");
    }
    process.exit(0);
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=run-scraper.js.map