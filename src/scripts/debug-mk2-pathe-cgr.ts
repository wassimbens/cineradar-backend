// @ts-nocheck
// ─────────────────────────────────────────────────────────
//  Diagnostic MK2 + Pathé + CGR — intercepte les vraies APIs
//  Usage : npx tsx src/scripts/debug-mk2-pathe-cgr.ts
// ─────────────────────────────────────────────────────────

import { chromium } from "playwright";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const ARGS = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"];

function preview(s: string, n = 300) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// ── MK2 ───────────────────────────────────────────────────

async function debugMk2() {
  console.log("\n" + "=".repeat(60));
  console.log("=== MK2 : mk2.com/salle/mk2-bibliotheque ===");
  console.log("=".repeat(60));

  const browser = await chromium.launch({ headless: true, args: ARGS });
  const ctx = await browser.newContext({ userAgent: UA, locale: "fr-FR", timezoneId: "Europe/Paris" });
  const page = await ctx.newPage();

  const jsonResponses: { url: string; body: string }[] = [];
  const allRequests: string[] = [];

  page.on("request", (req) => {
    const url = req.url();
    if (req.resourceType() === "fetch" || req.resourceType() === "xhr" || url.includes("api") || url.includes("json") || url.includes("show")) {
      allRequests.push(`[${req.method()}] ${url}`);
    }
  });

  page.on("response", async (resp) => {
    const ct = resp.headers()["content-type"] ?? "";
    if (!ct.includes("json")) return;
    try {
      const body = await resp.text();
      jsonResponses.push({ url: resp.url(), body });
    } catch { /**/ }
  });

  // Charger la page
  await page.goto("https://www.mk2.com/salle/mk2-bibliotheque?date=2026-05-25", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForTimeout(5_000);

  // Extraire __NEXT_DATA__
  const nextDataRaw = await page.evaluate(() => {
    const el = document.querySelector("#__NEXT_DATA__");
    return el ? el.textContent : null;
  });

  if (nextDataRaw) {
    try {
      const nd = JSON.parse(nextDataRaw);
      console.log(`\n✅ __NEXT_DATA__ trouvé — buildId: ${nd.buildId}`);
      const pp = nd?.props?.pageProps;
      console.log(`pageProps keys: ${Object.keys(pp ?? {}).join(", ")}`);
      // Chercher toute clé qui contient "show", "seance", "film", "program", "schedule"
      const interesting = JSON.stringify(pp ?? {});
      const matches = interesting.match(/"(show[a-zA-Z]*|seance[a-zA-Z]*|screening[a-zA-Z]*|schedule[a-zA-Z]*|program[a-zA-Z]*|horaire[a-zA-Z]*)"/g);
      console.log(`Clés pertinentes dans pageProps: ${[...new Set(matches ?? [])].join(", ")}`);
      // Chercher des chaînes de dates ISO
      const dates = interesting.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/g) ?? [];
      console.log(`Dates ISO trouvées: ${[...new Set(dates)].slice(0, 5).join(", ")}`);
    } catch (e) {
      console.log(`Erreur parsing __NEXT_DATA__: ${e}`);
    }
  } else {
    console.log("❌ Pas de __NEXT_DATA__");
  }

  // Requêtes fetch/XHR
  console.log(`\nRequêtes API interceptées (${allRequests.length}) :`);
  allRequests.slice(0, 20).forEach(r => console.log(`  ${r.slice(0, 120)}`));

  // Réponses JSON
  console.log(`\nRéponses JSON (${jsonResponses.length}) :`);
  jsonResponses.slice(0, 10).forEach(r => {
    console.log(`  URL: ${r.url.slice(0, 100)}`);
    // Chercher des dates/horaires
    const dates = r.body.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/g) ?? [];
    const keys = r.body.match(/"([a-zA-Z_]+)":/g)?.slice(0, 20) ?? [];
    console.log(`  Dates: ${dates.slice(0, 3).join(", ")}`);
    console.log(`  Keys: ${[...new Set(keys)].join(", ")}`);
    console.log(`  Preview: ${preview(r.body, 200)}`);
    console.log();
  });

  // HTML — chercher horaires au format "HH:MM" ou "HHhMM"
  const html = await page.content();
  const times = html.match(/\b\d{1,2}[h:]\d{2}\b/g) ?? [];
  console.log(`Horaires dans HTML: ${[...new Set(times)].slice(0, 20).join(", ")}`);

  await browser.close();
}

// ── Pathé ─────────────────────────────────────────────────

async function debugPathe() {
  console.log("\n" + "=".repeat(60));
  console.log("=== PATHÉ : pathe.fr/cinemas/pathe-wepler ===");
  console.log("=".repeat(60));

  // Essai 1 : HTTP direct
  console.log("\n[1] HTTP direct...");
  try {
    const res = await fetch("https://www.pathe.fr/cinemas/pathe-wepler", {
      headers: { "User-Agent": UA, "Accept": "text/html" },
      signal: AbortSignal.timeout(10_000),
    });
    console.log(`Status HTTP: ${res.status}`);
    if (res.ok) {
      const html = await res.text();
      const hasNextData = html.includes("__NEXT_DATA__");
      const buildId = html.match(/"buildId":"([^"]+)"/)?.[1];
      console.log(`__NEXT_DATA__: ${hasNextData} — buildId: ${buildId ?? "non trouvé"}`);
      const dates = html.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/g) ?? [];
      console.log(`Dates ISO dans HTML: ${dates.slice(0, 5).join(", ")}`);
    }
  } catch (e) {
    console.log(`Erreur: ${e}`);
  }

  // Essai 2 : Playwright
  console.log("\n[2] Playwright...");
  const browser = await chromium.launch({ headless: true, args: ARGS });
  const ctx = await browser.newContext({ userAgent: UA, locale: "fr-FR", timezoneId: "Europe/Paris" });
  const page = await ctx.newPage();

  const jsonResponses: { url: string; body: string }[] = [];

  page.on("response", async (resp) => {
    const ct = resp.headers()["content-type"] ?? "";
    if (!ct.includes("json")) return;
    try {
      const body = await resp.text();
      if (body.length > 50) jsonResponses.push({ url: resp.url(), body });
    } catch { /**/ }
  });

  try {
    await page.goto("https://www.pathe.fr/cinemas/pathe-wepler?date=2026-05-25", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForTimeout(8_000);

    const nextDataRaw = await page.evaluate(() => {
      const el = document.querySelector("#__NEXT_DATA__");
      return el ? el.textContent : null;
    });

    if (nextDataRaw) {
      const nd = JSON.parse(nextDataRaw);
      console.log(`✅ buildId: ${nd.buildId}`);
      const pp = nd?.props?.pageProps ?? {};
      console.log(`pageProps keys: ${Object.keys(pp).join(", ")}`);
      const s = JSON.stringify(pp);
      const dates = s.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/g) ?? [];
      console.log(`Dates ISO: ${[...new Set(dates)].slice(0, 5).join(", ")}`);
      // Chercher clé showtimes
      const showtimeKey = s.match(/"(show\w*|seance\w*|horaire\w*|program\w*|schedule\w*)":/gi)?.slice(0, 10);
      console.log(`Clés séances: ${[...new Set(showtimeKey ?? [])].join(", ")}`);
    } else {
      console.log("❌ Pas de __NEXT_DATA__");
    }

    console.log(`\nRéponses JSON (${jsonResponses.length}) :`);
    jsonResponses.slice(0, 8).forEach(r => {
      console.log(`  URL: ${r.url.slice(0, 100)}`);
      const dates = r.body.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/g) ?? [];
      console.log(`  Dates: ${dates.slice(0, 3).join(", ")}`);
      console.log(`  Preview: ${preview(r.body, 150)}`);
      console.log();
    });

    const html = await page.content();
    const times = html.match(/\b\d{1,2}[h:]\d{2}\b/g) ?? [];
    console.log(`Horaires dans HTML rendu: ${[...new Set(times)].slice(0, 20).join(", ")}`);

  } catch (e) {
    console.log(`Erreur Playwright: ${e}`);
  }

  await browser.close();
}

// ── CGR ───────────────────────────────────────────────────

async function debugCgr() {
  console.log("\n" + "=".repeat(60));
  console.log("=== CGR : cgrcinemas.fr/horaire-film/p0905-cgr-brignais-lyon ===");
  console.log("=".repeat(60));

  const browser = await chromium.launch({ headless: true, args: ARGS });
  const ctx = await browser.newContext({ userAgent: UA, locale: "fr-FR", timezoneId: "Europe/Paris" });
  const page = await ctx.newPage();

  const jsonResponses: { url: string; body: string }[] = [];

  page.on("response", async (resp) => {
    const ct = resp.headers()["content-type"] ?? "";
    if (!ct.includes("json")) return;
    try {
      const body = await resp.text();
      if (body.length > 50) jsonResponses.push({ url: resp.url(), body });
    } catch { /**/ }
  });

  await page.goto("https://www.cgrcinemas.fr/horaire-film/p0905-cgr-brignais-lyon/?date=2026-05-25", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForTimeout(6_000);

  const html = await page.content();

  // JSON-LD
  const jsonLdMatches = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g) ?? [];
  console.log(`\nJSON-LD scripts: ${jsonLdMatches.length}`);
  jsonLdMatches.slice(0, 5).forEach((s, i) => {
    console.log(`  [${i}]: ${preview(s, 200)}`);
  });

  // Horaires dans HTML
  const times = html.match(/\b\d{1,2}[h:]\d{2}\b/g) ?? [];
  console.log(`\nHoraires dans HTML: ${[...new Set(times)].slice(0, 20).join(", ")}`);

  // Films dans HTML
  const titles = html.match(/class="[^"]*film[^"]*"[^>]*>([^<]{3,60})</gi) ?? [];
  console.log(`Titres films trouvés: ${titles.slice(0, 10).map(t => t.replace(/<[^>]+>/g, "").trim()).join(" | ")}`);

  // Classes CSS pertinentes
  const classes = new Set<string>();
  (html.match(/class="([^"]+)"/g) ?? []).forEach(m => {
    m.replace(/class="/, "").replace(/"$/, "").split(/\s+/).forEach(c => {
      if (c.length > 3 && (c.includes("film") || c.includes("seance") || c.includes("show") || c.includes("horaire") || c.includes("movie") || c.includes("schedule"))) {
        classes.add(c);
      }
    });
  });
  console.log(`Classes CSS pertinentes: ${Array.from(classes).join(", ")}`);

  // Requêtes JSON
  console.log(`\nRéponses JSON (${jsonResponses.length}) :`);
  jsonResponses.slice(0, 8).forEach(r => {
    console.log(`  URL: ${r.url.slice(0, 100)}`);
    const dates = r.body.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/g) ?? [];
    console.log(`  Dates: ${dates.slice(0, 3).join(", ")}`);
    console.log(`  Preview: ${preview(r.body, 150)}`);
    console.log();
  });

  // Vérifier si URL renvoie 404
  const finalUrl = page.url();
  console.log(`\nURL finale (après redirects): ${finalUrl}`);

  await browser.close();
}

// ── Main ──────────────────────────────────────────────────

async function main() {
  try { await debugMk2(); } catch (e) { console.error("MK2 error:", e); }
  try { await debugPathe(); } catch (e) { console.error("Pathé error:", e); }
  try { await debugCgr(); } catch (e) { console.error("CGR error:", e); }
  console.log("\n✅ Diagnostic terminé.");
}

main().catch(console.error);
