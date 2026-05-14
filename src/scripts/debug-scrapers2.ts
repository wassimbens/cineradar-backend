// Diagnostic approfondi UGC + AlloCiné
// Usage: npx tsx src/scripts/debug-scrapers2.ts

import { chromium } from "playwright";
import * as cheerio from "cheerio";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function fetchPage(url: string): Promise<{ status: number; html: string }> {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA, locale: "fr-FR", timezoneId: "Europe/Paris" });
  const page = await ctx.newPage();
  try {
    const r = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    return { status: r?.status() ?? 0, html: await page.content() };
  } finally {
    await page.close();
    await ctx.close();
    await browser.close();
  }
}

async function main() {
  console.log("=== DIAGNOSTIC APPROFONDI ===\n");

  // ─── UGC : showings pour cinéma 10 (Les Halles) ──────────
  console.log("1. UGC showings cinéma 10 — analyse des liens film");
  const ugcShowings = await fetchPage(
    "https://www.ugc.fr/showingsCinemaAjaxAction!getShowingsForCinemaPage.action?cinemaId=10"
  );
  {
    const $ = cheerio.load(ugcShowings.html);
    // Chercher les liens vers des films
    const filmLinks = $('a[href*="film_"][href*="cinemaId"]');
    console.log(`  Liens a[href*="film_"][href*="cinemaId"]: ${filmLinks.length}`);
    filmLinks.slice(0, 5).each((_, el) => {
      console.log(`    → ${$(el).attr("href")?.slice(0, 100)}`);
    });

    // Chercher les liens vers des films sans cinemaId
    const filmLinksSimple = $('a[href*="film_"]');
    console.log(`  Liens a[href*="film_"]: ${filmLinksSimple.length}`);
    filmLinksSimple.slice(0, 5).each((_, el) => {
      console.log(`    → ${$(el).attr("href")?.slice(0, 100)}`);
    });

    // Chercher les divs de film
    const filmDivs = $('[id*="bloc-showing-film"]');
    console.log(`  Divs [id*=bloc-showing-film]: ${filmDivs.length}`);

    // Chercher les data-film-id
    const dataFilmId = $("[data-film-id], [data-filmid], [data-id]").slice(0, 5);
    dataFilmId.each((_, el) => {
      console.log(`  data-*: ${$(el).attr("data-film-id") ?? $(el).attr("data-filmid") ?? $(el).attr("data-id")}`);
    });

    // Extraire les IDs de film depuis les id="bloc-showing-film-{id}"
    const filmIds: string[] = [];
    filmDivs.each((_, el) => {
      const id = $(el).attr("id");
      const match = id?.match(/bloc-showing-film-(\d+)/);
      if (match) filmIds.push(match[1]);
    });
    console.log(`  IDs film extraits depuis divs: ${filmIds.slice(0, 10).join(", ")}`);

    // Premier bloc HTML d'un film
    if (filmDivs.length > 0) {
      const firstFilm = filmDivs.first();
      console.log(`  \n  Structure du 1er bloc film (300c):`);
      const htmlPreview = $.html(firstFilm).replace(/\s+/g, " ").slice(0, 300);
      console.log(`  ${htmlPreview}`);
    }
  }

  // ─── UGC : séances d'un film dans un cinéma ─────────────
  console.log("\n2. UGC séances film 17381 cinéma 10");
  const ugcSeances = await fetchPage(
    "https://www.ugc.fr/showingsFilmAjaxAction!getShowingsByFilm.action?filmId=17381&cinemaId=10"
  );
  {
    const $ = cheerio.load(ugcSeances.html);
    console.log(`  HTML length: ${ugcSeances.html.length}`);
    console.log(`  Status: ${ugcSeances.status}`);

    // Chercher des horaires
    const timeRegex = /\b(\d{1,2}:\d{2})\b/g;
    const allText = $.text();
    const times = allText.match(timeRegex) ?? [];
    console.log(`  Horaires trouvés: ${[...new Set(times)].slice(0, 20).join(", ")}`);

    // Chercher des éléments avec des heures
    const liElements = $("li");
    console.log(`  <li> éléments: ${liElements.length}`);
    liElements.slice(0, 10).each((_, el) => {
      const text = $(el).text().replace(/\s+/g, " ").trim().slice(0, 80);
      if (timeRegex.test(text)) console.log(`    li: ${text}`);
    });
    timeRegex.lastIndex = 0;

    // Chercher les en-têtes de dates
    const dayHeaders = $(".day, [class*=day-header], [class*=date]").slice(0, 5);
    dayHeaders.each((_, el) => {
      console.log(`  Date header: ${$(el).text().trim().slice(0, 50)}`);
    });

    // JSON-LD
    const jsonLds = $('script[type="application/ld+json"]').length;
    console.log(`  JSON-LD scripts: ${jsonLds}`);

    // Preview du HTML
    console.log(`  HTML preview (500c): ${ugcSeances.html.replace(/\s+/g, " ").slice(0, 500)}`);
  }

  // ─── AlloCiné : structure réelle de la page ──────────────
  console.log("\n3. AlloCiné cinéma C0159 — structure réelle");
  const allocinePage = await fetchPage(
    "https://www.allocine.fr/seance/salle_gen_csalle=C0159.html"
  );
  {
    const $ = cheerio.load(allocinePage.html);

    // Chercher les classes contenant "showtime"
    const showtimeEls = $("[class*=showtime]");
    console.log(`  [class*=showtime]: ${showtimeEls.length}`);
    showtimeEls.slice(0, 5).each((_, el) => {
      const cls = $(el).attr("class");
      const text = $(el).text().replace(/\s+/g, " ").trim().slice(0, 80);
      console.log(`    class="${cls?.slice(0, 60)}" text="${text.slice(0, 60)}"`);
    });

    // Chercher les horaires directement
    const timeRegex = /\b(\d{1,2}[h:]\d{2})\b/g;
    const allText = $.text();
    const times = allText.match(timeRegex) ?? [];
    console.log(`  Horaires (h: ou :): ${[...new Set(times)].slice(0, 20).join(", ")}`);

    // Chercher les titres de films
    const metaTitle = $("title").text().trim();
    console.log(`  Page title: ${metaTitle.slice(0, 80)}`);

    // Chercher des liens vers les films
    const filmLinks = $('a[href*="/film/"]').slice(0, 5);
    console.log(`  Liens /film/: ${$('a[href*="/film/"]').length}`);
    filmLinks.each((_, el) => {
      console.log(`    → ${$(el).attr("href")?.slice(0, 80)} | text: ${$(el).text().trim().slice(0, 40)}`);
    });

    // Chercher les structures de séances
    const possibleContainers = [
      ".js-show-showtimes-button",
      "[data-theater-id]",
      "[data-movie-showtimes]",
      ".showtimes-day",
      ".showtimes-week-movies-list",
      ".movie-card-showtimes",
      "[class*=movie]",
      "[class*=film]",
      ".card",
    ];
    for (const sel of possibleContainers) {
      const count = $(sel).length;
      if (count > 0) {
        console.log(`  ${sel}: ${count}`);
        $(sel).first().find("[class*=time], [class*=hour], [class*=heure]").slice(0, 3).each((_, el) => {
          console.log(`    → time element: "${$(el).text().trim().slice(0, 40)}"`);
        });
      }
    }

    // Chercher les scripts avec du JSON contenant des séances
    $("script").each((i, el) => {
      const src = $(el).html() ?? "";
      if (src.includes("showtime") || src.includes("seance") || src.includes("horaire")) {
        console.log(`  Script[${i}] avec 'showtime/seance/horaire' (${src.length}c): ${src.slice(0, 200)}`);
      }
    });
  }

  console.log("\n=== FIN DIAGNOSTIC ===");
}

main().catch(console.error);
