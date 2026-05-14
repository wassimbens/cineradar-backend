"use strict";
/**
 * merge-duplicate-films.ts
 * ─────────────────────────────────────────────────────────
 * Fusionne les films en double créés par des différences de
 * casse / accents / ponctuation entre les scrapers.
 *
 * Exemples de doublons :
 *   "SUPER MARIO GALAXY, LE FILM"  ↔  "Super Mario Galaxy Le Film"
 *   "LA VENUS ELECTRIQUE"          ↔  "La Vénus électrique"
 *   "C'EST QUOI L'AMOUR ?"         ↔  "C'est quoi l'amour ?"
 *
 * Stratégie :
 *   1. Charger tous les films
 *   2. Grouper par titre normalisé (lowercase + no accents + no punctuation)
 *   3. Pour chaque groupe avec ≥ 2 films, désigner un canonique :
 *      → préférer celui avec tmdbId, puis le plus de séances, puis le plus ancien
 *   4. Transférer séances, alertes, favoris, watchlist, avis vers le canonique
 *   5. Supprimer les doublons
 *
 * Usage :
 *   node --loader ts-node/esm src/scripts/merge-duplicate-films.ts [--dry-run]
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
// ── Normalisation ─────────────────────────────────────────
function normalizeTitle(title) {
    return title
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
/** Vrai si le titre est entièrement en MAJUSCULES (style AlloCiné). */
const isAllCaps = (s) => s === s.toUpperCase() && /[A-Z]/.test(s);
// ── Main ──────────────────────────────────────────────────
async function main() {
    console.log(`\n🎬  Fusion des films en double${DRY_RUN ? " (DRY RUN)" : ""}\n`);
    // 1. Charger tous les films avec leur nombre de séances
    const films = await prisma.film.findMany({
        select: {
            id: true,
            titre: true,
            annee: true,
            tmdbId: true,
            tmdbNote: true,
            affiche: true,
            createdAt: true,
            _count: { select: { seances: true } },
        },
        orderBy: { createdAt: "asc" },
    });
    console.log(`  ${films.length} films chargés depuis la base.\n`);
    // 2. Grouper par titre normalisé
    const groups = new Map();
    for (const f of films) {
        const key = normalizeTitle(f.titre);
        const arr = groups.get(key) ?? [];
        arr.push(f);
        groups.set(key, arr);
    }
    const duplicateGroups = [...groups.values()].filter(g => g.length > 1);
    console.log(`  ${duplicateGroups.length} groupe(s) de doublons détectés :\n`);
    let totalMerged = 0;
    let totalSeancesMoved = 0;
    for (const group of duplicateGroups) {
        // 3. Choisir le canonique :
        //    priorité 1 : a un tmdbId
        //    priorité 2 : titre en casse normale (pas TOUT EN MAJUSCULES)
        //    priorité 3 : le plus de séances
        //    priorité 4 : le plus ancien (createdAt)
        group.sort((a, b) => {
            if (a.tmdbId && !b.tmdbId)
                return -1;
            if (!a.tmdbId && b.tmdbId)
                return 1;
            // Préférer le titre avec casse normale (pas TOUT EN MAJUSCULES)
            const aCaps = isAllCaps(a.titre) ? 1 : 0;
            const bCaps = isAllCaps(b.titre) ? 1 : 0;
            if (aCaps !== bCaps)
                return aCaps - bCaps;
            if (b._count.seances !== a._count.seances)
                return b._count.seances - a._count.seances;
            return a.createdAt.getTime() - b.createdAt.getTime();
        });
        const canonical = group[0];
        const duplicates = group.slice(1);
        console.log(`  ✦ "${canonical.titre}" (${canonical.id.slice(-6)}) ← canonique`);
        for (const dup of duplicates) {
            console.log(`    └─ "${dup.titre}" (${dup.id.slice(-6)})  ${dup._count.seances} séances`);
        }
        if (DRY_RUN) {
            console.log("");
            continue;
        }
        for (const dup of duplicates) {
            // 4a. Transférer les séances en évitant les conflits (même salle + même heure)
            const existingSeances = await prisma.seance.findMany({
                where: { filmId: canonical.id },
                select: { salleId: true, dateHeure: true },
            });
            const existingKeys = new Set(existingSeances.map(s => `${s.salleId}|${s.dateHeure.getTime()}`));
            const dupSeances = await prisma.seance.findMany({
                where: { filmId: dup.id },
                select: { id: true, salleId: true, dateHeure: true },
            });
            let moved = 0;
            let skipped = 0;
            for (const s of dupSeances) {
                const key = `${s.salleId}|${s.dateHeure.getTime()}`;
                if (existingKeys.has(key)) {
                    // Conflit : supprimer la séance dupliquée
                    await prisma.seanceNotifiee.deleteMany({ where: { seanceId: s.id } });
                    await prisma.seance.delete({ where: { id: s.id } });
                    skipped++;
                }
                else {
                    await prisma.seance.update({
                        where: { id: s.id },
                        data: { filmId: canonical.id },
                    });
                    existingKeys.add(key);
                    moved++;
                }
            }
            totalSeancesMoved += moved;
            console.log(`      séances : ${moved} transférées, ${skipped} doublons supprimés`);
            // 4b. Transférer les alertes
            await prisma.alerte.updateMany({
                where: { filmId: dup.id },
                data: { filmId: canonical.id },
            });
            // 4c. FilmFavoris — gérer la contrainte unique(userId, filmId)
            const dupFavoris = await prisma.filmFavori.findMany({
                where: { filmId: dup.id },
                select: { id: true, userId: true },
            });
            for (const fav of dupFavoris) {
                const conflict = await prisma.filmFavori.findFirst({
                    where: { userId: fav.userId, filmId: canonical.id },
                });
                if (conflict) {
                    await prisma.filmFavori.delete({ where: { id: fav.id } });
                }
                else {
                    await prisma.filmFavori.update({
                        where: { id: fav.id },
                        data: { filmId: canonical.id },
                    });
                }
            }
            // 4d. WatchlistItems — gérer la contrainte unique(userId, filmId)
            const dupWatchlist = await prisma.watchlistItem.findMany({
                where: { filmId: dup.id },
                select: { id: true, userId: true },
            });
            for (const item of dupWatchlist) {
                const conflict = await prisma.watchlistItem.findFirst({
                    where: { userId: item.userId, filmId: canonical.id },
                });
                if (conflict) {
                    await prisma.watchlistItem.delete({ where: { id: item.id } });
                }
                else {
                    await prisma.watchlistItem.update({
                        where: { id: item.id },
                        data: { filmId: canonical.id },
                    });
                }
            }
            // 4e. Avis — gérer la contrainte unique(userId, filmId)
            const dupAvis = await prisma.avis.findMany({
                where: { filmId: dup.id },
                select: { id: true, userId: true },
            });
            for (const avis of dupAvis) {
                const conflict = await prisma.avis.findFirst({
                    where: { userId: avis.userId, filmId: canonical.id },
                });
                if (conflict) {
                    await prisma.avis.delete({ where: { id: avis.id } });
                }
                else {
                    await prisma.avis.update({
                        where: { id: avis.id },
                        data: { filmId: canonical.id },
                    });
                }
            }
            // 5. Enrichir le canonique si le doublon avait de meilleures données
            const isTmdbUrl = (url) => url?.includes("image.tmdb.org") ?? false;
            const dupFull = await prisma.film.findUniqueOrThrow({
                where: { id: dup.id },
                select: {
                    tmdbId: true, affiche: true, synopsis: true, duree: true,
                    genres: true, realisateur: true, tmdbNote: true, tmdbPopularite: true,
                },
            });
            const canFull = await prisma.film.findUniqueOrThrow({
                where: { id: canonical.id },
                select: {
                    tmdbId: true, affiche: true, synopsis: true, duree: true,
                    genres: true, realisateur: true, tmdbNote: true, tmdbPopularite: true,
                },
            });
            const enrichUpdate = {};
            if (!canFull.tmdbId && dupFull.tmdbId)
                enrichUpdate.tmdbId = dupFull.tmdbId;
            if (!isTmdbUrl(canFull.affiche) && isTmdbUrl(dupFull.affiche))
                enrichUpdate.affiche = dupFull.affiche;
            if (!canFull.synopsis && dupFull.synopsis)
                enrichUpdate.synopsis = dupFull.synopsis;
            if (!canFull.duree && dupFull.duree)
                enrichUpdate.duree = dupFull.duree;
            if (canFull.genres.length === 0 && dupFull.genres.length > 0)
                enrichUpdate.genres = dupFull.genres;
            if (!canFull.realisateur && dupFull.realisateur)
                enrichUpdate.realisateur = dupFull.realisateur;
            if (canFull.tmdbNote == null && dupFull.tmdbNote != null)
                enrichUpdate.tmdbNote = dupFull.tmdbNote;
            if (dupFull.tmdbPopularite > canFull.tmdbPopularite)
                enrichUpdate.tmdbPopularite = dupFull.tmdbPopularite;
            // Si le canonique a un titre TOUT EN MAJUSCULES mais le doublon a une casse normale,
            // on met à jour le titre du canonique avec la version lisible
            if (isAllCaps(canonical.titre) && !isAllCaps(dup.titre)) {
                enrichUpdate.titre = dup.titre.trim();
                console.log(`      titre mis à jour : "${canonical.titre}" → "${dup.titre.trim()}"`);
            }
            if (Object.keys(enrichUpdate).length > 0) {
                await prisma.film.update({ where: { id: canonical.id }, data: enrichUpdate });
            }
            // 6. Supprimer le doublon
            await prisma.film.delete({ where: { id: dup.id } });
            totalMerged++;
        }
        console.log("");
    }
    console.log(`\n✅  Terminé.`);
    console.log(`   ${totalMerged} film(s) en double supprimés.`);
    console.log(`   ${totalSeancesMoved} séance(s) transférées vers les canoniques.\n`);
    await prisma.$disconnect();
}
main().catch(e => {
    console.error(e);
    process.exit(1);
});
//# sourceMappingURL=merge-duplicate-films.js.map