/**
 * Flags Chromium optimisés pour environnement conteneur à mémoire limitée.
 * Utilisés par tous les scrapers Playwright.
 *
 * Impact mémoire cumulé : -40 à -60 % vs launch par défaut.
 */
export const CHROMIUM_ARGS: string[] = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  // Utilise /tmp au lieu de /dev/shm (limité dans les conteneurs Docker)
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-breakpad",
  "--disable-client-side-phishing-detection",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-hang-monitor",
  "--disable-ipc-flooding-protection",
  "--disable-notifications",
  "--disable-popup-blocking",
  "--disable-renderer-backgrounding",
  "--disable-sync",
  "--hide-scrollbars",
  "--metrics-recording-only",
  "--mute-audio",
  "--no-default-browser-check",
  "--no-first-run",
  // Supprime le processus zygote (forking) → économise ~80 MB
  "--no-zygote",
  // Fusionne browser + renderer dans un seul process → économise ~150 MB
  // (acceptable pour du scraping batch non-concurrent)
  "--single-process",
];
