"use strict";
/**
 * clean-ugc-duplicates.ts
 * ────────────────────────────────────────────────────────────
 * Supprime les séances UGC dupliquées causées par l'API UGC qui retourne
 * les séances de TOUS les cinémas pour un film donné, pas seulement le cinéma demandé.
 *
 * Symptôme : même film, même salle, mêmes N horaires en rafale (< 10 min d'écart).
 *
 * Stratégie : pour chaque cinéma × film × jour × version,
 *   regrouper les séances trop proches (< 10 min) et n'en garder qu'une.
 *
 * Usage :
 *   npx tsx src/scripts/clean-ugc-duplicates.ts [--dry-run]
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
const MIN_GAP_MS = 10 * 60 * 1000; // 10 minutes
async function main() {
    console.log(`\n🧹  Nettoyage séances UGC dupliquées${DRY_RUN ? " (DRY RUN)" : ""}\n`);
    // Récupère toutes les séances UGC futures, groupées par cinema+film+jour+version
    const seances = await prisma.seance.findMany({
        where: {
            source: "ugc",
            dateHeure: { gte: new Date() },
        },
        select: {
            id: true,
            dateHeure: true,
            version: true,
            filmId: true,
            salle: { select: { cinemaId: true, cinema: { select: { nom: true } } } },
        },
        orderBy: { dateHeure: "asc" },
    });
    console.log(`  ${seances.length} séances UGC futures analysées.\n`);
    const groups = new Map();
    for (const s of seances) {
        const key = [
            s.salle.cinemaId,
            s.filmId,
            s.dateHeure.toISOString().slice(0, 10),
            s.version,
        ].join("|");
        const arr = groups.get(key) ?? [];
        arr.push(s);
        groups.set(key, arr);
    }
    const toDelete = [];
    for (const group of groups.values()) {
        if (group.length < 2)
            continue;
        // Trier par heure
        group.sort((a, b) => a.dateHeure.getTime() - b.dateHeure.getTime());
        let lastKept = group[0].dateHeure.getTime();
        for (let i = 1; i < group.length; i++) {
            const gap = group[i].dateHeure.getTime() - lastKept;
            if (gap < MIN_GAP_MS) {
                // Trop proche → doublon inter-cinéma → supprimer
                toDelete.push(group[i].id);
            }
            else {
                lastKept = group[i].dateHeure.getTime();
            }
        }
    }
    if (toDelete.length === 0) {
        console.log("  ✅ Aucun doublon détecté.\n");
        await prisma.$disconnect();
        return;
    }
    console.log(`  🗑️  ${toDelete.length} séances dupliquées à supprimer.\n`);
    if (!DRY_RUN) {
        // Supprimer par lots de 100
        for (let i = 0; i < toDelete.length; i += 100) {
            const batch = toDelete.slice(i, i + 100);
            // D'abord supprimer les SeanceNotifiee liées
            await prisma.seanceNotifiee.deleteMany({ where: { seanceId: { in: batch } } });
            await prisma.seance.deleteMany({ where: { id: { in: batch } } });
        }
        console.log(`  ✅ ${toDelete.length} séances supprimées.\n`);
    }
    else {
        // Aperçu des films concernés
        const filmIds = [...new Set(seances.filter(s => toDelete.includes(s.id)).map(s => s.filmId))];
        const films = await prisma.film.findMany({
            where: { id: { in: filmIds } },
            select: { id: true, titre: true },
        });
        const filmMap = new Map(films.map(f => [f.id, f.titre]));
        for (const id of toDelete.slice(0, 20)) {
            const s = seances.find(x => x.id === id);
            console.log(`  - "${filmMap.get(s.filmId)}" @ ${s.salle.cinema.nom} — ${s.dateHeure.toISOString().slice(0, 16)} [${s.version}]`);
        }
        if (toDelete.length > 20)
            console.log(`  ... et ${toDelete.length - 20} autres`);
        console.log("\n  (DRY RUN — aucune suppression)\n");
    }
    await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
//# sourceMappingURL=clean-ugc-duplicates.js.map