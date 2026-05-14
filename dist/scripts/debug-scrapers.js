"use strict";
// Script de diagnostic des scrapers — vérifie les URLs clés
// Usage : npx tsx src/scripts/debug-scrapers.ts
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const playwright_1 = require("playwright");
const cheerio = __importStar(require("cheerio"));
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
async function checkUrl(label, url) {
    const browser = await playwright_1.chromium.launch({ headless: true });
    const ctx = await browser.newContext({ userAgent: UA, locale: "fr-FR" });
    const page = await ctx.newPage();
    try {
        const r = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        const status = r?.status() ?? 0;
        const body = await page.content();
        console.log(`\n[${label}] ${url}`);
        console.log(`  Status: ${status}`);
        console.log(`  Body length: ${body.length} chars`);
        console.log(`  Preview (500c): ${body.replace(/\s+/g, " ").slice(0, 500)}`);
        return { status, body };
    }
    catch (e) {
        console.log(`[${label}] ERROR: ${e}`);
        return { status: 0, body: "" };
    }
    finally {
        await page.close();
        await ctx.close();
        await browser.close();
    }
}
async function main() {
    console.log("=== DIAGNOSTIC SCRAPERS ===\n");
    // ── UGC Endpoints ────────────────────────────────────────
    console.log("\n--- UGC ---");
    const ugcList = await checkUrl("UGC cinémas liste region=1", "https://www.ugc.fr/cinemasAjaxAction!getCinemasList.action?region=1");
    // Si la liste de cinémas retourne quelque chose d'utile
    if (ugcList.status === 200 && ugcList.body.length > 200) {
        const $ = cheerio.load(ugcList.body);
        const links = $("a[href*='cinema-ugc']").length;
        const options = $("option").length;
        console.log(`  → Liens cinema-ugc: ${links}, options: ${options}`);
        // Essaie d'extraire un slug ou ID
        const firstLink = $("a[href*='cinema']").first().attr("href") ?? "(aucun)";
        const firstOption = $("option").first().attr("value") ?? "(aucun)";
        console.log(`  → Premier lien: ${firstLink}`);
        console.log(`  → Première option: ${firstOption}`);
    }
    // Test page d'accueil UGC
    const ugcHome = await checkUrl("UGC home", "https://www.ugc.fr");
    // Test page cinéma UGC
    await checkUrl("UGC cinema page", "https://www.ugc.fr/cinema-ugc-cine-cite-les-halles.html");
    // Test endpoint programme cinéma (avec ID connu = 10 pour Les Halles)
    await checkUrl("UGC showings cinéma 10", "https://www.ugc.fr/showingsCinemaAjaxAction!getShowingsForCinemaPage.action?cinemaId=10");
    // ── AlloCiné ─────────────────────────────────────────────
    console.log("\n--- AlloCiné ---");
    await checkUrl("AlloCiné salle home", "https://www.allocine.fr/salle/");
    // Test URL cinéma Paris (UGC Les Halles sur AlloCiné = C0159)
    const allocineCinema = await checkUrl("AlloCiné cinéma C0159", "https://www.allocine.fr/seance/salle_gen_csalle=C0159.html");
    if (allocineCinema.status === 200) {
        const $ = cheerio.load(allocineCinema.body);
        const cards = $(".entity-card").length;
        const movieCards = $("[class*=movie-card]").length;
        const filmCards = $("[class*=film-card]").length;
        const showtimes = $(".showtimes-hour-item").length;
        const anyShowtime = $("[class*=showtime]").length;
        console.log(`  → .entity-card: ${cards}`);
        console.log(`  → [class*=movie-card]: ${movieCards}`);
        console.log(`  → [class*=film-card]: ${filmCards}`);
        console.log(`  → .showtimes-hour-item: ${showtimes}`);
        console.log(`  → [class*=showtime]: ${anyShowtime}`);
        // Voir les classes disponibles
        const allClasses = new Set();
        $("[class]").each((_, el) => {
            const cls = $(el).attr("class") ?? "";
            cls.split(/\s+/).forEach(c => { if (c && c.length > 3)
                allClasses.add(c); });
        });
        const classArr = Array.from(allClasses).slice(0, 50);
        console.log(`  → Quelques classes CSS: ${classArr.join(", ")}`);
    }
    // Test URL listing région Paris AlloCiné
    await checkUrl("AlloCiné région Paris", "https://www.allocine.fr/salle/region_gen_r_5767.html");
    console.log("\n=== DIAGNOSTIC TERMINÉ ===");
}
main().catch(console.error);
//# sourceMappingURL=debug-scrapers.js.map