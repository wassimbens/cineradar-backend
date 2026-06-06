"use strict";
// ─────────────────────────────────────────────────────────
//  Job de scraping planifié
//
//  Planification :
//    06:00 — UGC, AlloCiné, Pathé/Gaumont, MK2  (scrapers HTTP légers)
//    09:00 — CGR  (Playwright/Chromium, lancé séparément pour éviter l'OOM)
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
exports.runCgrScraper = runCgrScraper;
exports.registerScrapeJob = registerScrapeJob;
const node_cron_1 = __importDefault(require("node-cron"));
const child_process_1 = require("child_process");
const ugc_scraper_js_1 = require("../scrapers/ugc.scraper.js");
const allocine_scraper_js_1 = require("../scrapers/allocine.scraper.js");
const pathe_scraper_js_1 = require("../scrapers/pathe.scraper.js");
const mk2_scraper_js_1 = require("../scrapers/mk2.scraper.js");
const cgr_scraper_js_1 = require("../scrapers/cgr.scraper.js");
const scraper_service_js_1 = require("../services/scraper.service.js");
// ── Registre des scrapers HTTP (06:00) ───────────────────
// CGR utilise Playwright/Chromium et est planifié séparément à 09:00
// pour ne pas provoquer d'OOM en cumulant avec AlloCiné.
const HTTP_SCRAPERS = [
    new ugc_scraper_js_1.UgcScraper(),
    new allocine_scraper_js_1.AllocineScraper(),
    new pathe_scraper_js_1.PatheScraper(),
    new mk2_scraper_js_1.Mk2Scraper(),
];
// ── Runner générique ──────────────────────────────────────
async function runScrapers(scrapers, label) {
    const startedAt = new Date();
    console.log(`\n${"─".repeat(50)}\n` +
        `🕐 Scraping [${label}] démarré — ${startedAt.toLocaleString("fr-FR")}\n` +
        `${"─".repeat(50)}`);
    let totalCinemas = 0;
    let totalFilms = 0;
    let totalSeances = 0;
    let totalErrors = 0;
    for (const scraper of scrapers) {
        console.log(`\n🔍 Lancement du scraper : ${scraper.name.toUpperCase()}`);
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
                : (console.log(`💾 Sauvegarde en base de données…`), await scraper_service_js_1.scraperService.save(result));
            const cinemaCount = scraper instanceof allocine_scraper_js_1.AllocineScraper
                ? stats.cinemasCreated + stats.cinemasUpdated
                : result.cinemas.length;
            const filmCount = scraper instanceof allocine_scraper_js_1.AllocineScraper
                ? stats.filmsCreated + stats.filmsUpdated
                : result.cinemas.reduce((acc, c) => acc + c.films.length, 0);
            const seanceCount = scraper instanceof allocine_scraper_js_1.AllocineScraper
                ? stats.seancesCreated + stats.seancesUpdated
                : result.cinemas.reduce((acc, c) => acc + c.films.reduce((a, f) => a + f.seances.length, 0), 0);
            totalCinemas += cinemaCount;
            totalFilms += filmCount;
            totalSeances += seanceCount;
            totalErrors += result.errors.length;
            console.log(`\n📊 Bilan ${scraper.name.toUpperCase()} :\n` +
                `   Cinémas : ${cinemaCount} scrapés ` +
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
        }
    }
    // Nettoyage des séances passées (uniquement après le batch principal)
    if (label === "HTTP") {
        try {
            const deleted = await scraper_service_js_1.scraperService.cleanOldSeances();
            if (deleted > 0) {
                console.log(`\n🧹 ${deleted} séance(s) passée(s) supprimée(s)`);
            }
        }
        catch (err) {
            console.error("⚠️  Erreur lors du nettoyage des séances :", err);
        }
    }
    const durationMs = Date.now() - startedAt.getTime();
    const durationStr = durationMs > 60_000
        ? `${Math.round(durationMs / 60_000)}min`
        : `${Math.round(durationMs / 1_000)}s`;
    console.log(`\n${"─".repeat(50)}\n` +
        `✅ Scraping [${label}] terminé en ${durationStr}\n` +
        `   Total cinémas : ${totalCinemas}\n` +
        `   Total films   : ${totalFilms}\n` +
        `   Total séances : ${totalSeances}\n` +
        `   Total erreurs : ${totalErrors}\n` +
        `${"─".repeat(50)}\n`);
    if (label === "HTTP") {
        runPostScrapeJobs();
    }
}
/**
 * Exécute les scrapers HTTP (UGC, AlloCiné, Pathé, MK2).
 * Appelé à 06:00 ou manuellement.
 */
async function runAllScrapers() {
    await runScrapers(HTTP_SCRAPERS, "HTTP");
}
/**
 * Exécute le scraper CGR (Playwright).
 * Appelé à 09:00, après que le batch HTTP ait libéré la mémoire.
 */
async function runCgrScraper() {
    await runScrapers([new cgr_scraper_js_1.CgrScraper()], "CGR");
}
/** Lance auto-fix-posters puis check-alertes en sous-processus (non bloquant) */
function runPostScrapeJobs() {
    const scripts = [
        "dist/scripts/auto-fix-posters.js",
        "dist/scripts/check-alertes.js",
    ];
    for (const script of scripts) {
        const label = script.split("/").pop();
        console.log(`\n⚙️  Post-scrape : lancement de ${label}…`);
        const child = (0, child_process_1.spawn)("node", [script], {
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
// ── Enregistrement des crons ──────────────────────────────
/**
 * Enregistre les deux jobs cron :
 *   - 06:00 → scrapers HTTP (UGC, AlloCiné, Pathé, MK2)
 *   - 09:00 → scraper CGR (Playwright) isolé pour éviter l'OOM
 */
function registerScrapeJob() {
    // Hardcodé "tous les jours" — la var d'env SCRAPE_CRON peut être mal configurée
    const httpCron = "0 11 * * *";
    const cgrCron = "0 14 * * *";
    if (!node_cron_1.default.validate(httpCron)) {
        throw new Error(`Expression cron invalide : "${httpCron}" (SCRAPE_CRON)`);
    }
    if (!node_cron_1.default.validate(cgrCron)) {
        throw new Error(`Expression cron invalide : "${cgrCron}" (SCRAPE_CRON_CGR)`);
    }
    node_cron_1.default.schedule(httpCron, () => {
        console.log("[CRON] Déclenchement du job HTTP (UGC, AlloCiné, Pathé, MK2) — processes isolés…");
        const child = (0, child_process_1.spawn)("node", ["dist/scripts/run-scraper.js"], {
            cwd: process.cwd(), shell: true, stdio: "inherit",
        });
        child.on("error", (err) => console.error("[CRON HTTP] Erreur :", err.message));
        child.on("close", (code) => console.log(`[CRON HTTP] Terminé (code ${code})`));
    }, { timezone: "Europe/Paris" });
    node_cron_1.default.schedule(cgrCron, () => {
        console.log("[CRON] Déclenchement du job CGR (Playwright)…");
        const child = (0, child_process_1.spawn)("node", ["dist/scripts/run-scraper.js", "cgr"], {
            cwd: process.cwd(), shell: true, stdio: "inherit",
        });
        child.on("error", (err) => console.error("[CRON CGR] Erreur :", err.message));
        child.on("close", (code) => console.log(`[CRON CGR] Terminé (code ${code})`));
    }, { timezone: "Europe/Paris" });
    console.log(`✅ Jobs de scraping planifiés :\n` +
        `   HTTP (UGC/AlloCiné/Pathé/MK2) : "${httpCron}" (Europe/Paris)\n` +
        `   CGR  (Playwright)              : "${cgrCron}"  (Europe/Paris)`);
}
//# sourceMappingURL=scrape.job.js.map