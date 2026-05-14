"use strict";
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
// Trouve les films sans tmdbId et les corrige via TMDB search
const client_1 = require("@prisma/client");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const prisma = new client_1.PrismaClient();
const TMDB_KEY = process.env["TMDB_API_KEY"];
const TMDB_BASE = "https://api.themoviedb.org/3";
const POSTER = "https://image.tmdb.org/t/p/w500";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function search(query, year) {
    try {
        const p = new URLSearchParams({ api_key: TMDB_KEY, query, ...(year ? { year: String(year) } : {}) });
        const r = await fetch(`${TMDB_BASE}/search/movie?${p}`, { signal: AbortSignal.timeout(8_000) });
        if (!r.ok)
            return null;
        const d = await r.json();
        return d.results?.[0] ?? null;
    }
    catch {
        return null;
    }
}
async function main() {
    const films = await prisma.film.findMany({
        where: { tmdbId: null },
        select: { id: true, titre: true, titreOriginal: true, annee: true },
    });
    console.log(`🔍 ${films.length} films sans tmdbId\n`);
    let fixed = 0;
    for (const film of films) {
        let found = null;
        // Essai 1 : titre original + année
        if (film.titreOriginal)
            found = await search(film.titreOriginal, film.annee ?? undefined);
        await sleep(150);
        // Essai 2 : titre français + année
        if (!found) {
            found = await search(film.titre, film.annee ?? undefined);
            await sleep(150);
        }
        // Essai 3 : sans année
        if (!found && film.titreOriginal) {
            found = await search(film.titreOriginal);
            await sleep(150);
        }
        if (!found) {
            found = await search(film.titre);
            await sleep(150);
        }
        if (!found || !found.poster_path) {
            console.log(`  ⚠️  "${film.titre}" (${film.annee}) — non trouvé`);
            continue;
        }
        // Vérifier conflit tmdbId
        const conflict = await prisma.film.findFirst({ where: { tmdbId: String(found.id) } });
        // Récupérer la note TMDB
        let tmdbNote;
        try {
            const detail = await fetch(`${TMDB_BASE}/movie/${found.id}?api_key=${TMDB_KEY}`, { signal: AbortSignal.timeout(6_000) });
            if (detail.ok) {
                const d = await detail.json();
                if (d.vote_count >= 10)
                    tmdbNote = d.vote_average;
            }
        }
        catch { /**/ }
        if (conflict && conflict.id !== film.id) {
            // Mettre à jour affiche seulement
            await prisma.film.update({
                where: { id: film.id },
                data: { affiche: `${POSTER}${found.poster_path}`, ...(tmdbNote !== undefined ? { tmdbNote } : {}) },
            });
            console.log(`  ✅ "${film.titre}" → affiche seulement (tmdbId=${found.id} pris par "${conflict.titre}")`);
        }
        else {
            await prisma.film.update({
                where: { id: film.id },
                data: {
                    tmdbId: String(found.id),
                    affiche: `${POSTER}${found.poster_path}`,
                    ...(tmdbNote !== undefined ? { tmdbNote } : {}),
                },
            });
            console.log(`  ✅ "${film.titre}" → TMDB #${found.id}${tmdbNote !== undefined ? ` (${tmdbNote.toFixed(1)}/10)` : ""}`);
        }
        fixed++;
        await sleep(250);
    }
    console.log(`\n✅ ${fixed}/${films.length} films corrigés`);
    await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
//# sourceMappingURL=fix-missing-tmdbids.js.map