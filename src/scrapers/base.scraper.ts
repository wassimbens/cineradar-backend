// ─────────────────────────────────────────────────────────
//  Classe abstraite commune à tous les scrapers
//  Fournit : retry automatique, délai configurable, logging
// ─────────────────────────────────────────────────────────

import { ScraperResult } from "./types.js";

// ── Config retry ─────────────────────────────────────────

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 5_000; // 5 secondes entre chaque tentative

// ── Classe abstraite ─────────────────────────────────────

export abstract class BaseScraper {
  /** Identifiant court de la source, ex: "ugc" */
  abstract readonly name: string;

  /** Délai minimum entre deux requêtes HTTP (anti-ban) */
  protected readonly delayMs: number;

  constructor() {
    this.delayMs = Number(process.env["SCRAPER_DELAY_MS"] ?? 1_000);
  }

  // ── Méthode principale à implémenter ───────────────────

  /**
   * Exécute le scraping complet.
   * Ne lance pas d'exception : les erreurs sont agrégées dans `result.errors`.
   */
  abstract scrape(): Promise<ScraperResult>;

  // ── Utilitaires protégés ───────────────────────────────

  /**
   * Exécute `fn` avec retry automatique.
   *
   * @param fn       Fonction async à exécuter
   * @param context  Libellé affiché dans les logs (ex: "cinéma UGC Opéra")
   * @param attempts Nombre maximum de tentatives (défaut : MAX_ATTEMPTS)
   */
  protected async withRetry<T>(
    fn: () => Promise<T>,
    context: string,
    attempts: number = MAX_ATTEMPTS
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        const isLast = attempt === attempts;

        this.log(
          `⚠️  Échec tentative ${attempt}/${attempts} — ${context}` +
            (!isLast ? ` — retry dans ${BACKOFF_MS / 1000}s` : " — abandon"),
          "warn"
        );

        if (!isLast) {
          await this.sleep(BACKOFF_MS * attempt); // backoff croissant
        }
      }
    }

    throw lastError;
  }

  /**
   * Attend `ms` millisecondes.
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Attend le délai anti-ban configuré via SCRAPER_DELAY_MS.
   */
  protected async politeDelay(): Promise<void> {
    if (this.delayMs > 0) await this.sleep(this.delayMs);
  }

  /**
   * Affiche un message de log préfixé avec le nom du scraper.
   */
  protected log(
    message: string,
    level: "info" | "warn" | "error" = "info"
  ): void {
    const prefix = `[${this.name.toUpperCase()}]`;
    const ts = new Date().toISOString().substring(11, 19); // HH:MM:SS

    switch (level) {
      case "warn":
        console.warn(`${ts} ${prefix} ${message}`);
        break;
      case "error":
        console.error(`${ts} ${prefix} ${message}`);
        break;
      default:
        console.log(`${ts} ${prefix} ${message}`);
    }
  }

  /**
   * Construit un ScraperResult vide (point de départ).
   */
  protected makeResult(): ScraperResult {
    return {
      source: this.name,
      scrapedAt: new Date(),
      cinemas: [],
      errors: [],
    };
  }

  /**
   * Ajoute une erreur non-bloquante au résultat et la logue.
   */
  protected addError(result: ScraperResult, message: string): void {
    this.log(message, "error");
    result.errors.push(message);
  }
}
