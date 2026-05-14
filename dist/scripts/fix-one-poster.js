"use strict";
// Script de secours : corrige manuellement l'affiche d'un film
// via son tmdbId connu quand la recherche automatique échoue.
//
// Usage : npx tsx src/scripts/fix-one-poster.ts
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
// ── Films à corriger manuellement ────────────────────────
// Ajoutez ici tous les films dont le poster ne se trouve pas automatiquement
const FIXES = [
    {
        titreLike: "Anatomie d",
        tmdbId: "962080",
        affiche: "https://image.tmdb.org/t/p/w500/kQs6keheMwCxJxrzV83VUwFtHkB.jpg",
    },
];
async function main() {
    console.log("🔧 Correction manuelle des affiches…\n");
    for (const fix of FIXES) {
        const films = await prisma.film.findMany({
            where: { titre: { contains: fix.titreLike, mode: "insensitive" } },
        });
        if (films.length === 0) {
            console.log(`❌  Aucun film contenant "${fix.titreLike}"`);
            continue;
        }
        for (const film of films) {
            await prisma.film.update({
                where: { id: film.id },
                data: { tmdbId: fix.tmdbId, affiche: fix.affiche },
            });
            console.log(`✅  "${film.titre}" → affiche mise à jour`);
        }
    }
    await prisma.$disconnect();
    console.log("\nTerminé.");
}
main().catch((e) => { console.error(e); process.exit(1); });
//# sourceMappingURL=fix-one-poster.js.map