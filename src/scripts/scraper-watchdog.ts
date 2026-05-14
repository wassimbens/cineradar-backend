// ─────────────────────────────────────────────────────────
//  scraper-watchdog.ts
//
//  Lance le scraper AlloCiné et le relance automatiquement
//  en cas d'échec (exit code ≠ 0).
//
//  Comportement :
//    - Succès (exit 0)  → s'arrête proprement
//    - Échec  (exit ≠ 0) → attend 3 minutes, retente
//    - Limite de 5 tentatives max avant abandon
//
//  Usage :
//    npx tsx src/scripts/scraper-watchdog.ts
// ─────────────────────────────────────────────────────────

import { spawn } from "child_process";

const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 3 * 60 * 1000; // 3 minutes

// ── Helpers ───────────────────────────────────────────────

function log(message: string): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [WATCHDOG] ${message}`);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Runner ────────────────────────────────────────────────

function runScraperProcess(): Promise<number> {
  return new Promise((resolve) => {
    log("Lancement de : npm run scrape:allocine");

    const child = spawn("npm", ["run", "scrape:allocine"], {
      cwd: process.cwd(),
      shell: true,
      stdio: "inherit",
    });

    child.on("error", (err) => {
      log(`Erreur au démarrage du processus : ${err.message}`);
      resolve(1); // Traité comme un échec
    });

    child.on("close", (code) => {
      const exitCode = code ?? 1;
      log(`Processus terminé avec le code : ${exitCode}`);
      resolve(exitCode);
    });
  });
}

// ── Logique principale ────────────────────────────────────

async function runScraper(attempt: number): Promise<void> {
  log(`Tentative ${attempt}/${MAX_ATTEMPTS}`);

  const exitCode = await runScraperProcess();

  if (exitCode === 0) {
    log("Scraper terminé avec succès. Le watchdog s'arrête.");
    process.exit(0);
  }

  // Échec
  if (attempt >= MAX_ATTEMPTS) {
    log(
      `Échec après ${MAX_ATTEMPTS} tentatives. Abandon du watchdog.`
    );
    process.exit(1);
  }

  const delayMinutes = RETRY_DELAY_MS / 60_000;
  log(
    `Échec détecté (code ${exitCode}). Nouvelle tentative dans ${delayMinutes} minute(s)…`
  );

  await wait(RETRY_DELAY_MS);

  return runScraper(attempt + 1);
}

async function main(): Promise<void> {
  log("Démarrage du watchdog AlloCiné");
  log(`Paramètres : max ${MAX_ATTEMPTS} tentatives, délai ${RETRY_DELAY_MS / 60_000} min entre chaque`);

  await runScraper(1);
}

main().catch((err) => {
  log(`Erreur inattendue : ${String(err)}`);
  process.exit(1);
});
