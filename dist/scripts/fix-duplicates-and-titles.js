"use strict";
// ─────────────────────────────────────────────────────────
//  Script : supprime les doublons de films signalés par
//  l'utilisateur et corrige les titres tronqués.
//
//  Pour chaque doublon, on :
//    1. Garde le film avec l'affiche et le plus de données
//    2. Transfère les séances de l'autre vers le gardé
//    3. Supprime les alertes liées au doublon
//    4. Supprime le doublon
//
//  Usage : npx tsx src/scripts/fix-duplicates-and-titles.ts
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
function normalize(s) {
    return s.toLowerCase()
        .replace(/[''‚‛′‵]/g, "'")
        .replace(/[àâ]/g, "a").replace(/[éèêë]/g, "e")
        .replace(/[îï]/g, "i").replace(/[ôö]/g, "o")
        .replace(/[ùûü]/g, "u").replace(/[ç]/g, "c")
        .replace(/æ/g, "ae").replace(/œ/g, "oe")
        .replace(/[^a-z0-9 ]/g, " ")
        .replace(/\s+/g, " ").trim();
}
// ── Groupes de doublons à fusionner ───────────────────────
// Chaque groupe = tous les titres/variantes à rechercher
// Le premier de chaque groupe = titre canonique souhaité (si le keeper n'est pas parfait)
const DUPLICATE_GROUPS = [
    ["c'est quoi l'amour", "c est quoi l amour"],
    ["good luck have fun don't die", "good luck have fun dont die"],
    ["good will hunting"],
    ["huit et demi", "8 1/2", "8½", "otto e mezzo"],
    ["l'enfant du desert", "l enfant du desert"],
    ["nouveaux copains a puffin pock", "nouveaux copains à puffin pock"],
    ["orange mecanique", "orange mécanique", "a clockwork orange"],
];
async function mergeFilms(keepId, deleteId) {
    // Transférer les séances
    const seances = await prisma.seance.findMany({ where: { filmId: deleteId } });
    for (const s of seances) {
        // Vérifier qu'une séance identique n'existe pas déjà sur le film gardé
        const existing = await prisma.seance.findFirst({
            where: {
                filmId: keepId,
                cinemaId: s.cinemaId,
                horaire: s.horaire,
                version: s.version,
                salle: s.salle ?? undefined,
            },
        });
        if (!existing) {
            await prisma.seance.update({
                where: { id: s.id },
                data: { filmId: keepId },
            });
        }
        else {
            await prisma.seance.delete({ where: { id: s.id } });
        }
    }
    // Supprimer les alertes liées au doublon
    await prisma.alerte.deleteMany({ where: { filmId: deleteId } });
    // Supprimer le doublon
    await prisma.film.delete({ where: { id: deleteId } });
    console.log(`    🗑️  Film ${deleteId} supprimé, séances transférées vers ${keepId}`);
}
async function main() {
    // ── 1. Traitement des doublons ─────────────────────────
    console.log("=== TRAITEMENT DES DOUBLONS ===\n");
    const allFilms = await prisma.film.findMany({
        select: { id: true, titre: true, titreOriginal: true, annee: true, affiche: true, tmdbId: true, genres: true },
    });
    for (const group of DUPLICATE_GROUPS) {
        // Trouver tous les films correspondant à un des titres du groupe
        const matches = [];
        for (const film of allFilms) {
            const normTitre = normalize(film.titre);
            const normOrig = film.titreOriginal ? normalize(film.titreOriginal) : "";
            for (const variant of group) {
                const normVariant = normalize(variant);
                if (normTitre === normVariant || normOrig === normVariant) {
                    if (!matches.find(m => m.id === film.id))
                        matches.push(film);
                }
            }
        }
        if (matches.length <= 1) {
            console.log(`  ℹ️  "${group[0]}" : ${matches.length === 0 ? "aucun film trouvé" : "pas de doublon"}`);
            continue;
        }
        console.log(`  🔀 Doublon trouvé : "${group[0]}" (${matches.length} entrées)`);
        for (const m of matches) {
            console.log(`      id=${m.id}  titre="${m.titre}"  tmdbId=${m.tmdbId}  affiche=${m.affiche ? "✓" : "✗"}`);
        }
        // Choisir le keeper : priorité à celui qui a affiche + tmdbId
        let keeper = matches.find(m => m.affiche && m.tmdbId) ?? matches.find(m => m.affiche) ?? matches[0];
        const toDelete = matches.filter(m => m.id !== keeper.id);
        console.log(`      → Gardé : id=${keeper.id} "${keeper.titre}"`);
        for (const dup of toDelete) {
            await mergeFilms(keeper.id, dup.id);
        }
        console.log();
    }
    // ── 2. Correction du titre tronqué "la femme de" ──────
    console.log("=== CORRECTION TITRES TRONQUÉS ===\n");
    const femmeDe = await prisma.film.findFirst({
        where: {
            titre: { contains: "femme de", mode: "insensitive" },
        },
    });
    if (femmeDe) {
        console.log(`  Film trouvé : "${femmeDe.titre}" (id=${femmeDe.id})`);
        if (femmeDe.titre.trim().toLowerCase() === "la femme de") {
            await prisma.film.update({
                where: { id: femmeDe.id },
                data: { titre: "La Femme de ménage" },
            });
            console.log(`  ✅ Titre corrigé : "La Femme de ménage"`);
        }
        else {
            console.log(`  ℹ️  Titre actuel "${femmeDe.titre}" — pas de correction nécessaire`);
        }
    }
    else {
        console.log("  ℹ️  Film 'la femme de ménage' non trouvé.");
    }
    // ── 3. Recherche d'autres titres suspects très courts ──
    const suspectTitles = await prisma.film.findMany({
        where: { titre: { contains: "femme de", mode: "insensitive" } },
        select: { id: true, titre: true, annee: true },
    });
    if (suspectTitles.length > 0) {
        console.log("\n  Films contenant 'femme de' :");
        for (const f of suspectTitles)
            console.log(`    id=${f.id} "${f.titre}" (${f.annee})`);
    }
    console.log("\n✅ Script terminé.");
    await prisma.$disconnect();
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=fix-duplicates-and-titles.js.map