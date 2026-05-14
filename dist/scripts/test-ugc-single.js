"use strict";
/**
 * test-ugc-single.ts
 * Test rapide du nouveau scraper UGC sur 1 cinéma (Les Halles, id=10).
 * Vérifie que les séances ont les bonnes dates et le bon cinéma.
 * Usage : npx tsx src/scripts/test-ugc-single.ts
 */
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
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const BASE_URL = "https://www.ugc.fr";
// ── parseSeancesFromPost (copie de ugc.scraper.ts pour test isolé) ──
function parseSeancesFromPost(html, cinemaId, dayStr) {
    const $ = cheerio.load(html);
    const seances = [];
    const seen = new Set();
    const cinemaBlock = $(`#bloc-showing-cinema-${cinemaId}`);
    if (!cinemaBlock.length) {
        console.log(`  ⚠️  #bloc-showing-cinema-${cinemaId} absent`);
        return seances;
    }
    const [y, mo, d] = dayStr.split("-").map(Number);
    const baseDate = new Date(y, mo - 1, d);
    cinemaBlock.find(".screening-time-start").each((_, el) => {
        const timeStr = $(el).text().trim();
        if (!/^\d{1,2}:\d{2}$/.test(timeStr))
            return;
        const [hStr, mStr] = timeStr.split(":");
        const h = parseInt(hStr, 10);
        const m = parseInt(mStr, 10);
        if (h > 23 || m > 59)
            return;
        const dt = new Date(baseDate);
        dt.setHours(h, m, 0, 0);
        if (h < 4)
            dt.setDate(dt.getDate() + 1);
        let version = "VF";
        let $node = $(el).parent();
        for (let i = 0; i < 8; i++) {
            const txt = $node.clone().children().remove().end().text().toUpperCase().trim();
            if (txt.includes("VOSTFR") || txt.includes("VOST")) {
                version = "VOSTFR";
                break;
            }
            if (/\bVO\b/.test(txt) && !txt.includes("VF")) {
                version = "VOSTFR";
                break;
            }
            if (txt.includes("VF")) {
                version = "VF";
                break;
            }
            if ($node.attr("id") === `bloc-showing-cinema-${cinemaId}`)
                break;
            $node = $node.parent();
        }
        const key = `${dt.getTime()}|${version}`;
        if (seen.has(key))
            return;
        seen.add(key);
        seances.push({ dateHeure: dt, version });
    });
    return seances;
}
async function main() {
    const cinemaId = "10"; // UGC Ciné Cité Les Halles
    const filmId = "17538"; // C'est quoi l'amour ? (film de test de l'investigation)
    console.log(`\n🎬  Test scraper UGC — cinéma ${cinemaId}, film ${filmId}\n`);
    const browser = await playwright_1.chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const ctx = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        locale: "fr-FR",
        timezoneId: "Europe/Paris",
    });
    // Bloquer ressources inutiles
    await ctx.route("**/*", (route) => {
        const t = route.request().resourceType();
        if (["image", "font", "media", "stylesheet"].includes(t))
            route.abort();
        else
            route.continue();
    });
    const page = await ctx.newPage();
    let regionId = "3000";
    const autoPostHtmls = new Map();
    // Intercepter les POST getShowingsByFilm
    await page.route("**/*getShowingsByFilm*", async (route) => {
        const req = route.request();
        if (req.method() !== "POST") {
            await route.continue();
            return;
        }
        const body = req.postData() ?? "";
        const rId = body.match(/regionId=([^&]+)/)?.[1];
        if (rId)
            regionId = rId;
        const resp = await route.fetch();
        const html = await resp.text();
        const day = body.match(/day=([^&]+)/)?.[1];
        if (day)
            autoPostHtmls.set(day, html);
        await route.fulfill({ response: resp, body: html });
    });
    // Naviguer vers la page film+cinéma
    const filmUrl = `${BASE_URL}/film_c_est_quoi_l_amour__${filmId}.html?cinemaId=${cinemaId}`;
    console.log(`→ Navigation : ${filmUrl}`);
    try {
        await page.goto(filmUrl, { waitUntil: "networkidle", timeout: 45_000 });
    }
    catch {
        console.log("  (timeout, on continue)");
    }
    console.log(`→ regionId capté : ${regionId}`);
    console.log(`→ Auto-POSTs interceptés : ${autoPostHtmls.size} (jours: ${[...autoPostHtmls.keys()].join(", ")})\n`);
    // Jours disponibles
    const daysHtml = await page.evaluate(async (fId) => {
        const r = await fetch(`/showingsFilmAjaxAction!getDaysByFilm.action?filmId=${fId}&day=`, { headers: { "X-Requested-With": "XMLHttpRequest" } });
        return r.text();
    }, filmId);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + 14);
    const days = [...new Set([...daysHtml.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map(m => m[1]))]
        .sort().filter(d => { const dt = new Date(d); return dt >= today && dt <= horizon; });
    console.log(`→ Jours disponibles (getDaysByFilm): ${days.join(", ")}\n`);
    // Traiter les jours
    let total = 0;
    for (const day of days) {
        let html;
        if (autoPostHtmls.has(day)) {
            html = autoPostHtmls.get(day);
        }
        else {
            const body = `filmId=${filmId}&day=${day}&regionId=${regionId}&defaultRegionId=1&__multiselect_versions=`;
            html = await page.evaluate(async (b) => {
                const r = await fetch("/showingsFilmAjaxAction!getShowingsByFilm.action", {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
                    body: b,
                });
                return r.text();
            }, body);
        }
        const seances = parseSeancesFromPost(html, cinemaId, day);
        total += seances.length;
        console.log(`  ${day}: ${seances.length} séance(s)${seances.length > 0 ? " → " + seances.map(s => `${s.dateHeure.toISOString().slice(11, 16)}[${s.version}]`).join(", ") : ""}`);
    }
    console.log(`\n✅ Total : ${total} séance(s) pour cinéma ${cinemaId}\n`);
    await page.close();
    await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
//# sourceMappingURL=test-ugc-single.js.map