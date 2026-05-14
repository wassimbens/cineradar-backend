"use strict";
// Récupère la note TMDB (vote_average) pour tous les films qui ont un tmdbId
// et met à jour la colonne tmdbNote en base.
//
// Usage :
//   node node_modules/tsx/dist/cli.mjs src/scripts/populate-tmdb-notes.ts
//
// Prérequis : redémarrer le backend une fois pour que Prisma regénère
//             son client avec la nouvelle colonne tmdbNote.
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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function fetchNote(tmdbId) {
    try {
        const r = await fetch(`${TMDB_BASE}/movie/${tmdbId}?api_key=${TMDB_KEY}&language=fr-FR`, { signal: AbortSignal.timeout(8_000) });
        if (!r.ok)
            return null;
        const d = await r.json();
        // Ignorer les films sans votes significatifs
        return d.vote_count >= 10 ? d.vote_average : null;
    }
    catch {
        return null;
    }
}
async function main() {
    // Récupérer tous les films avec un tmdbId mais sans note
    const films = await prisma.$queryRaw `
    SELECT id, "tmdbId", titre
    FROM "Film"
    WHERE "tmdbId" IS NOT NULL
      AND ("tmdbNote" IS NULL OR "tmdbNote" = 0)
    ORDER BY "tmdbPopularite" DESC
  `;
    console.log(`🎬 ${films.length} films à enrichir avec la note TMDB\n`);
    let updated = 0;
    let skipped = 0;
    for (const [i, film] of films.entries()) {
        const note = await fetchNote(film.tmdbId);
        if (note !== null) {
            await prisma.$executeRaw `
        UPDATE "Film" SET "tmdbNote" = ${note} WHERE id = ${film.id}
      `;
            updated++;
            if (updated % 50 === 0 || i < 5) {
                console.log(`  ✅ [${i + 1}/${films.length}] "${film.titre}" → ${note.toFixed(1)}/10`);
            }
        }
        else {
            skipped++;
        }
        await sleep(200); // ~5 req/s → bien sous la limite TMDB
    }
    console.log(`\n✅ ${updated} films mis à jour, ${skipped} sans note TMDB`);
    await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
//# sourceMappingURL=populate-tmdb-notes.js.map