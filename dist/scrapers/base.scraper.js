"use strict";
// ─────────────────────────────────────────────────────────
//  Classe abstraite commune à tous les scrapers
//  Fournit : retry automatique, délai configurable, logging
// ─────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseScraper = void 0;
// ── Config retry ─────────────────────────────────────────
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 5_000; // 5 secondes entre chaque tentative
// ── Classe abstraite ─────────────────────────────────────
class BaseScraper {
    /** Délai minimum entre deux requêtes HTTP (anti-ban) */
    delayMs;
    constructor() {
        this.delayMs = Number(process.env["SCRAPER_DELAY_MS"] ?? 1_000);
    }
    // ── Utilitaires protégés ───────────────────────────────
    /**
     * Exécute `fn` avec retry automatique.
     *
     * @param fn       Fonction async à exécuter
     * @param context  Libellé affiché dans les logs (ex: "cinéma UGC Opéra")
     * @param attempts Nombre maximum de tentatives (défaut : MAX_ATTEMPTS)
     */
    async withRetry(fn, context, attempts = MAX_ATTEMPTS) {
        let lastError;
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                return await fn();
            }
            catch (err) {
                lastError = err;
                const isLast = attempt === attempts;
                this.log(`⚠️  Échec tentative ${attempt}/${attempts} — ${context}` +
                    (!isLast ? ` — retry dans ${BACKOFF_MS / 1000}s` : " — abandon"), "warn");
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
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    /**
     * Attend le délai anti-ban configuré via SCRAPER_DELAY_MS.
     */
    async politeDelay() {
        if (this.delayMs > 0)
            await this.sleep(this.delayMs);
    }
    /**
     * Affiche un message de log préfixé avec le nom du scraper.
     */
    log(message, level = "info") {
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
    makeResult() {
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
    addError(result, message) {
        this.log(message, "error");
        result.errors.push(message);
    }
}
exports.BaseScraper = BaseScraper;
//# sourceMappingURL=base.scraper.js.map