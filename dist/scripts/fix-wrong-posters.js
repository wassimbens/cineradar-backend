"use strict";
// ─────────────────────────────────────────────────────────
//  Script : corrige les affiches incorrectes pour une liste
//  ciblée de films.
//
//  Pour chaque film, on cherche sur TMDB avec le titre
//  français puis anglais, on met à jour tmdbId + affiche.
//
//  Usage : npx tsx src/scripts/fix-wrong-posters.ts
// ─────────────────────────────────────────────────────────
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
const client_1 = require("@prisma/client");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const prisma = new client_1.PrismaClient();
const TMDB_KEY = process.env["TMDB_API_KEY"];
const TMDB_BASE = "https://api.themoviedb.org/3";
const POSTER = "https://image.tmdb.org/t/p/w500";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// ── Liste des films à corriger ────────────────────────────
// Format : { titre: "titre en base", tmdbId?: "force id direct", annee?: number, titreOriginal?: "anglais pour recherche" }
// Si tmdbId est fourni, on l'utilise directement sans recherche
const FILMS_TO_FIX = [
    // Films avec tmdbId connu (corrections directes)
    { titre: "Apocalypse Now", tmdbId: "28", annee: 1979 },
    { titre: "Barry Lyndon", tmdbId: "3175", annee: 1975 },
    { titre: "28 jours plus tard", tmdbId: "28032", annee: 2002, titreOriginal: "28 Days Later" },
    { titre: "About Time", tmdbId: "130925", annee: 2013 },
    { titre: "American History X", tmdbId: "35", annee: 1998 },
    { titre: "Amour", tmdbId: "81000", annee: 2012 },
    { titre: "Au revoir les enfants", tmdbId: "9398", annee: 1987 },
    { titre: "Battle Royale", tmdbId: "11778", annee: 2000 },
    { titre: "Black Swan", tmdbId: "45612", annee: 2010 },
    { titre: "Blood Diamond", tmdbId: "1643", annee: 2006 },
    { titre: "Boyhood", tmdbId: "209544", annee: 2014 },
    { titre: "Brokeback Mountain", tmdbId: "73", annee: 2005 },
    { titre: "Call Me by Your Name", tmdbId: "418072", annee: 2017 },
    { titre: "Carrie", tmdbId: "10929", annee: 1976, titreOriginal: "Carrie" },
    { titre: "Chicago", tmdbId: "1574", annee: 2002 },
    { titre: "Chinatown", tmdbId: "1300", annee: 1974 },
    { titre: "Drive", tmdbId: "57012", annee: 2011 },
    { titre: "Easy Rider", tmdbId: "3986", annee: 1969 },
    { titre: "Ghost in the Shell", tmdbId: "45634", annee: 1995, titreOriginal: "Ghost in the Shell" },
    { titre: "Goldfinger", tmdbId: "681", annee: 1964 },
    { titre: "Groundhog Day", tmdbId: "137", annee: 1993, titreOriginal: "Groundhog Day" },
    { titre: "Hacksaw Ridge", tmdbId: "324786", annee: 2016 },
    { titre: "Hero", tmdbId: "4948", annee: 2002, titreOriginal: "Ying xiong" },
    { titre: "Into the Wild", tmdbId: "7326", annee: 2007 },
    { titre: "Intouchables", tmdbId: "77338", annee: 2011 },
    { titre: "Jean de Florette", tmdbId: "4516", annee: 1986 },
    { titre: "Kramer contre Kramer", tmdbId: "9397", annee: 1979, titreOriginal: "Kramer vs. Kramer" },
    { titre: "La Dolce Vita", tmdbId: "2483", annee: 1960 },
    { titre: "La Grande Évasion", tmdbId: "1263", annee: 1963, titreOriginal: "The Great Escape" },
    { titre: "La Grande Illusion", tmdbId: "7546", annee: 1937 },
    { titre: "La Haine", tmdbId: "7560", annee: 1995 },
    { titre: "Manon des Sources", tmdbId: "11399", annee: 1986 },
    { titre: "Memories of Murder", tmdbId: "3172", annee: 2003, titreOriginal: "Salinui chueok" },
    { titre: "Moulin Rouge !", tmdbId: "1606", annee: 2001, titreOriginal: "Moulin Rouge!" },
    { titre: "Nomadland", tmdbId: "614934", annee: 2020 },
    { titre: "Notorious", tmdbId: "40662", annee: 1946 },
    { titre: "Past Lives", tmdbId: "906126", annee: 2023 },
    { titre: "Persona", tmdbId: "11948", annee: 1966 },
    { titre: "Philadelphia", tmdbId: "631", annee: 1993 },
    { titre: "Rain Man", tmdbId: "1930", annee: 1988 },
    { titre: "Rebecca", tmdbId: "5765", annee: 1940 },
    { titre: "Rocketman", tmdbId: "495764", annee: 2019 },
    { titre: "Rosemary's Baby", tmdbId: "1640", annee: 1968, titreOriginal: "Rosemary's Baby" },
    { titre: "Shoplifters", tmdbId: "530254", annee: 2018, titreOriginal: "Manbiki kazoku" },
    { titre: "Solaris", tmdbId: "3078", annee: 1972, titreOriginal: "Solyaris" },
    { titre: "Sound of Metal", tmdbId: "639721", annee: 2020 },
    { titre: "Stalker", tmdbId: "9632", annee: 1979, titreOriginal: "Stalker" },
    { titre: "Taxi Driver", tmdbId: "103", annee: 1976 },
    { titre: "The Artist", tmdbId: "76203", annee: 2011 },
    { titre: "The Florida Project", tmdbId: "437799", annee: 2017 },
    { titre: "The Handmaiden", tmdbId: "393045", annee: 2016, titreOriginal: "Ah-ga-ssi" },
    { titre: "There Will Be Blood", tmdbId: "7345", annee: 2007 },
    { titre: "Traffic", tmdbId: "254", annee: 2000 },
    { titre: "Une Séparation", tmdbId: "72545", annee: 2011, titreOriginal: "Jodaeiye Nader az Simin" },
    { titre: "Vertigo", tmdbId: "4154", annee: 1958 },
    { titre: "Viens et Vois", tmdbId: "11413", annee: 1985, titreOriginal: "Idi i smotri" },
    { titre: "West Side Story", tmdbId: "803603", annee: 2021 },
    { titre: "Zodiac", tmdbId: "508", annee: 2007 },
    { titre: "Drive My Car", tmdbId: "766507", annee: 2021, titreOriginal: "Doraibu mai kâ" },
    { titre: "Burning", tmdbId: "520488", annee: 2018, titreOriginal: "Beoning" },
    // Films à corriger par recherche (pas de tmdbId connu)
    { titre: "8½", annee: 1963, titreOriginal: "8½" },
    { titre: "Huit et demi", annee: 1963, titreOriginal: "8½" },
    { titre: "Adieu ma concubine", annee: 1993, titreOriginal: "Ba wang bie ji" },
    { titre: "Assurance sur la mort", annee: 1944, titreOriginal: "Double Indemnity" },
    { titre: "Breakfast at Tiffany's", annee: 1961, titreOriginal: "Breakfast at Tiffany's" },
    { titre: "Brève Rencontre", annee: 1945, titreOriginal: "Brief Encounter" },
    { titre: "Certains l'aiment chaud", annee: 1959, titreOriginal: "Some Like It Hot" },
    { titre: "Cyrano de Bergerac", annee: 1990 },
    { titre: "Dead Poets Society", annee: 1989, titreOriginal: "Dead Poets Society" },
    { titre: "District 9", annee: 2009, tmdbId: "37799" },
    { titre: "Dr No", annee: 1962, titreOriginal: "Dr. No" },
    { titre: "Du silence et des ombres", annee: 1962, titreOriginal: "To Kill a Mockingbird" },
    { titre: "Épouses et concubines", annee: 1991, titreOriginal: "Da hong deng long gao gao gua" },
    { titre: "Ève", annee: 1950, titreOriginal: "All About Eve" },
    { titre: "Fenêtre sur cour", annee: 1954, titreOriginal: "Rear Window" },
    { titre: "Good Will Hunting", annee: 1997, tmdbId: "546" },
    { titre: "Ikiru", annee: 1952, titreOriginal: "Ikiru" },
    { titre: "Il était une fois dans l'Ouest", annee: 1968, titreOriginal: "C'era una volta il West" },
    { titre: "In the Mood for Love", annee: 2000, titreOriginal: "Fa yeung nin wa" },
    { titre: "Jules et Jim", annee: 1962, tmdbId: "11466" },
    { titre: "L'Appartement", annee: 1996 },
    { titre: "La Vie des autres", annee: 2006, titreOriginal: "Das Leben der Anderen" },
    { titre: "Lady Bird", tmdbId: "434630", annee: 2017 },
    { titre: "Lawrence d'Arabie", annee: 1962, titreOriginal: "Lawrence of Arabia" },
    { titre: "Le Cercle rouge", annee: 1970, tmdbId: "7515" },
    { titre: "Le Dictateur", annee: 1940, titreOriginal: "The Great Dictator" },
    { titre: "Le Dîner de cons", annee: 1998, tmdbId: "11706" },
    { titre: "Le Faucon maltais", annee: 1941, titreOriginal: "The Maltese Falcon" },
    { titre: "Le Labyrinthe de Pan", annee: 2006, titreOriginal: "El laberinto del fauno" },
    { titre: "Le Lauréat", annee: 1967, titreOriginal: "The Graduate" },
    { titre: "Le Samouraï", annee: 1967, tmdbId: "10905" },
    { titre: "Le Troisième Homme", annee: 1949, titreOriginal: "The Third Man" },
    { titre: "Le Voleur de bicyclette", annee: 1948, titreOriginal: "Ladri di biciclette" },
    { titre: "Le Voyage dans la Lune", annee: 1902, titreOriginal: "Le Voyage dans la Lune" },
    { titre: "Les 400 coups", annee: 1959, tmdbId: "996" },
    { titre: "Les Contes de Canterbury", annee: 1972, titreOriginal: "I racconti di Canterbury" },
    { titre: "Les Enfants du paradis", annee: 1945, tmdbId: "11440" },
    { titre: "Les Misérables", annee: 2019, tmdbId: "591017" },
    { titre: "Les Temps modernes", tmdbId: "4944", annee: 1936, titreOriginal: "Modern Times" },
    { titre: "Lettres d'Iwo Jima", annee: 2006, titreOriginal: "Letters from Iwo Jima" },
    { titre: "Lock, Stock and Two Smoking Barrels", annee: 1998, tmdbId: "100" },
    { titre: "Madame Doubtfire", annee: 1993, titreOriginal: "Mrs. Doubtfire" },
    { titre: "Minority Report", annee: 2002, tmdbId: "180" },
    { titre: "Misery", annee: 1990, tmdbId: "975" },
    { titre: "Moon", annee: 2009, tmdbId: "37799" },
    { titre: "Morse", annee: 2008, titreOriginal: "Låt den rätte komma in" },
    { titre: "Moulin Rouge", annee: 2001, titreOriginal: "Moulin Rouge!" },
    { titre: "Network", annee: 1976, tmdbId: "9591" },
    { titre: "Nikita", annee: 1990, tmdbId: "8195" },
    { titre: "No Country for Old Men", annee: 2007, tmdbId: "6479" },
    { titre: "Notting Hill", annee: 1999, tmdbId: "1604" },
    { titre: "Paterson", annee: 2016, tmdbId: "370755" },
    { titre: "Paysans", annee: 2024 },
    { titre: "Pierrot le Fou", annee: 1965, tmdbId: "11540" },
    { titre: "Portrait de la jeune fille en feu", annee: 2019, tmdbId: "601666" },
    { titre: "Ray", annee: 2004, tmdbId: "8729" },
    { titre: "Seul au monde", annee: 2000, titreOriginal: "Cast Away" },
    { titre: "Sideways", annee: 2004, tmdbId: "9675" },
    { titre: "Sur les quais", annee: 1954, titreOriginal: "On the Waterfront" },
    { titre: "TÁR", annee: 2022, tmdbId: "842782" },
    { titre: "Tar", annee: 2022, tmdbId: "842782" },
    { titre: "The Blue Brothers", annee: 1980, titreOriginal: "The Blues Brothers" },
    { titre: "The Favorite", annee: 2018, titreOriginal: "The Favourite" },
    { titre: "The Host", annee: 2006, titreOriginal: "Gwoemul" },
    { titre: "The Lighthouse", annee: 2019, tmdbId: "503919" },
    { titre: "The Power of the Dog", annee: 2021, tmdbId: "748783" },
    { titre: "Three Billboards Outside Ebbing Missouri", annee: 2017, tmdbId: "359940" },
    { titre: "Tigre et Dragon", annee: 2000, titreOriginal: "Wo hu cang long" },
    { titre: "True Grit", annee: 2010, tmdbId: "45325" },
    { titre: "US", annee: 2019, titreOriginal: "Us" },
    { titre: "Vacances romaines", annee: 1953, titreOriginal: "Roman Holiday" },
    { titre: "Vivre sa vie", annee: 1962, tmdbId: "18925" },
    { titre: "Vol au-dessus d'un nid de coucou", annee: 1975, titreOriginal: "One Flew Over the Cuckoo's Nest" },
    { titre: "Walk the Line", annee: 2005, tmdbId: "3081" },
    { titre: "Y a-t-il un pilote dans l'avion ?", annee: 1980, titreOriginal: "Airplane!" },
    { titre: "Y tu mamá también", annee: 2001, tmdbId: "10529" },
    { titre: "Mad Max", annee: 1979, tmdbId: "9659" },
    { titre: "Nausicaä de la Vallée du Vent", annee: 1984, tmdbId: "12494", titreOriginal: "Kaze no tani no Naushika" },
    { titre: "Nausica de la vallee du vent", annee: 1984, tmdbId: "12494" },
    { titre: "La Petite Sirène", annee: 1989, tmdbId: "10144", titreOriginal: "The Little Mermaid" },
    { titre: "Aladdin", annee: 1992, tmdbId: "812" },
    { titre: "Le Bon, la Brute et le Truand", annee: 1966, tmdbId: "1352", titreOriginal: "Il buono, il brutto, il cattivo" },
    { titre: "Midnight Cowboy", annee: 1969, tmdbId: "3116" },
    { titre: "Minority Report", annee: 2002, tmdbId: "180" },
];
// ── Fonctions TMDB ─────────────────────────────────────────
async function fetchTmdbById(tmdbId) {
    try {
        const res = await fetch(`${TMDB_BASE}/movie/${tmdbId}?api_key=${TMDB_KEY}`, {
            signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok)
            return null;
        return await res.json();
    }
    catch {
        return null;
    }
}
async function searchTmdb(query, year) {
    try {
        const params = new URLSearchParams({
            api_key: TMDB_KEY,
            query,
            ...(year ? { year: String(year) } : {}),
        });
        const res = await fetch(`${TMDB_BASE}/search/movie?${params}`, {
            signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok)
            return null;
        const data = await res.json();
        return data.results?.[0] ?? null;
    }
    catch {
        return null;
    }
}
async function findFilmInDb(titre) {
    // Recherche exacte
    let film = await prisma.film.findFirst({
        where: { titre: { equals: titre, mode: "insensitive" } },
        select: { id: true, titre: true, tmdbId: true, affiche: true },
    });
    if (film)
        return film;
    // Recherche partielle
    film = await prisma.film.findFirst({
        where: { titre: { contains: titre.replace(/[^a-zA-ZÀ-ÿ0-9 ]/g, ""), mode: "insensitive" } },
        select: { id: true, titre: true, tmdbId: true, affiche: true },
    });
    return film;
}
// ── Main ──────────────────────────────────────────────────
async function main() {
    if (!TMDB_KEY) {
        console.error("❌ TMDB_API_KEY manquant dans .env");
        process.exit(1);
    }
    console.log("🎬 Correction des affiches incorrectes\n");
    let fixed = 0;
    let notFound = 0;
    let skipped = 0;
    // Dédupliquer par titre (pour éviter les doublons dans la liste)
    const seen = new Set();
    for (const target of FILMS_TO_FIX) {
        const key = target.titre.toLowerCase().trim();
        if (seen.has(key))
            continue;
        seen.add(key);
        const dbFilm = await findFilmInDb(target.titre);
        if (!dbFilm) {
            console.log(`  ⬜ "${target.titre}" — non trouvé en base`);
            notFound++;
            await sleep(150);
            continue;
        }
        let tmdbMovie = null;
        // 1. tmdbId forcé
        if (target.tmdbId) {
            tmdbMovie = await fetchTmdbById(target.tmdbId);
        }
        // 2. Recherche par titre original
        if (!tmdbMovie && target.titreOriginal) {
            tmdbMovie = await searchTmdb(target.titreOriginal, target.annee);
            if (!tmdbMovie && target.annee)
                tmdbMovie = await searchTmdb(target.titreOriginal);
        }
        // 3. Recherche par titre français
        if (!tmdbMovie) {
            tmdbMovie = await searchTmdb(target.titre, target.annee);
            if (!tmdbMovie && target.annee)
                tmdbMovie = await searchTmdb(target.titre);
        }
        if (!tmdbMovie || !tmdbMovie.poster_path) {
            console.log(`  ⚠️  "${dbFilm.titre}" — TMDB introuvable ou pas d'affiche`);
            skipped++;
            await sleep(200);
            continue;
        }
        const newAffiche = `${POSTER}${tmdbMovie.poster_path}`;
        const newTmdbId = String(tmdbMovie.id);
        // Vérifier si déjà à jour
        if (dbFilm.affiche === newAffiche && dbFilm.tmdbId === newTmdbId) {
            console.log(`  ✓  "${dbFilm.titre}" — déjà à jour`);
            await sleep(150);
            continue;
        }
        // Vérifier si tmdbId est déjà pris par un autre film
        const existingWithTmdb = newTmdbId !== dbFilm.tmdbId
            ? await prisma.film.findFirst({ where: { tmdbId: newTmdbId } })
            : null;
        if (existingWithTmdb && existingWithTmdb.id !== dbFilm.id) {
            // tmdbId déjà pris → mettre à jour l'affiche seulement
            await prisma.film.update({
                where: { id: dbFilm.id },
                data: { affiche: newAffiche },
            });
            console.log(`  ✅ "${dbFilm.titre}" → affiche corrigée (tmdbId=${newTmdbId} déjà pris par "${existingWithTmdb.titre}")`);
        }
        else {
            await prisma.film.update({
                where: { id: dbFilm.id },
                data: { affiche: newAffiche, tmdbId: newTmdbId },
            });
            console.log(`  ✅ "${dbFilm.titre}" → TMDB #${newTmdbId}, affiche: ${tmdbMovie.poster_path}`);
        }
        fixed++;
        await sleep(250); // respecter le rate limit TMDB
    }
    console.log(`\n📊 Résumé :`);
    console.log(`   ✅ ${fixed} affiches corrigées`);
    console.log(`   ⚠️  ${skipped} films TMDB introuvable`);
    console.log(`   ⬜ ${notFound} films non trouvés en base`);
    await prisma.$disconnect();
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=fix-wrong-posters.js.map