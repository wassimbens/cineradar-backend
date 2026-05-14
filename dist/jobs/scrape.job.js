"use strict";
// ─────────────────────────────────────────────────────────
//  Job de scraping planifié
//
//  Planification : tous les jours à 06:00 (heure Paris)
//  Cron expression : "0 6 * * *"
//
//  Déroulement :
//    1. Lance tous les scrapers enregistrés
//    2. Persiste les résultats via ScraperService
//    3. Nettoie les séances passées
//    4. Logue un bilan
//
//  Gestion des erreurs :
//    - Chaque scraper est isolé : l'échec de l'un ne bloque pas les autres
//    - Les erreurs non-bloquantes sont agrégées dans ScraperResult.errors
//    - Les erreurs fatales sont loguées sans faire planter le process
// ─────────────────────────────────────────────────────────
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAllScrapers = runAllScrapers;
exports.registerScrapeJob = registerScrapeJob;
const node_cron_1 = __importDefault(require("node-cron"));
const child_process_1 = require("child_process");
const ugc_scraper_js_1 = require("../scrapers/ugc.scraper.js");
const allocine_scraper_js_1 = require("../scrapers/allocine.scraper.js");
const pathe_scraper_js_1 = require("../scrapers/pathe.scraper.js");
const mk2_scraper_js_1 = require("../scrapers/mk2.scraper.js");
const scraper_service_js_1 = require("../services/scraper.service.js");
// ── Registre des scrapers actifs ──────────────────────────
const SCRAPERS = [
    new ugc_scraper_js_1.UgcScraper(),
    new allocine_scraper_js_1.AllocineScraper(),
    new pathe_scraper_js_1.PatheScraper(),
    new mk2_scraper_js_1.Mk2Scraper(),
];
// ── Runner ────────────────────────────────────────────────
/**
 * Exécute tous les scrapers enregistrés et persiste les résultats.
 * Peut être appelé manuellement (ex: via endpoint d'admin) ou par le cron.
 */
async function runAllScrapers() {
    const startedAt = new Date();
    console.log(`\n${"─".repeat(50)}\n` +
        `🕐 Scraping démarré — ${startedAt.toLocaleString("fr-FR")}\n` +
        `${"─".repeat(50)}`);
    let totalCinemas = 0;
    let totalFilms = 0;
    let totalSeances = 0;
    let totalErrors = 0;
    // Exécuter chaque scraper de façon séquentielle
    // (évite de surcharger les serveurs cibles simultanément)
    for (const scraper of SCRAPERS) {
        console.log(`\n🔍 Lancement du scraper : ${scraper.name.toUpperCase()}`);
        try {
            // 1. Scraping
            const result = await scraper.scrape();
            // 2. Persistance en BDD
            console.log(`💾 Sauvegarde en base de données…`);
            const stats = await scraper_service_js_1.scraperService.save(result);
            // 3. Bilan par scraper
            const filmCount = result.cinemas.reduce((acc, c) => acc + c.films.length, 0);
            const seanceCount = result.cinemas.reduce((acc, c) => acc + c.films.reduce((a, f) => a + f.seances.length, 0), 0);
            totalCinemas += result.cinemas.length;
            totalFilms += filmCount;
            totalSeances += seanceCount;
            totalErrors += result.errors.length;
            console.log(`\n📊 Bilan ${scraper.name.toUpperCase()} :\n` +
                `   Cinémas : ${result.cinemas.length} scrapés ` +
                `(${stats.cinemasCreated} créés, ${stats.cinemasUpdated} mis à jour)\n` +
                `   Films   : ${filmCount} trouvés ` +
                `(${stats.filmsCreated} créés, ${stats.filmsUpdated} mis à jour)\n` +
                `   Séances : ${seanceCount} trouvées ` +
                `(${stats.seancesCreated} créées, ${stats.seancesUpdated} mises à jour)\n` +
                `   Erreurs : ${result.errors.length}`);
            if (result.errors.length > 0) {
                console.warn("⚠️  Erreurs non-bloquantes :");
                result.errors.forEach((e) => console.warn(`   • ${e}`));
            }
        }
        catch (err) {
            totalErrors++;
            console.error(`❌ Erreur fatale dans le scraper ${scraper.name} :`, err);
            // On continue avec les scrapers suivants
        }
    }
    // 4. Nettoyage des séances passées
    try {
        const deleted = await scraper_service_js_1.scraperService.cleanOldSeances();
        if (deleted > 0) {
            console.log(`\n🧹 ${deleted} séance(s) passée(s) supprimée(s)`);
        }
    }
    catch (err) {
        console.error("⚠️  Erreur lors du nettoyage des séances :", err);
    }
    // 5. Bilan global
    const durationMs = Date.now() - startedAt.getTime();
    const durationStr = durationMs > 60_000
        ? `${Math.round(durationMs / 60_000)}min`
        : `${Math.round(durationMs / 1_000)}s`;
    console.log(`\n${"─".repeat(50)}\n` +
        `✅ Scraping terminé en ${durationStr}\n` +
        `   Total cinémas : ${totalCinemas}\n` +
        `   Total films   : ${totalFilms}\n` +
        `   Total séances : ${totalSeances}\n` +
        `   Total erreurs : ${totalErrors}\n` +
        `${"─".repeat(50)}\n`);
    // 6. Post-scrape : enrichissement affiches + vérification alertes
    runPostScrapeJobs();
}
/** Lance auto-fix-posters puis check-alertes en sous-processus (non bloquant) */
function runPostScrapeJobs() {
    const scripts = [
        "src/scripts/auto-fix-posters.ts",
        "src/scripts/check-alertes.ts",
    ];
    for (const script of scripts) {
        const label = script.split("/").pop();
        console.log(`\n⚙️  Post-scrape : lancement de ${label}…`);
        const child = (0, child_process_1.spawn)("npx", ["tsx", script], {
            cwd: process.cwd(),
            shell: true,
            stdio: "inherit",
        });
        child.on("close", (code) => {
            if (code !== 0) {
                console.warn(`⚠️  ${label} terminé avec le code ${code}`);
            }
            else {
                console.log(`✅ ${label} terminé`);
            }
        });
    }
}
// ── Enregistrement du cron ────────────────────────────────
/**
 * Enregistre le job cron quotidien à 06:00.
 * À appeler au démarrage du serveur.
 */
function registerScrapeJob() {
    // "0 6 * * *" = tous les jours à 06h00
    const cronExpression = process.env["SCRAPE_CRON"] ?? "0 6 * * *";
    if (!node_cron_1.default.validate(cronExpression)) {
        throw new Error(`Expression cron invalide : "${cronExpression}" (variable SCRAPE_CRON)`);
    }
    const task = node_cron_1.default.schedule(cronExpression, async () => {
        console.log("[CRON] Déclenchement du job de scraping…");
        try {
            await runAllScrapers();
        }
        catch (err) {
            console.error("[CRON] Erreur fatale non catchée :", err);
        }
    }, {
        timezone: "Europe/Paris",
    });
    console.log(`✅ Job de scraping planifié : "${cronExpression}" (Europe/Paris)`);
    // Référence pour pouvoir l'arrêter proprement au shutdown
    return void task;
}
//# sourceMappingURL=scrape.job.js.map