"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const ugc_scraper_js_1 = require("../scrapers/ugc.scraper.js");
const allocine_scraper_js_1 = require("../scrapers/allocine.scraper.js");
const pathe_scraper_js_1 = require("../scrapers/pathe.scraper.js");
const mk2_scraper_js_1 = require("../scrapers/mk2.scraper.js");
const cgr_scraper_js_1 = require("../scrapers/cgr.scraper.js");
const scraper_service_js_1 = require("../services/scraper.service.js");
const prisma_js_1 = require("../lib/prisma.js");
const child_process_1 = require("child_process");
// Scrapers HTTP légers (pas de Playwright) — lancés par défaut et par le cron 03:00
const HTTP_SCRAPER_NAMES = ["ugc", "allocine", "pathe", "mk2"];
// Scrapers Playwright — lourds en RAM, lancés séparément (cron 09:00 ou manuellement)
const HTTP_SCRAPERS = {
    ugc: new ugc_scraper_js_1.UgcScraper(),
    allocine: new allocine_scraper_js_1.AllocineScraper(),
    pathe: new pathe_scraper_js_1.PatheScraper(),
    mk2: new mk2_scraper_js_1.Mk2Scraper(),
};
const PLAYWRIGHT_SCRAPERS = {
    cgr: new cgr_scraper_js_1.CgrScraper(),
};
const ALL_SCRAPERS = { ...HTTP_SCRAPERS, ...PLAYWRIGHT_SCRAPERS };
// ── Mode batch : coordonnateur ────────────────────────────
// Chaque scraper HTTP tourne dans son propre process Node.js.
// Quand un process se termine, V8 libère toute sa RAM avant
// de lancer le suivant → élimine l'accumulation mémoire inter-scrapers.
async function runBatch() {
    const startedAt = Date.now();
    console.log(`\n${"─".repeat(50)}`);
    console.log(`🚀 Mode batch : ${HTTP_SCRAPER_NAMES.join(", ")} (processes isolés)`);
    console.log(`${"─".repeat(50)}\n`);
    for (const name of HTTP_SCRAPER_NAMES) {
        console.log(`\n${"─".repeat(40)}`);
        console.log(`▶  Lancement process isolé : ${name.toUpperCase()}`);
        console.log(`${"─".repeat(40)}`);
        const result = (0, child_process_1.spawnSync)("node", ["dist/scripts/run-scraper.js", name], { stdio: "inherit", cwd: process.cwd(), shell: true });
        if (result.status !== 0) {
            console.warn(`\n⚠️  ${name.toUpperCase()} terminé avec le code ${result.status} — on continue`);
        }
        else {
            console.log(`\n✅ ${name.toUpperCase()} terminé avec succès`);
        }
    }
    // Nettoyage des séances passées (une seule fois après tous les scrapers)
    try {
        const deleted = await scraper_service_js_1.scraperService.cleanOldSeances();
        if (deleted > 0)
            console.log(`\n🧹 ${deleted} séance(s) passée(s) supprimée(s)`);
    }
    catch (err) {
        console.error("⚠️  Erreur nettoyage séances :", err);
    }
    await prisma_js_1.prisma.$disconnect();
    // ── Auto-fix des affiches manquantes ──────────────────
    console.log("\n🖼️  Enrichissement automatique des affiches…");
    const autoFixResult = (0, child_process_1.spawnSync)("node", ["dist/scripts/auto-fix-posters.js"], { stdio: "inherit", cwd: process.cwd(), shell: true });
    if (autoFixResult.status !== 0) {
        console.warn("⚠️  auto-fix-posters a signalé une erreur (non bloquant)");
    }
    // ── Vérification des alertes ──────────────────────────
    console.log("\n🔔 Vérification des alertes utilisateurs…");
    const checkAlertesResult = (0, child_process_1.spawnSync)("node", ["dist/scripts/check-alertes.js"], { stdio: "inherit", cwd: process.cwd(), shell: true });
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
async function runSingle(target) {
    const scraper = ALL_SCRAPERS[target];
    if (!scraper) {
        console.error(`Scraper inconnu : "${target}". Choix : ${Object.keys(ALL_SCRAPERS).join(", ")}`);
        process.exit(1);
    }
    console.log(`\n📡 ${scraper.name.toUpperCase()} — démarrage`);
    const startedAt = Date.now();
    // Mode streaming pour AlloCiné : sauvegarde incrémentale cinéma par cinéma
    const streamStats = (0, scraper_service_js_1.makeEmptyStats)();
    if (scraper instanceof allocine_scraper_js_1.AllocineScraper) {
        scraper.onCinema = async (cinema) => {
            await scraper_service_js_1.scraperService.saveCinema(cinema, scraper.name, streamStats);
        };
    }
    try {
        const result = await scraper.scrape();
        const stats = scraper instanceof allocine_scraper_js_1.AllocineScraper
            ? streamStats
            : await scraper_service_js_1.scraperService.save(result);
        const filmCount = scraper instanceof allocine_scraper_js_1.AllocineScraper
            ? stats.filmsCreated + stats.filmsUpdated
            : result.cinemas.reduce((acc, c) => acc + c.films.length, 0);
        const seanceCount = scraper instanceof allocine_scraper_js_1.AllocineScraper
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
    }
    catch (err) {
        console.error(`❌ Erreur fatale ${scraper.name} :`, err);
    }
    await prisma_js_1.prisma.$disconnect();
    process.exit(0);
}
// ── Point d'entrée ────────────────────────────────────────
async function main() {
    const target = process.argv[2]?.toLowerCase();
    if (!target) {
        // Mode batch : chaque scraper dans son propre process
        await runBatch();
    }
    else {
        // Mode scraper unique
        await runSingle(target);
    }
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=run-scraper.js.map