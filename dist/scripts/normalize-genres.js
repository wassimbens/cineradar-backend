"use strict";
// ─────────────────────────────────────────────────────────
//  Script : normalise tous les genres en base vers des
//  noms canoniques français + déduplique (case-insensitive)
//  les doublons internes (ex: "Animation" + "ANIMATION").
//
//  Usage : npx tsx src/scripts/normalize-genres.ts [--dry-run]
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
const DRY_RUN = process.argv.includes("--dry-run");
// ── Forme canonique française ─────────────────────────────
const CANONICAL = [
    "Action", "Animation", "Aventure", "Biopic",
    "Comédie", "Comédie dramatique", "Comédie musicale", "Comédie romantique",
    "Concert", "Court métrage", "Crime", "Divers",
    "Documentaire", "Drame", "Espionnage", "Famille",
    "Fantastique", "Guerre", "Historique", "Horreur",
    "Judiciaire", "Musique", "Mystère", "Noir", "Opéra",
    "Performance", "Policier", "Romance", "Satire",
    "Science-Fiction", "Sport", "Téléfilm", "Thriller", "Western",
];
const CANONICAL_SET = new Set(CANONICAL);
// ── Mapping permissif : clé NORMALISÉE (lowercase, sans accents) ──
const RAW_MAP = {
    // Anglais standard / capitalized / UPPERCASE
    "action": "Action",
    "adventure": "Aventure",
    "adventures": "Aventure",
    "animation": "Animation",
    "biography": "Biopic",
    "biographie": "Biopic",
    "biopic": "Biopic",
    "comedy": "Comédie",
    "comedydrama": "Comédie dramatique",
    "comedy_drama": "Comédie dramatique",
    "comedy drama": "Comédie dramatique",
    "comedie dramatique": "Comédie dramatique",
    "romcom": "Comédie romantique",
    "romantic comedy": "Comédie romantique",
    "comedie romantique": "Comédie romantique",
    "concert": "Concert",
    "performance": "Performance",
    "court metrage": "Court métrage",
    "court-metrage": "Court métrage",
    "shortfilm": "Court métrage",
    "short": "Court métrage",
    "crime": "Crime",
    "detective": "Policier",
    "policier": "Policier",
    "mystery": "Mystère",
    "mystere": "Mystère",
    "noir": "Noir",
    "filmnoir": "Noir",
    "documentary": "Documentaire",
    "documentaire": "Documentaire",
    "drama": "Drame",
    "drame": "Drame",
    "espionnage": "Espionnage",
    "spy": "Espionnage",
    "family": "Famille",
    "famille": "Famille",
    "fantasy": "Fantastique",
    "fantastique": "Fantastique",
    "war": "Guerre",
    "warmovie": "Guerre",
    "guerre": "Guerre",
    "history": "Historique",
    "histoire": "Historique",
    "historical": "Historique",
    "historical_epic": "Historique",
    "historicalepic": "Historique",
    "historique": "Historique",
    "horror": "Horreur",
    "horreur": "Horreur",
    "epouvante": "Horreur",
    "epouvantehorreur": "Horreur",
    "epouvante horreur": "Horreur",
    "judiciaire": "Judiciaire",
    "courtroom": "Judiciaire",
    "music": "Musique",
    "musique": "Musique",
    "musical": "Comédie musicale",
    "comedie musicale": "Comédie musicale",
    "comedy musical": "Comédie musicale",
    "opera": "Opéra",
    "romance": "Romance",
    "romantic": "Romance",
    "satire": "Satire",
    "scifi": "Science-Fiction",
    "sci-fi": "Science-Fiction",
    "sciencefiction": "Science-Fiction",
    "science fiction": "Science-Fiction",
    "science-fiction": "Science-Fiction",
    "sport": "Sport",
    "sports": "Sport",
    "thriller": "Thriller",
    "tvmovie": "Téléfilm",
    "tv movie": "Téléfilm",
    "telefilm": "Téléfilm",
    "western": "Western",
    "divers": "Divers",
    "comedie": "Comédie",
    // Aliases parfois rencontrés
    "kids": "Famille",
    "children": "Famille",
    "teen": "Famille",
};
// ── Normalise une clé pour lookup (lowercase + sans accents) ──
function normKey(s) {
    return s
        .toLowerCase()
        .normalize("NFD").replace(/\p{Diacritic}/gu, "")
        .replace(/[_\-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
// ── Capitalise un mot inconnu (fallback) ──────────────────
function fallbackCapitalize(raw) {
    const t = raw.trim();
    if (!t)
        return t;
    // Cas "ALL CAPS" → "Capitalize"
    if (t === t.toUpperCase()) {
        return t.charAt(0) + t.slice(1).toLowerCase();
    }
    return t;
}
function canonicalGenre(raw) {
    if (!raw)
        return "";
    if (CANONICAL_SET.has(raw))
        return raw;
    const key = normKey(raw);
    const compactKey = key.replace(/\s/g, "");
    return RAW_MAP[key] ?? RAW_MAP[compactKey] ?? fallbackCapitalize(raw);
}
// ── Déduplication case-insensitive ────────────────────────
function dedupGenres(genres) {
    const seen = new Set();
    const out = [];
    for (const g of genres) {
        const norm = canonicalGenre(g);
        if (!norm)
            continue;
        const key = norm.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(norm);
    }
    const changed = out.length !== genres.length ||
        out.some((g, i) => g !== genres[i]);
    return { result: out, changed };
}
async function main() {
    console.log(`\n🎭  Normalisation des genres${DRY_RUN ? " (DRY RUN)" : ""}\n`);
    const films = await prisma.film.findMany({
        select: { id: true, titre: true, genres: true },
    });
    console.log(`  ${films.length} films à analyser\n`);
    const beforeStats = new Map();
    const afterStats = new Map();
    let updated = 0;
    const examples = [];
    const unknown = new Set();
    for (const film of films) {
        for (const g of film.genres) {
            beforeStats.set(g, (beforeStats.get(g) ?? 0) + 1);
            // Log genres inconnus
            if (!CANONICAL_SET.has(g)) {
                const key = normKey(g);
                if (!RAW_MAP[key] && !RAW_MAP[key.replace(/\s/g, "")]) {
                    unknown.add(g);
                }
            }
        }
        const { result: normalized, changed } = dedupGenres(film.genres);
        for (const g of normalized) {
            afterStats.set(g, (afterStats.get(g) ?? 0) + 1);
        }
        if (changed) {
            if (examples.length < 12) {
                examples.push(`  "${film.titre}" : [${film.genres.join(", ")}] → [${normalized.join(", ")}]`);
            }
            updated++;
            if (!DRY_RUN) {
                await prisma.film.update({
                    where: { id: film.id },
                    data: { genres: normalized },
                });
            }
        }
    }
    console.log("📊 AVANT — top 30 genres :");
    [...beforeStats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)
        .forEach(([g, c]) => console.log(`  ${g.padEnd(35)} ${c}`));
    console.log("\n📊 APRÈS — top 30 genres :");
    [...afterStats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)
        .forEach(([g, c]) => console.log(`  ${g.padEnd(35)} ${c}`));
    if (examples.length > 0) {
        console.log("\n📝 Exemples de changements :");
        examples.forEach(e => console.log(e));
    }
    if (unknown.size > 0) {
        console.log("\n⚠️  Genres NON mappés (à ajouter dans RAW_MAP si récurrents) :");
        [...unknown].forEach(g => console.log(`  - "${g}"`));
    }
    console.log("\n" + "─".repeat(60));
    console.log(`✏️  Films modifiés       : ${updated}/${films.length}`);
    console.log(`🎭  Genres uniques avant : ${beforeStats.size}`);
    console.log(`🎭  Genres uniques après : ${afterStats.size}`);
    await prisma.$disconnect();
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=normalize-genres.js.map