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

import cron from "node-cron";
import { spawn } from "child_process";
import { BaseScraper } from "../scrapers/base.scraper.js";
import { UgcScraper } from "../scrapers/ugc.scraper.js";
import { AllocineScraper } from "../scrapers/allocine.scraper.js";
import { PatheScraper } from "../scrapers/pathe.scraper.js";
import { Mk2Scraper } from "../scrapers/mk2.scraper.js";
import { CgrScraper } from "../scrapers/cgr.scraper.js";
import { scraperService, makeEmptyStats } from "../services/scraper.service.js";

// ── Registre des scrapers HTTP (06:00) ───────────────────
// CGR utilise Playwright/Chromium et est planifié séparément à 09:00
// pour ne pas provoquer d'OOM en cumulant avec AlloCiné.

const HTTP_SCRAPERS: BaseScraper[] = [
  new UgcScraper(),
  new AllocineScraper(),
  new PatheScraper(),
  new Mk2Scraper(),
];

// ── Runner générique ──────────────────────────────────────

async function runScrapers(scrapers: BaseScraper[], label: string): Promise<void> {
  const startedAt = new Date();
  console.log(
    `\n${"─".repeat(50)}\n` +
      `🕐 Scraping [${label}] démarré — ${startedAt.toLocaleString("fr-FR")}\n` +
      `${"─".repeat(50)}`
  );

  let totalCinemas = 0;
  let totalFilms = 0;
  let totalSeances = 0;
  let totalErrors = 0;

  for (const scraper of scrapers) {
    console.log(`\n🔍 Lancement du scraper : ${scraper.name.toUpperCase()}`);

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
        : (console.log(`💾 Sauvegarde en base de données…`), await scraperService.save(result));

      const cinemaCount = scraper instanceof AllocineScraper
        ? stats.cinemasCreated + stats.cinemasUpdated
        : result.cinemas.length;
      const filmCount = scraper instanceof AllocineScraper
        ? stats.filmsCreated + stats.filmsUpdated
        : result.cinemas.reduce((acc, c) => acc + c.films.length, 0);
      const seanceCount = scraper instanceof AllocineScraper
        ? stats.seancesCreated + stats.seancesUpdated
        : result.cinemas.reduce((acc, c) => acc + c.films.reduce((a, f) => a + f.seances.length, 0), 0);

      totalCinemas += cinemaCount;
      totalFilms += filmCount;
      totalSeances += seanceCount;
      totalErrors += result.errors.length;

      console.log(
        `\n📊 Bilan ${scraper.name.toUpperCase()} :\n` +
          `   Cinémas : ${cinemaCount} scrapés ` +
          `(${stats.cinemasCreated} créés, ${stats.cinemasUpdated} mis à jour)\n` +
          `   Films   : ${filmCount} trouvés ` +
          `(${stats.filmsCreated} créés, ${stats.filmsUpdated} mis à jour)\n` +
          `   Séances : ${seanceCount} trouvées ` +
          `(${stats.seancesCreated} créées, ${stats.seancesUpdated} mises à jour)\n` +
          `   Erreurs : ${result.errors.length}`
      );

      if (result.errors.length > 0) {
        console.warn("⚠️  Erreurs non-bloquantes :");
        result.errors.forEach((e) => console.warn(`   • ${e}`));
      }
    } catch (err) {
      totalErrors++;
      console.error(
        `❌ Erreur fatale dans le scraper ${scraper.name} :`,
        err
      );
    }
  }

  // Nettoyage des séances passées (uniquement après le batch principal)
  if (label === "HTTP") {
    try {
      const deleted = await scraperService.cleanOldSeances();
      if (deleted > 0) {
        console.log(`\n🧹 ${deleted} séance(s) passée(s) supprimée(s)`);
      }
    } catch (err) {
      console.error("⚠️  Erreur lors du nettoyage des séances :", err);
    }
  }

  const durationMs = Date.now() - startedAt.getTime();
  const durationStr =
    durationMs > 60_000
      ? `${Math.round(durationMs / 60_000)}min`
      : `${Math.round(durationMs / 1_000)}s`;

  console.log(
    `\n${"─".repeat(50)}\n` +
      `✅ Scraping [${label}] terminé en ${durationStr}\n` +
      `   Total cinémas : ${totalCinemas}\n` +
      `   Total films   : ${totalFilms}\n` +
      `   Total séances : ${totalSeances}\n` +
      `   Total erreurs : ${totalErrors}\n` +
      `${"─".repeat(50)}\n`
  );

  if (label === "HTTP") {
    runPostScrapeJobs();
  }
}

/**
 * Exécute les scrapers HTTP (UGC, AlloCiné, Pathé, MK2).
 * Appelé à 06:00 ou manuellement.
 */
export async function runAllScrapers(): Promise<void> {
  await runScrapers(HTTP_SCRAPERS, "HTTP");
}

/**
 * Exécute le scraper CGR (Playwright).
 * Appelé à 09:00, après que le batch HTTP ait libéré la mémoire.
 */
export async function runCgrScraper(): Promise<void> {
  await runScrapers([new CgrScraper()], "CGR");
}

/** Lance auto-fix-posters puis check-alertes en sous-processus (non bloquant) */
function runPostScrapeJobs(): void {
  const scripts = [
    "dist/scripts/auto-fix-posters.js",
    "dist/scripts/check-alertes.js",
  ];

  for (const script of scripts) {
    const label = script.split("/").pop();
    console.log(`\n⚙️  Post-scrape : lancement de ${label}…`);

    const child = spawn("node", [script], {
      cwd: process.cwd(),
      shell: true,
      stdio: "inherit",
    });

    child.on("close", (code) => {
      if (code !== 0) {
        console.warn(`⚠️  ${label} terminé avec le code ${code}`);
      } else {
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
export function registerScrapeJob(): void {
  const httpCron = process.env["SCRAPE_CRON"]     ?? "0 6 * * *";
  const cgrCron  = process.env["SCRAPE_CRON_CGR"] ?? "0 9 * * *";

  if (!cron.validate(httpCron)) {
    throw new Error(`Expression cron invalide : "${httpCron}" (SCRAPE_CRON)`);
  }
  if (!cron.validate(cgrCron)) {
    throw new Error(`Expression cron invalide : "${cgrCron}" (SCRAPE_CRON_CGR)`);
  }

  cron.schedule(
    httpCron,
    async () => {
      console.log("[CRON] Déclenchement du job HTTP (UGC, AlloCiné, Pathé, MK2)…");
      try {
        await runAllScrapers();
      } catch (err) {
        console.error("[CRON] Erreur fatale non catchée :", err);
      }
    },
    { timezone: "Europe/Paris" }
  );

  cron.schedule(
    cgrCron,
    async () => {
      console.log("[CRON] Déclenchement du job CGR (Playwright)…");
      try {
        await runCgrScraper();
      } catch (err) {
        console.error("[CRON] Erreur fatale non catchée (CGR) :", err);
      }
    },
    { timezone: "Europe/Paris" }
  );

  console.log(
    `✅ Jobs de scraping planifiés :\n` +
    `   HTTP (UGC/AlloCiné/Pathé/MK2) : "${httpCron}" (Europe/Paris)\n` +
    `   CGR  (Playwright)              : "${cgrCron}"  (Europe/Paris)`
  );
}
