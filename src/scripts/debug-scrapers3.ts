// Diagnostic ciblé AlloCiné (API réseau) + UGC (page film)
// Usage: npx tsx src/scripts/debug-scrapers3.ts

import { chromium } from "playwright";
import * as cheerio from "cheerio";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA, locale: "fr-FR", timezoneId: "Europe/Paris" });

  // ─── 1. UGC page film ─────────────────────────────────────
  console.log("=== 1. UGC PAGE FILM ===");
  {
    const page = await ctx.newPage();
    await page.goto(
      "https://www.ugc.fr/film_le_diable_s_habille_en_prada_2_17381.html",
      { waitUntil: "domcontentloaded", timeout: 30_000 }
    );
    const html = await page.content();
    const $ = cheerio.load(html);

    // JSON-LD
    const jsonLds: string[] = [];
    $('script[type="application/ld+json"]').each((_, el) => {
      jsonLds.push($(el).html() ?? "");
    });
    console.log(`JSON-LD scripts: ${jsonLds.length}`);
    jsonLds.forEach((j, i) => {
      console.log(`  [${i}] type: ${j.slice(0, 50)}`);
      try {
        const d = JSON.parse(j);
        console.log(`  [${i}] @type: ${d["@type"]}, name: ${d.name ?? "(none)"}`);
      } catch (e) {
        console.log(`  [${i}] parse error`);
      }
    });

    // Titre fallback
    const h1 = $("h1").first().text().trim();
    const ogTitle = $('meta[property="og:title"]').attr("content") ?? "";
    console.log(`H1: "${h1}"`);
    console.log(`og:title: "${ogTitle}"`);

    // Image affiche
    const ogImage = $('meta[property="og:image"]').attr("content") ?? "";
    console.log(`og:image: "${ogImage.slice(0, 80)}"`);

    await page.close();
  }

  // ─── 2. AlloCiné : intercepter les requêtes réseau ───────
  console.log("\n=== 2. AlloCiné RÉSEAU ===");
  {
    const page = await ctx.newPage();
    const capturedRequests: { url: string; type: string }[] = [];

    // Intercepter toutes les requêtes
    page.on("request", (req) => {
      const url = req.url();
      const type = req.resourceType();
      if (type === "fetch" || type === "xhr" || url.includes("api") || url.includes("json") || url.includes("showtime") || url.includes("seance")) {
        capturedRequests.push({ url, type });
      }
    });

    // Intercepter les réponses JSON
    const capturedResponses: { url: string; body: string }[] = [];
    page.on("response", async (res) => {
      const url = res.url();
      const ct = res.headers()["content-type"] ?? "";
      if (!ct.includes("json")) return;
      if (url.includes("allocine") && (url.includes("show") || url.includes("movie") || url.includes("film") || url.includes("seance") || url.includes("theater"))) {
        try {
          const body = await res.text();
          capturedResponses.push({ url, body: body.slice(0, 500) });
        } catch { /**/ }
      }
    });

    await page.goto(
      "https://www.allocine.fr/seance/salle_gen_csalle=C0159.html",
      { waitUntil: "networkidle", timeout: 45_000 }
    );

    console.log(`Requêtes capturées: ${capturedRequests.length}`);
    capturedRequests.slice(0, 20).forEach(r => {
      console.log(`  [${r.type}] ${r.url.slice(0, 100)}`);
    });

    console.log(`\nRéponses JSON capturées: ${capturedResponses.length}`);
    capturedResponses.forEach(r => {
      console.log(`  URL: ${r.url.slice(0, 100)}`);
      console.log(`  Body: ${r.body.slice(0, 200)}`);
    });

    // Après networkidle, vérifier le DOM complet
    const html = await page.content();
    const $ = cheerio.load(html);

    // Chercher tous les éléments avec heure
    const timeRegex = /\b\d{1,2}h\d{2}\b/g;
    const allText = $.text();
    const times = allText.match(timeRegex) ?? [];
    console.log(`\nHoraires 'Xh00' après networkidle: ${[...new Set(times)].slice(0, 20).join(", ")}`);

    // Classes CSS disponibles
    const allClasses = new Set<string>();
    $("[class]").each((_, el) => {
      const cls = $(el).attr("class") ?? "";
      cls.split(/\s+/).forEach(c => { if (c && c.length > 3 && c.length < 30) allClasses.add(c); });
    });
    const classArr = Array.from(allClasses).filter(c =>
      c.includes("show") || c.includes("movie") || c.includes("film") || c.includes("hour") || c.includes("time") || c.includes("seance") || c.includes("card")
    );
    console.log(`Classes pertinentes: ${classArr.join(", ")}`);

    // Scripts contenant des données de séances
    $("script").each((i, el) => {
      const src = $(el).html() ?? "";
      if (src.includes("startDate") || src.includes("ScreeningEvent") || src.includes("seanceId") || (src.length > 1000 && src.includes("showtime"))) {
        console.log(`\nScript[${i}] (${src.length}c) — extrait:`);
        console.log(`  ${src.slice(0, 400)}`);
      }
    });

    await page.close();
  }

  // ─── 3. AlloCiné : API JSON directe ──────────────────────
  console.log("\n=== 3. AlloCiné API directe ===");
  {
    const page = await ctx.newPage();
    // Essaie d'appeler l'API GraphQL ou REST d'AlloCiné directement
    const testApis = [
      "https://www.allocine.fr/showtimes/theater-C0159",
      "https://www.allocine.fr/api/showtimes/theater-C0159",
      "https://www.allocine.fr/_next/data/theater/C0159.json",
      "https://api.allocine.fr/rest/v3/showtimelist?partner=YW5kcm9pZA&theater=C0159",
    ];

    for (const url of testApis) {
      try {
        const r = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10_000 });
        const body = await page.content();
        console.log(`  [${r?.status()}] ${url.slice(0, 60)} — ${body.length}c`);
        if (body.length < 5000 && (body.includes("{") || body.includes("["))) {
          console.log(`  Preview: ${body.slice(0, 200)}`);
        }
      } catch (e) {
        console.log(`  ERROR: ${url.slice(0, 60)} — ${e}`);
      }
    }

    await page.close();
  }

  await ctx.close();
  await browser.close();

  console.log("\n=== FIN ===");
}

main().catch(console.error);
