// Diagnostic AlloCiné API JSON - dump complet de la structure
import { chromium } from "playwright";
import * as fs from "fs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const today = new Date().toISOString().split("T")[0];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA, locale: "fr-FR" });

  const response = await ctx.request.get(
    `https://www.allocine.fr/_/showtimes/theater-C0159/d-${today}/`,
    { headers: { "Referer": "https://www.allocine.fr/seance/salle_gen_csalle=C0159.html" } }
  );
  const body = await response.text();
  const data = JSON.parse(body);

  // Sauvegarder la réponse complète pour inspection
  fs.writeFileSync("/tmp/allocine-response.json", JSON.stringify(data, null, 2));
  console.log("Réponse sauvegardée dans /tmp/allocine-response.json");

  // Structure détaillée
  console.log(`Films: ${data.results?.length}`);
  const r = data.results?.[0];
  if (r) {
    console.log("\n--- Movie ---");
    console.log(JSON.stringify(r.movie, null, 2));
    console.log("\n--- Showtimes keys ---");
    console.log(Object.keys(r.showtimes));
    console.log("\n--- First showtime per key ---");
    for (const [key, arr] of Object.entries(r.showtimes as Record<string, unknown[]>)) {
      if (Array.isArray(arr) && arr.length > 0) {
        console.log(`${key}: ${JSON.stringify(arr[0])}`);
      }
    }
  }

  // Aussi: theater info
  console.log("\n--- Theater info from results[0] ---");
  console.log(JSON.stringify(data.results?.[0]?.theater ?? data.theater ?? "(not found)"));

  // Top-level keys
  console.log("\n--- Top-level keys ---");
  console.log(Object.keys(data));

  await ctx.close();
  await browser.close();
}

main().catch(console.error);
