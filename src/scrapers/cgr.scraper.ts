// ─────────────────────────────────────────────────────────
//  Scraper CGR — cgrcinemas.fr
//
//  Stratégie :
//    1. Playwright → /horaire-film/{id}-{slug}/ (page rendue côté client)
//    2. Extraction JSON-LD ScreeningEvent (schema.org)
//    3. Fallback DOM : divs/data-* attributes CGR-spécifiques
//
//  Cinémas : 72 établissements (source : cgrcinemas.fr/cinema/)
//  Fenêtre : 14 jours (CGR publie ~10 jours à l'avance)
// ─────────────────────────────────────────────────────────

import { chromium, Browser, BrowserContext } from "playwright";
import * as cheerio from "cheerio";
import { Version } from "@prisma/client";
import { BaseScraper } from "./base.scraper.js";
import { CHROMIUM_ARGS } from "./chromium-args.js";
import {
  ScraperResult,
  ScrapedCinema,
  ScrapedFilm,
  ScrapedSeance,
  ScrapedCinemaFilm,
} from "./types.js";

const BASE_URL  = "https://www.cgrcinemas.fr";
const DAYS_AHEAD = 14; // CGR publie ~10 jours, on prend 14 par sécurité

// ── Liste complète des cinémas CGR ────────────────────────
// Source : https://www.cgrcinemas.fr/cinema/ (vérifié mai 2025)
// Format ID : lettre + 4 chiffres (ex: w3300, p0905, b0261)

const CGR_CINEMAS = [
  // ── Auvergne-Rhône-Alpes ──
  { id: "p0905", slug: "cgr-brignais-lyon",              nom: "CGR Brignais",                   adresse: "Espace Commercial Lyon Brignais", ville: "Brignais",              cp: "69530", lat: 45.6694, lng: 4.7521 },
  { id: "w6300", slug: "cgr-clermont-ferrand-le-paris",  nom: "CGR Clermont-Ferrand Le Paris",  adresse: "26 Rue Gaultier de Biauzat",     ville: "Clermont-Ferrand",      cp: "63000", lat: 45.7773, lng: 3.0832 },
  { id: "p0146", slug: "cgr-clermont-ferrand-les-ambiances", nom: "CGR Clermont-Ferrand Les Ambiances", adresse: "25 Rue Fontgiève",        ville: "Clermont-Ferrand",      cp: "63000", lat: 45.7795, lng: 3.0827 },
  { id: "p6310", slug: "cgr-clermont-ferrand-val-arena", nom: "CGR Clermont-Ferrand Val Arena", adresse: "Zone Commerciale du Val Arena",   ville: "Clermont-Ferrand",      cp: "63800", lat: 45.7565, lng: 3.1215 },
  { id: "w0310", slug: "cgr-moulins",                    nom: "CGR Moulins",                    adresse: "9 Rue de Paris",                 ville: "Moulins",               cp: "03000", lat: 46.5633, lng: 3.3320 },
  { id: "p6940", slug: "cgr-villefranche-sur-saone",     nom: "CGR Villefranche-sur-Saône",    adresse: "Rue du Rhône",                   ville: "Villefranche-sur-Saône",cp: "69400", lat: 45.9878, lng: 4.7178 },

  // ── Bourgogne-Franche-Comté ──
  { id: "p0331", slug: "cgr-auxerre",                    nom: "CGR Auxerre Casino",             adresse: "Zone Commerciale Auxerrois",     ville: "Auxerre",               cp: "89000", lat: 47.7987, lng: 3.5730 },
  { id: "p0199", slug: "cgr-beaune",                     nom: "CGR Beaune",                     adresse: "Rue de la Liberté",              ville: "Beaune",                cp: "21200", lat: 47.0260, lng: 4.8345 },

  // ── Bretagne ──
  { id: "p0151", slug: "cgr-brest-le-celtic",            nom: "CGR Brest Le Celtic",            adresse: "6 Rue de Siam",                  ville: "Brest",                 cp: "29200", lat: 48.3896, lng: -4.4903 },
  { id: "p4093", slug: "cgr-la-meziere-rennes",          nom: "CGR La Mézière",                 adresse: "Z.A.C. du Chêne Vert",           ville: "La Mézière",            cp: "35520", lat: 48.2397, lng: -1.7234 },
  { id: "p9556", slug: "cgr-lanester",                   nom: "CGR Lanester",                   adresse: "Zone Commerciale de Kerdual",    ville: "Lanester",              cp: "56600", lat: 47.7612, lng: -3.3520 },

  // ── Centre-Val de Loire ──
  { id: "p0925", slug: "cgr-bourges",                    nom: "CGR Bourges",                    adresse: "14 Rue Moyenne",                 ville: "Bourges",               cp: "18000", lat: 47.0819, lng: 2.3985 },
  { id: "p7963", slug: "cgr-chateauroux",                nom: "CGR Châteauroux",                adresse: "Place de la Victoire",           ville: "Châteauroux",           cp: "36000", lat: 46.8130, lng: 1.6906 },
  { id: "p0704", slug: "cgr-tours-2-lions",              nom: "CGR Tours 2 Lions",              adresse: "61 Av de la Tranchée",           ville: "Tours",                 cp: "37100", lat: 47.3839, lng: 0.7102 },
  { id: "p5756", slug: "cgr-tours-centre",               nom: "CGR Tours Centre",               adresse: "43 Rue Nationale",               ville: "Tours",                 cp: "37000", lat: 47.3941, lng: 0.6893 },

  // ── Grand Est ──
  { id: "p8517", slug: "cgr-chalons-en-champagne",       nom: "CGR Châlons-en-Champagne",      adresse: "7 Place Foch",                   ville: "Châlons-en-Champagne",  cp: "51000", lat: 48.9566, lng: 4.3653 },
  { id: "p3829", slug: "cgr-colmar",                     nom: "CGR Colmar",                     adresse: "4 Rue des Unterlinden",          ville: "Colmar",                cp: "68000", lat: 48.0778, lng: 7.3580 },
  { id: "p5044", slug: "cgr-freyming",                   nom: "CGR Freyming-Merlebach",         adresse: "Zone Commerciale",               ville: "Freyming-Merlebach",    cp: "57800", lat: 49.1515, lng: 6.7928 },
  { id: "p0983", slug: "cgr-troyes",                     nom: "CGR Troyes",                     adresse: "7 Rue de la Paix",               ville: "Troyes",                cp: "10000", lat: 48.2974, lng: 4.0748 },

  // ── Hauts-de-France ──
  { id: "w8010", slug: "cgr-abbeville-la-sucrerie",      nom: "CGR Abbeville La Sucrerie",      adresse: "5 Rue de la Sucrerie",           ville: "Abbeville",             cp: "80100", lat: 50.1046, lng: 1.8346 },
  { id: "p1133", slug: "cgr-beauvais",                   nom: "CGR Beauvais",                   adresse: "25 Rue Victor Hugo",             ville: "Beauvais",              cp: "60000", lat: 49.4299, lng: 2.0849 },
  { id: "p0993", slug: "cgr-bruay-la-buissiere",         nom: "CGR Bruay-la-Buissière",        adresse: "Rue du Docteur Schweitzer",      ville: "Bruay-la-Buissière",   cp: "62700", lat: 50.4892, lng: 2.5432 },
  { id: "p0798", slug: "cgr-saint-quentin",              nom: "CGR Saint-Quentin",              adresse: "6 Place de l'Hôtel de Ville",   ville: "Saint-Quentin",         cp: "02100", lat: 49.8461, lng: 3.2876 },
  { id: "p1016", slug: "cgr-soissons",                   nom: "CGR Soissons",                   adresse: "1 Rue de la Butte Rouge",        ville: "Soissons",              cp: "02200", lat: 49.3817, lng: 3.3232 },

  // ── Île-de-France ──
  { id: "b0261", slug: "cgr-epinay-sur-seine",           nom: "CGR Épinay-sur-Seine",           adresse: "Place du Marché",                ville: "Épinay-sur-Seine",      cp: "93800", lat: 48.9503, lng: 2.3097 },
  { id: "b0059", slug: "cgr-evry",                       nom: "CGR Évry",                       adresse: "Cours de la République",         ville: "Évry-Courcouronnes",    cp: "91000", lat: 48.6284, lng: 2.4277 },
  { id: "b0121", slug: "cgr-mantes-la-jolie",            nom: "CGR Mantes-la-Jolie",            adresse: "Zone Commerciale Val Fourré",    ville: "Mantes-la-Jolie",       cp: "78200", lat: 48.9883, lng: 1.7166 },
  { id: "w9202", slug: "cgr-nanterre-coeur-universite",  nom: "CGR Nanterre Cœur Université",  adresse: "1 Pl de la Boule",               ville: "Nanterre",              cp: "92000", lat: 48.8990, lng: 2.2074 },
  { id: "w7519", slug: "cgr-paris-lilas",                nom: "CGR Paris Les Lilas",            adresse: "25 Av du Général Leclerc",       ville: "Les Lilas",             cp: "93260", lat: 48.8787, lng: 2.4180 },
  { id: "p9520", slug: "cgr-sarcelles-my-place",         nom: "CGR Sarcelles My Place",         adresse: "Centre Commercial My Place",     ville: "Sarcelles",             cp: "95200", lat: 48.9966, lng: 2.3812 },
  { id: "b9114", slug: "cgr-torcy-marne-la-vallee",      nom: "CGR Torcy Marne-la-Vallée",     adresse: "Rue du Marché",                  ville: "Torcy",                 cp: "77200", lat: 48.8484, lng: 2.6508 },

  // ── Normandie ──
  { id: "p5823", slug: "cgr-cherbourg",                  nom: "CGR Cherbourg",                  adresse: "26 Rue du Val de Saire",         ville: "Cherbourg-en-Cotentin", cp: "50100", lat: 49.6337, lng: -1.6178 },
  { id: "p0221", slug: "cgr-cherbourg-odeon",            nom: "CGR Cherbourg Odéon",            adresse: "4 Rue de la Paix",               ville: "Cherbourg-en-Cotentin", cp: "50100", lat: 49.6336, lng: -1.6178 },

  // ── Nouvelle-Aquitaine ──
  { id: "p0867", slug: "cgr-agen",                       nom: "CGR Agen",                       adresse: "1 Bd Sylvain Dumon",             ville: "Agen",                  cp: "47000", lat: 44.2006, lng: 0.6202 },
  { id: "p0619", slug: "cgr-angouleme",                  nom: "CGR Angoulême",                  adresse: "4 Rue de Saintes",               ville: "Angoulême",             cp: "16000", lat: 45.6487, lng: 0.1559 },
  { id: "p0252", slug: "cgr-bayonne",                    nom: "CGR Bayonne",                    adresse: "3 Allée de Glain",               ville: "Bayonne",               cp: "64100", lat: 43.4927, lng: -1.4748 },
  { id: "w3300", slug: "cgr-bordeaux-le-francais",       nom: "CGR Bordeaux Le Français",       adresse: "Rue du Palais Gallien",          ville: "Bordeaux",              cp: "33000", lat: 44.8437, lng: -0.5790 },
  { id: "p1038", slug: "cgr-brive-la-gaillarde",         nom: "CGR Brive-la-Gaillarde",         adresse: "2 Bd du Maréchal Lyautey",       ville: "Brive-la-Gaillarde",    cp: "19100", lat: 45.1580, lng: 1.5328 },
  { id: "p0736", slug: "cgr-buxerolles-poitiers",        nom: "CGR Buxerolles",                 adresse: "Route de Lavoux",                ville: "Buxerolles",            cp: "86180", lat: 46.5924, lng: 0.3349 },
  { id: "w8624", slug: "cgr-fontaine-le-comte-poitiers", nom: "CGR Fontaine-le-Comte",          adresse: "Zone Commerciale Grand Large",   ville: "Fontaine-le-Comte",     cp: "86240", lat: 46.5390, lng: 0.2957 },
  { id: "p0194", slug: "cgr-la-rochelle-dragon",         nom: "CGR La Rochelle Dragon",         adresse: "6 Pl de Verdun",                 ville: "La Rochelle",           cp: "17000", lat: 46.1603, lng: -1.1511 },
  { id: "p0134", slug: "cgr-la-rochelle-les-minimes",    nom: "CGR La Rochelle Les Minimes",    adresse: "Voie Antioche des Minimes",      ville: "La Rochelle",           cp: "17000", lat: 46.1475, lng: -1.1659 },
  { id: "w6423", slug: "cgr-lescar-pau",                 nom: "CGR Lescar",                     adresse: "Route de Bayonne",               ville: "Lescar",                cp: "64230", lat: 43.3448, lng: -0.4328 },
  { id: "p5869", slug: "cgr-niort",                      nom: "CGR Niort",                      adresse: "2 Rue du 24 Février",            ville: "Niort",                 cp: "79000", lat: 46.3233, lng: -0.4640 },
  { id: "p0198", slug: "cgr-pau-saint-louis",            nom: "CGR Pau Saint-Louis",            adresse: "3 Rue Valéry Meunier",           ville: "Pau",                   cp: "64000", lat: 43.2927, lng: -0.3718 },
  { id: "p0629", slug: "cgr-pau-universite",             nom: "CGR Pau Université",             adresse: "Place Verdun",                   ville: "Pau",                   cp: "64000", lat: 43.3007, lng: -0.3681 },
  { id: "p0096", slug: "cgr-poitiers-castille",          nom: "CGR Poitiers Castille",          adresse: "5 Rue Carnot",                   ville: "Poitiers",              cp: "86000", lat: 46.5780, lng: 0.3404 },
  { id: "p0485", slug: "cgr-perigueux",                  nom: "CGR Périgueux",                  adresse: "4 Rue du Président Wilson",      ville: "Périgueux",             cp: "24000", lat: 45.1845, lng: 0.7213 },
  { id: "p0995", slug: "cgr-tarnos-bayonne",             nom: "CGR Tarnos",                     adresse: "Zone Commerciale Tarnos",        ville: "Tarnos",                cp: "40220", lat: 43.5440, lng: -1.4643 },
  { id: "p0664", slug: "cgr-villenave-dornon-bordeaux",  nom: "CGR Villenave-d'Ornon",          adresse: "Zone Commerciale de Rives d'Arcins", ville: "Villenave-d'Ornon", cp: "33140", lat: 44.7868, lng: -0.5601 },

  // ── Occitanie ──
  { id: "p8100", slug: "cgr-albi-laperouse",             nom: "CGR Albi Lapérouse",             adresse: "Pl Lapérouse",                   ville: "Albi",                  cp: "81000", lat: 43.9282, lng: 2.1478 },
  { id: "w8101", slug: "cgr-albi-les-cordeliers",        nom: "CGR Albi Les Cordeliers",        adresse: "Rue des Cordeliers",             ville: "Albi",                  cp: "81000", lat: 43.9286, lng: 2.1492 },
  { id: "p0692", slug: "cgr-blagnac-toulouse",           nom: "CGR Blagnac",                    adresse: "7 Allée du Parc",                ville: "Blagnac",               cp: "31700", lat: 43.6369, lng: 1.3942 },
  { id: "p0395", slug: "cgr-le-colisee-carcassonne",     nom: "CGR Carcassonne Le Colisée",    adresse: "5 Rue Courtejaire",              ville: "Carcassonne",           cp: "11000", lat: 43.2132, lng: 2.3530 },
  { id: "p5505", slug: "cgr-carcassonne-multiplexe",     nom: "CGR Carcassonne Multiplexe",     adresse: "Rue du Moulin de la Seille",     ville: "Carcassonne",           cp: "11000", lat: 43.2086, lng: 2.3748 },
  { id: "w0216", slug: "cgr-castres-multiplexe",         nom: "CGR Castres Multiplexe",         adresse: "Route de Mazamet",               ville: "Castres",               cp: "81100", lat: 43.5996, lng: 2.2527 },
  { id: "p4956", slug: "cgr-montauban",                  nom: "CGR Montauban",                  adresse: "Zone Commerciale Bessieres",     ville: "Montauban",             cp: "82000", lat: 44.0173, lng: 1.3499 },
  { id: "p0508", slug: "cgr-montauban-le-paris",         nom: "CGR Montauban Le Paris",         adresse: "7 Rue de la République",         ville: "Montauban",             cp: "82000", lat: 44.0199, lng: 1.3543 },
  { id: "p0703", slug: "cgr-lattes",                     nom: "CGR Montpellier Lattes",         adresse: "Zone Commerciale Lattes",        ville: "Lattes",                cp: "34970", lat: 43.5726, lng: 3.8985 },
  { id: "p1093", slug: "cgr-narbonne",                   nom: "CGR Narbonne",                   adresse: "5 Bd Frédéric Mistral",          ville: "Narbonne",              cp: "11100", lat: 43.1872, lng: 3.0040 },
  { id: "p3000", slug: "cgr-nimes",                      nom: "CGR Nîmes",                      adresse: "Rue de l'Espérance",             ville: "Nîmes",                 cp: "30000", lat: 43.8303, lng: 4.3625 },
  { id: "p0761", slug: "cgr-rivesaltes",                 nom: "CGR Rivesaltes",                 adresse: "Zone Commerciale de la Riberette", ville: "Rivesaltes",           cp: "66600", lat: 42.7786, lng: 2.8694 },
  { id: "w1200", slug: "cgr-rodez",                      nom: "CGR Rodez",                      adresse: "Zone Commerciale du Monastère",  ville: "Rodez",                 cp: "12000", lat: 44.3561, lng: 2.5658 },
  { id: "w6500", slug: "cgr-tarbes",                     nom: "CGR Tarbes",                     adresse: "Zone Commerciale Méridienne",    ville: "Tarbes",                cp: "65000", lat: 43.2326, lng: 0.0829 },
  { id: "p8418", slug: "cgr-villeneuve-les-beziers",     nom: "CGR Villeneuve-lès-Béziers",    adresse: "Mas de Mailhan",                 ville: "Villeneuve-lès-Béziers", cp: "34420", lat: 43.3304, lng: 3.2507 },

  // ── Pays de la Loire ──
  { id: "w4930", slug: "cgr-cholet-arcades-rouge",       nom: "CGR Cholet Arcades Rougé",       adresse: "Route de Beaupréau",             ville: "Cholet",                cp: "49300", lat: 47.0590, lng: -0.8878 },
  { id: "p0160", slug: "cgr-le-mans-le-colisee",         nom: "CGR Le Mans Le Colisée",         adresse: "7 Rue de l'Étoile",             ville: "Le Mans",               cp: "72000", lat: 47.9958, lng: 0.1965 },
  { id: "p0743", slug: "cgr-saint-saturnin-le-mans",     nom: "CGR Saint-Saturnin",             adresse: "Zone Commerciale de la Queue du Bois", ville: "Saint-Saturnin",  cp: "72650", lat: 47.9676, lng: 0.2517 },

  // ── Provence-Alpes-Côte d'Azur ──
  { id: "w0681", slug: "cgr-cagnes-sur-mer-promenade-riviera", nom: "CGR Cagnes-sur-Mer Promenade Riviera", adresse: "2 Av de Nice",     ville: "Cagnes-sur-Mer",        cp: "06800", lat: 43.6648, lng: 7.1488 },
  { id: "w8330", slug: "cgr-draguignan-chabran",         nom: "CGR Draguignan Chabran",         adresse: "Chemin de Chabran",              ville: "Draguignan",            cp: "83300", lat: 43.5336, lng: 6.4670 },
  { id: "w1361", slug: "cgr-le-spot-la-ciotat",          nom: "CGR La Ciotat Le Spot",          adresse: "Av Louis Lumière",               ville: "La Ciotat",             cp: "13600", lat: 43.1748, lng: 5.6050 },
  { id: "w4100", slug: "cgr-manosque",                   nom: "CGR Manosque",                   adresse: "Zone Commerciale La Rochette",   ville: "Manosque",              cp: "04100", lat: 43.8283, lng: 5.7874 },
  { id: "w1312", slug: "cgr-vitrolles",                  nom: "CGR Vitrolles",                  adresse: "Centre Commercial Vitrolles",    ville: "Vitrolles",             cp: "13127", lat: 43.4617, lng: 5.2437 },
];

// ── Helpers ───────────────────────────────────────────────

function parseVersion(raw?: string): Version {
  if (!raw) return Version.VF;
  const u = raw.toUpperCase().replace(/[\s\-_]/g, "");
  if (u.includes("VOST") || u.includes("SUBTIT") || u.includes("SOUSTITR")) return Version.VOSTFR;
  if (u === "VO" || u.startsWith("VO") || u === "ORIGINAL" || u.includes("ORIGIN")) return Version.VO;
  return Version.VF;
}

function parseFormat(raw?: string): string {
  if (!raw) return "2D";
  const u = raw.toUpperCase();
  if (u.includes("IMAX"))   return "IMAX";
  if (u.includes("ICE"))    return "ICE";
  if (u.includes("DOLBY"))  return "Dolby Atmos";
  if (u.includes("3D"))     return "3D";
  return "2D";
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// ── Scraper ───────────────────────────────────────────────

export class CgrScraper extends BaseScraper {
  readonly name = "cgr";

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  private async launchBrowser(): Promise<void> {
    if (this.browser) return;
    this.browser  = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
    this.context  = await this.browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "fr-FR",
    });
  }

  private async closeBrowser(): Promise<void> {
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.browser = null;
    this.context = null;
  }

  // ── Extraction JSON-LD (méthode principale) ───────────

  private parseJsonLd(
    html: string,
    today: Date,
    horizon: Date
  ): Array<{ film: Partial<ScrapedFilm>; seances: ScrapedSeance[] }> {
    const $ = cheerio.load(html);
    const filmMap = new Map<string, { film: Partial<ScrapedFilm>; seances: ScrapedSeance[] }>();

    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const raw = JSON.parse($(el).html() ?? "{}") as unknown;
        const items: unknown[] = Array.isArray(raw) ? raw : [raw];
        for (const item of items) {
          if (!item || typeof item !== "object") continue;
          const it = item as Record<string, unknown>;
          if (it["@type"] !== "ScreeningEvent" && it["@type"] !== "Event") continue;
          const movie = (it["workPresented"] ?? it["movie"] ?? it["about"]) as Record<string, unknown> | undefined;
          const titre = (movie?.["name"] ?? it["name"]) as string | undefined;
          if (!titre) continue;
          const startStr = (it["startDate"] ?? it["startsAt"]) as string | undefined;
          if (!startStr) continue;
          const dt = new Date(startStr);
          if (isNaN(dt.getTime()) || dt < today || dt > horizon) continue;

          if (!filmMap.has(titre)) {
            filmMap.set(titre, {
              film: {
                titre,
                affiche:  (movie?.["image"] ?? movie?.["thumbnailUrl"]) as string | undefined,
                synopsis: movie?.["description"] as string | undefined,
              },
              seances: [],
            });
          }
          filmMap.get(titre)!.seances.push({
            dateHeure: dt,
            version:   parseVersion((it["inLanguage"] ?? it["version"]) as string | undefined),
            format:    parseFormat((it["name"] ?? it["technology"]) as string | undefined),
          });
        }
      } catch { /* ignore */ }
    });

    return Array.from(filmMap.values()).filter(r => r.seances.length > 0);
  }

  // ── Extraction DOM CGR-spécifique ─────────────────────

  private parseDom(
    html: string,
    today: Date,
    horizon: Date
  ): Array<{ film: Partial<ScrapedFilm>; seances: ScrapedSeance[] }> {
    const $ = cheerio.load(html);
    const filmMap = new Map<string, { film: Partial<ScrapedFilm>; seances: ScrapedSeance[] }>();

    // CGR affiche les films dans des blocs .film-seance ou similaires
    // On cherche les horaires sous forme de texte heure (HH:MM)
    const dateAttr = $("[data-date]").first().attr("data-date") ?? toDateStr(today);
    const currentDate = new Date(dateAttr);

    // Films + horaires (pattern CGR : titre du film + liste d'horaires)
    $(".film-affiche, .film-item, .seance-film, article[class*='film']").each((_, filmEl) => {
      const titre = $(filmEl).find("h2, h3, .film-titre, [class*='title']").first().text().trim();
      if (!titre) return;

      const affiche = $(filmEl).find("img").first().attr("src") ?? undefined;

      $(filmEl).find(".seance, .horaire, [class*='seance'], [class*='horaire'], [data-heure]").each((_, seanceEl) => {
        const timeText = $(seanceEl).text().trim() || $(seanceEl).attr("data-heure") || "";
        const timeMatch = timeText.match(/(\d{1,2})[h:](\d{2})/);
        if (!timeMatch) return;

        const dt = new Date(currentDate);
        dt.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0, 0);
        if (dt < today || dt > horizon) return;

        const versionRaw = $(seanceEl).attr("data-version") ?? $(seanceEl).find("[class*='version']").text();
        const formatRaw  = $(seanceEl).attr("data-format")  ?? $(seanceEl).find("[class*='format']").text();

        if (!filmMap.has(titre)) {
          filmMap.set(titre, { film: { titre, affiche }, seances: [] });
        }
        filmMap.get(titre)!.seances.push({
          dateHeure: dt,
          version:   parseVersion(versionRaw),
          format:    parseFormat(formatRaw),
        });
      });
    });

    return Array.from(filmMap.values()).filter(r => r.seances.length > 0);
  }

  // ── Playwright : scraping d'une salle ────────────────

  private async scrapeCinema(
    cinema: (typeof CGR_CINEMAS)[number],
    today: Date,
    horizon: Date
  ): Promise<Array<{ film: Partial<ScrapedFilm>; seances: ScrapedSeance[] }>> {
    if (!this.context) return [];
    const page = await this.context.newPage();

    try {
      // Bloquer ressources lourdes
      await page.route("**/*", route => {
        const t = route.request().resourceType();
        if (["font", "media", "image", "stylesheet"].includes(t)) route.abort().catch(() => {});
        else route.continue().catch(() => {});
      });

      const baseUrl = `${BASE_URL}/horaire-film/${cinema.id}-${cinema.slug}/`;
      const allHtml: string[] = [];

      for (let day = 0; day < DAYS_AHEAD; day++) {
        const date = new Date(today);
        date.setDate(today.getDate() + day);
        const dateStr = toDateStr(date);

        try {
          // CGR accepte ?date= ou une navigation par bouton
          const resp = await page.goto(`${baseUrl}?date=${dateStr}`, {
            waitUntil: "domcontentloaded",
            timeout: 20_000,
          });
          if (!resp || resp.status() >= 400) continue;
          await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {});
          await sleep(300);
          allHtml.push(await page.content());
        } catch { /* next day */ }
      }

      // Fusionner tous les HTMLs et extraire
      const combined = allHtml.join("\n");

      // 1. JSON-LD
      const jsonLd = this.parseJsonLd(combined, today, horizon);
      if (jsonLd.length > 0) return jsonLd;

      // 2. DOM
      const dom = this.parseDom(combined, today, horizon);
      return dom;

    } finally {
      await page.close().catch(() => {});
    }
  }

  // ── Orchestration ─────────────────────────────────────

  async scrape(): Promise<ScraperResult> {
    const result = this.makeResult();

    try {
      await this.launchBrowser();
      this.log(`🎪 ${CGR_CINEMAS.length} cinémas CGR à scraper (fenêtre ${DAYS_AHEAD} jours)`);

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const horizon = new Date(today);
      horizon.setDate(horizon.getDate() + DAYS_AHEAD);

      for (const cinema of CGR_CINEMAS) {
        this.log(`\n▶ ${cinema.nom}`);
        await this.politeDelay();

        try {
          const programme = await this.scrapeCinema(cinema, today, horizon);

          const films: ScrapedCinemaFilm[] = programme
            .filter(p => p.film.titre && p.seances.length > 0)
            .map(p => ({
              film: {
                titre:        p.film.titre!,
                titreOriginal: p.film.titreOriginal,
                synopsis:     p.film.synopsis,
                affiche:      p.film.affiche,
                duree:        p.film.duree,
                genres:       p.film.genres ?? [],
                realisateur:  p.film.realisateur,
                sourceId:     `cgr-${cinema.id}`,
              } as ScrapedFilm,
              seances: p.seances,
            }));

          result.cinemas.push({
            sourceId:   `cgr-${cinema.id}`,
            nom:        cinema.nom,
            adresse:    cinema.adresse,
            ville:      cinema.ville,
            codePostal: cinema.cp,
            latitude:   cinema.lat,
            longitude:  cinema.lng,
            siteWeb:    `${BASE_URL}/cinema/${cinema.id}-${cinema.slug}/`,
            films,
          } as ScrapedCinema);

          const totalSeances = films.reduce((a, f) => a + f.seances.length, 0);
          this.log(`  → ${films.length} films, ${totalSeances} séances`);
        } catch (err) {
          this.addError(result, `Erreur cinéma ${cinema.nom}: ${err}`);
        }
      }
    } finally {
      await this.closeBrowser();
    }

    return result;
  }
}
