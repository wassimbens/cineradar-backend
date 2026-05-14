"use strict";
// ─────────────────────────────────────────────────────────
//  Script de diagnostic Pathé — identifie les vraies URLs API
//  Usage : npx tsx src/scripts/debug-pathe.ts
// ─────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
const playwright_1 = require("playwright");
async function main() {
    console.log("🔍 Analyse de pathe.fr…\n");
    const browser = await playwright_1.chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        locale: "fr-FR",
        timezoneId: "Europe/Paris",
    });
    const page = await context.newPage();
    // Logguer TOUTES les requêtes sortantes
    page.on("request", (req) => {
        const url = req.url();
        const type = req.resourceType();
        if (["fetch", "xhr", "document", "script"].includes(type)) {
            console.log(`[REQ] ${type.padEnd(8)} ${url}`);
        }
    });
    // Logguer TOUTES les réponses et afficher le contenu JSON
    page.on("response", async (resp) => {
        const url = resp.url();
        const status = resp.status();
        const ct = resp.headers()["content-type"] ?? "";
        if (ct.includes("json")) {
            try {
                const json = await resp.json();
                const preview = JSON.stringify(json).slice(0, 200);
                console.log(`\n✅ [JSON ${status}] ${url}`);
                console.log(`   → ${preview}…\n`);
            }
            catch {
                console.log(`[JSON err] ${url}`);
            }
        }
        else if (["fetch", "xhr"].includes(resp.request().resourceType())) {
            console.log(`[RESP ${status}] ${url}`);
        }
    });
    console.log("📡 Navigation vers pathe.fr/cinemas/pathe-wepler …\n");
    await page.goto("https://www.pathe.fr/cinemas/pathe-wepler", {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
    });
    // Attendre plus longtemps pour que les requêtes XHR se chargent
    console.log("⏳ Attente des requêtes dynamiques (15s)…");
    await page.waitForTimeout(15_000);
    // Tenter aussi un scroll pour déclencher le lazy loading
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(5_000);
    console.log("\n✅ Analyse terminée.");
    await browser.close();
}
main().catch(console.error);
//# sourceMappingURL=debug-pathe.js.map