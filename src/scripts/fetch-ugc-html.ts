import { chromium } from "playwright";
import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();

const BASE = "https://www.ugc.fr";
const FILM_ID = "17538";
const CINEMA_ID = "10";

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ locale: "fr-FR", timezoneId: "Europe/Paris",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"
  });
  const p = await ctx.newPage();

  // Intercepter pour capturer regionId et response POST
  let regionId = "";
  const postResponseHtmls: Record<string, string> = {};

  await p.route("**/*getShowingsByFilm*", async (route) => {
    const req = route.request();
    const body = req.postData() ?? "";
    const m = body.match(/regionId=([^&]*)/);
    if (m?.[1]) regionId = m[1];
    const resp = await route.fetch();
    const html = await resp.text();
    const dayMatch = body.match(/day=([^&]+)/);
    if (dayMatch) postResponseHtmls[dayMatch[1]] = html;
    await route.fulfill({ response: resp, body: html });
  });

  await p.goto(`${BASE}/film_c_est_quoi_l_amour__${FILM_ID}.html?cinemaId=${CINEMA_ID}`,
    { waitUntil: "networkidle", timeout: 45000 });

  console.log("RegionId détecté:", regionId || "(non trouvé, essai avec 3000)");
  regionId = regionId || "3000";

  // Sauvegarder la réponse POST initiale pour analyse
  const firstKey = Object.keys(postResponseHtmls)[0];
  if (firstKey) {
    fs.writeFileSync("C:/tmp/ugc-post-response.html", postResponseHtmls[firstKey]);
    const txt = postResponseHtmls[firstKey].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 800);
    console.log("\nRéponse POST (texte):", txt);

    // Chercher des patterns d'horaires
    const hourPat = [...(postResponseHtmls[firstKey] ?? "").matchAll(/[0-9]{2}:[0-9]{2}/g)].map(m => m[0]).slice(0, 20);
    const datePat = [...(postResponseHtmls[firstKey] ?? "").matchAll(/20[0-9]{2}-[0-9]{2}-[0-9]{2}/g)].map(m => m[0]).slice(0, 10);
    const datePat2 = [...(postResponseHtmls[firstKey] ?? "").matchAll(/[0-3][0-9]\/[01][0-9]\/20[0-9]{2}/g)].map(m => m[0]).slice(0, 10);
    console.log("Heures trouvées:", hourPat);
    console.log("Dates ISO:", [...new Set(datePat)]);
    console.log("Dates DD/MM:", [...new Set(datePat2)]);
  }

  // Test avec un autre jour
  console.log("\n=== Test POST day=2026-05-11 avec regionId=" + regionId + " ===");
  const result = await p.evaluate(async ({ filmId, regionId, day }: any) => {
    const body = `filmId=${filmId}&day=${day}&regionId=${regionId}&defaultRegionId=1&__multiselect_versions=`;
    const resp = await fetch("/showingsFilmAjaxAction!getShowingsByFilm.action", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" }, body,
    });
    return resp.text();
  }, { filmId: FILM_ID, regionId, day: "2026-05-11" });

  fs.writeFileSync("C:/tmp/ugc-post-day2.html", result);
  const txt2 = result.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 600);
  console.log("Réponse:", txt2);
  const hourPat2 = [...result.matchAll(/[0-9]{2}:[0-9]{2}/g)].map(m => m[0]).filter(h => parseInt(h.split(":")[0]) < 24).slice(0, 20);
  const datePat2 = [...new Set([...result.matchAll(/[0-3][0-9]\/[01][0-9]\/20[0-9]{2}/g)].map(m => m[0]))];
  const dataAttrs = (result.match(/data-seancehour/g) ?? []).length;
  console.log("data-seancehour:", dataAttrs, "| heures:", hourPat2, "| dates:", datePat2);

  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
