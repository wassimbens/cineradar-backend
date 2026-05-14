"use strict";
/**
 * dedup-cinemas.ts
 * ─────────────────────────────────────────────────────────────────
 * Fusionne les cinémas en double (créés par plusieurs scrapers).
 *
 * Stratégie :
 *  1. Grouper les cinémas par nom normalisé
 *  2. Pour chaque groupe : garder le "canonique" (plus de salles)
 *  3. Déplacer les salles des doublons vers le canonique
 *  4. Supprimer les cinémas vides restants
 *
 * Usage :
 *   npx tsx src/scripts/dedup-cinemas.ts [--dry-run]
 * ─────────────────────────────────────────────────────────────────
 */
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
function normCinema(nom) {
    return nom
        .toLowerCase()
        .normalize("NFD").replace(/\p{Diacritic}/gu, "") // retire les accents
        .replace(/[''']/g, " ") // apostrophes
        .replace(/[^a-z0-9]/g, "") // retire tout sauf alphanum
        .trim();
}
async function main() {
    console.log(`\n🏛️  Déduplication cinémas${DRY_RUN ? " (DRY RUN)" : ""}\n`);
    const cinemas = await prisma.cinema.findMany({
        include: {
            _count: { select: { salles: true } },
        },
        orderBy: { createdAt: "asc" },
    });
    console.log(`  ${cinemas.length} cinémas en base\n`);
    // ── Grouper par nom normalisé ─────────────────────────
    const groups = new Map();
    for (const c of cinemas) {
        const key = normCinema(c.nom);
        if (!groups.has(key))
            groups.set(key, []);
        groups.get(key).push(c);
    }
    const dupeGroups = [...groups.values()].filter(g => g.length > 1);
    console.log(`  ${dupeGroups.length} groupes en doublon\n`);
    let totalMoved = 0;
    let totalDeleted = 0;
    let totalFixed = 0;
    for (const group of dupeGroups) {
        // Canonique = plus de salles ; à égalité, le plus ancien (createdAt asc)
        const canonical = [...group].sort((a, b) => b._count.salles - a._count.salles)[0];
        const duplicates = group.filter(c => c.id !== canonical.id);
        console.log(`▶  "${canonical.nom}" → garde id=${canonical.id} (${canonical._count.salles} salles, ${canonical.ville})`);
        for (const dup of duplicates) {
            console.log(`   Doublon: id=${dup.id} (${dup._count.salles} salles, ${dup.ville})`);
            // Récupérer les salles du doublon
            const sallesDup = await prisma.salle.findMany({
                where: { cinemaId: dup.id },
                include: { _count: { select: { seances: true } } },
            });
            if (sallesDup.length === 0) {
                // Cinéma sans salles → suppression directe
                if (!DRY_RUN) {
                    await prisma.cinemaFavori.deleteMany({ where: { cinemaId: dup.id } });
                    await prisma.cinema.delete({ where: { id: dup.id } });
                }
                console.log(`   → Supprimé (aucune salle)`);
                totalDeleted++;
                continue;
            }
            // Déplacer les salles sous le canonique
            for (const salle of sallesDup) {
                if (!DRY_RUN) {
                    await prisma.salle.update({
                        where: { id: salle.id },
                        data: { cinemaId: canonical.id },
                    });
                }
                console.log(`   → Salle "${salle.nom}" (${salle._count.seances} séances) déplacée vers canonique`);
                totalMoved++;
            }
            // Transférer les cinémas favoris vers le canonique
            if (!DRY_RUN) {
                // Upsert : évite les doublons de favoris
                const favs = await prisma.cinemaFavori.findMany({ where: { cinemaId: dup.id } });
                for (const fav of favs) {
                    await prisma.cinemaFavori.upsert({
                        where: { userId_cinemaId: { userId: fav.userId, cinemaId: canonical.id } },
                        update: {},
                        create: { userId: fav.userId, cinemaId: canonical.id },
                    });
                    await prisma.cinemaFavori.delete({ where: { id: fav.id } });
                }
                await prisma.cinema.delete({ where: { id: dup.id } });
            }
            totalDeleted++;
        }
        // Corriger la ville du canonique si elle semble erronée
        // (ex: "UGC Lyon Bastille" avec ville "Paris" → corriger en "Lyon")
        const nonParisVilles = group
            .map(c => c.ville)
            .filter(v => v && v.toLowerCase() !== "paris" && v.toLowerCase() !== "paris-la-defense");
        if (canonical.ville.toLowerCase() === "paris" && nonParisVilles.length > 0) {
            const correctVille = nonParisVilles[0];
            console.log(`   ⚠️  Ville corrigée: "${canonical.ville}" → "${correctVille}"`);
            if (!DRY_RUN) {
                await prisma.cinema.update({
                    where: { id: canonical.id },
                    data: { ville: correctVille },
                });
            }
            totalFixed++;
        }
    }
    // ── Résumé ────────────────────────────────────────────
    console.log("\n" + "─".repeat(60));
    console.log(`🔀 Salles déplacées    : ${totalMoved}`);
    console.log(`🗑️  Cinémas supprimés  : ${totalDeleted}`);
    console.log(`📍 Villes corrigées    : ${totalFixed}`);
    const remaining = await prisma.cinema.count();
    console.log(`\n🏛️  Cinémas restants   : ${remaining}\n`);
    await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
//# sourceMappingURL=dedup-cinemas.js.map