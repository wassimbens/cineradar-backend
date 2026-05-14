"use strict";
/**
 * dedup-films.ts
 * ─────────────────────────────────────────────────────────────────
 * Détecte et fusionne les films en doublon dans la base. Un film est
 * considéré comme doublon d'un autre si :
 *   - Ils ont le même tmdbId (ne peut pas arriver vu l'unique constraint)
 *   - OU ils ont le même titre normalisé OU titre original normalisé
 *     ET la même année OU le même réalisateur
 *
 * Stratégie de fusion :
 *   - Garder le film "canonique" (avec tmdbId + le plus de séances)
 *   - Déplacer toutes les relations (séances, avis, films vus, favoris,
 *     watchlist) vers le canonique
 *   - Supprimer le doublon
 *
 * Usage :
 *   npx tsx src/scripts/dedup-films.ts            # dry-run
 *   npx tsx src/scripts/dedup-films.ts --apply    # appliquer
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
const APPLY = process.argv.includes("--apply");
function norm(s) {
    if (!s)
        return "";
    return s
        .toLowerCase()
        .normalize("NFD").replace(/\p{Diacritic}/gu, "")
        .replace(/^(le |la |les |l'|un |une |the |a |an )/i, "")
        .replace(/[^a-z0-9]/g, "")
        .trim();
}
// Choisit le canonique parmi un groupe de doublons
function pickCanonical(group) {
    // Score : tmdbId présent + nb séances + nb avis + nb favoris
    return [...group].sort((a, b) => {
        const aHasTmdb = a.tmdbId ? 1 : 0;
        const bHasTmdb = b.tmdbId ? 1 : 0;
        if (aHasTmdb !== bHasTmdb)
            return bHasTmdb - aHasTmdb;
        if (a._count.seances !== b._count.seances)
            return b._count.seances - a._count.seances;
        return 0;
    })[0];
}
async function mergeFilms(canonicalId, dupId) {
    const counts = { seances: 0, avis: 0, filmsVus: 0, favoris: 0, watchlist: 0 };
    // Séances : déplacer
    const r1 = await prisma.seance.updateMany({
        where: { filmId: dupId },
        data: { filmId: canonicalId },
    });
    counts.seances = r1.count;
    // Avis : éviter les doublons (un user peut avoir un avis sur les 2 versions)
    const dupAvis = await prisma.avis.findMany({ where: { filmId: dupId } });
    for (const a of dupAvis) {
        const existing = await prisma.avis.findFirst({
            where: { userId: a.userId, filmId: canonicalId },
        });
        if (existing) {
            await prisma.avis.delete({ where: { id: a.id } });
        }
        else {
            await prisma.avis.update({
                where: { id: a.id },
                data: { filmId: canonicalId },
            });
        }
        counts.avis++;
    }
    // FilmVu : pareil
    const dupVus = await prisma.filmVu.findMany({ where: { filmId: dupId } });
    for (const v of dupVus) {
        await prisma.filmVu.update({
            where: { id: v.id },
            data: { filmId: canonicalId },
        });
        counts.filmsVus++;
    }
    // Favoris
    const dupFav = await prisma.filmFavori.findMany({ where: { filmId: dupId } });
    for (const f of dupFav) {
        const existing = await prisma.filmFavori.findFirst({
            where: { userId: f.userId, filmId: canonicalId },
        });
        if (existing)
            await prisma.filmFavori.delete({ where: { id: f.id } });
        else
            await prisma.filmFavori.update({ where: { id: f.id }, data: { filmId: canonicalId } });
        counts.favoris++;
    }
    // Watchlist
    const dupW = await prisma.watchlistItem.findMany({ where: { filmId: dupId } });
    for (const w of dupW) {
        const existing = await prisma.watchlistItem.findFirst({
            where: { userId: w.userId, filmId: canonicalId },
        });
        if (existing)
            await prisma.watchlistItem.delete({ where: { id: w.id } });
        else
            await prisma.watchlistItem.update({ where: { id: w.id }, data: { filmId: canonicalId } });
        counts.watchlist++;
    }
    // Alertes liées au film
    await prisma.alerte.updateMany({
        where: { filmId: dupId },
        data: { filmId: canonicalId },
    });
    // Suppression du doublon
    await prisma.film.delete({ where: { id: dupId } });
    return counts;
}
async function main() {
    console.log(`\n🔀 Déduplication des films${APPLY ? "" : " (DRY-RUN — utiliser --apply)"}\n`);
    const films = await prisma.film.findMany({
        select: {
            id: true,
            titre: true,
            titreOriginal: true,
            annee: true,
            realisateur: true,
            tmdbId: true,
            affiche: true,
            _count: { select: { seances: true } },
        },
    });
    console.log(`  ${films.length} films à analyser\n`);
    // Groupement par clé : (titre normalisé OU titreOriginal normalisé) + année
    // ── On NE groupe PAS par réalisateur+année (faux positifs : Bergman 1957, Spielberg 1993, etc.)
    // ── Pour les paires FR↔EN, on fait un 2ème pass via tmdbId (qui pointe vers le même film TMDB)
    const groups = new Map();
    for (const f of films) {
        const keys = new Set();
        if (f.titre)
            keys.add(`t:${norm(f.titre)}|y:${f.annee ?? "?"}`);
        if (f.titreOriginal)
            keys.add(`t:${norm(f.titreOriginal)}|y:${f.annee ?? "?"}`);
        // Croisement : si titre = titreOriginal d'un autre film, ils seront groupés
        if (f.titreOriginal)
            keys.add(`t:${norm(f.titreOriginal)}|y:${f.annee ?? "?"}`);
        for (const k of keys) {
            if (!groups.has(k))
                groups.set(k, []);
            groups.get(k).push(f);
        }
    }
    // ── 2ème mode : films pointant vers le même film TMDB (titre identique année±1)
    //    via une comparaison directe par paire (O(n²) mais n=733 OK)
    for (let i = 0; i < films.length; i++) {
        for (let j = i + 1; j < films.length; j++) {
            const a = films[i];
            const b = films[j];
            if (!a.annee || !b.annee || Math.abs(a.annee - b.annee) > 1)
                continue;
            // Cas 1 : titre normalisé identique
            const ta = norm(a.titre);
            const tb = norm(b.titre);
            const toa = norm(a.titreOriginal ?? "");
            const tob = norm(b.titreOriginal ?? "");
            const sameTitle = (ta && tb && ta === tb) ||
                (ta && tob && ta === tob) ||
                (toa && tb && toa === tb) ||
                (toa && tob && toa === tob);
            if (sameTitle) {
                const key = `pair:${a.id}|${b.id}`;
                groups.set(key, [a, b]);
            }
        }
    }
    // Trouver les groupes de plus de 1 film, et qui se rapportent à du DB
    const seenPairs = new Set();
    const dupePairs = [];
    for (const group of groups.values()) {
        if (group.length < 2)
            continue;
        // Déduplique le groupe (un film peut apparaître via plusieurs clés)
        const uniqGroup = [...new Map(group.map(f => [f.id, f])).values()];
        if (uniqGroup.length < 2)
            continue;
        const canonical = pickCanonical(uniqGroup);
        for (const f of uniqGroup) {
            if (f.id === canonical.id)
                continue;
            const pairKey = [canonical.id, f.id].sort().join("|");
            if (seenPairs.has(pairKey))
                continue;
            seenPairs.add(pairKey);
            dupePairs.push({ canonical, dup: f });
        }
    }
    console.log(`  ${dupePairs.length} paire(s) de doublons détectée(s)\n`);
    // Pour chaque paire, demander confirmation visuelle
    const totals = { merged: 0, seances: 0, avis: 0, filmsVus: 0, favoris: 0, watchlist: 0 };
    for (const { canonical, dup } of dupePairs) {
        // Filtre strict : ne garder QUE les paires dont les titres sont identiques
        // (titre vs titre, titre vs titreOriginal, titreOriginal vs titreOriginal)
        const ta = norm(canonical.titre);
        const tb = norm(dup.titre);
        const toa = norm(canonical.titreOriginal ?? "");
        const tob = norm(dup.titreOriginal ?? "");
        const titreClose = (ta && tb && ta === tb) ||
            (ta && tob && ta === tob) ||
            (toa && tb && toa === tb) ||
            (toa && tob && toa === tob) ||
            (canonical.tmdbId && canonical.tmdbId === dup.tmdbId);
        if (!titreClose)
            continue;
        console.log(`▶ Canonique : "${canonical.titre}" (${canonical.annee ?? "?"}) [tmdb#${canonical.tmdbId ?? "—"}, ${canonical._count.seances} séances]`);
        console.log(`  Doublon  : "${dup.titre}" (${dup.annee ?? "?"}) [tmdb#${dup.tmdbId ?? "—"}, ${dup._count.seances} séances]`);
        if (APPLY) {
            try {
                const c = await mergeFilms(canonical.id, dup.id);
                totals.seances += c.seances;
                totals.avis += c.avis;
                totals.filmsVus += c.filmsVus;
                totals.favoris += c.favoris;
                totals.watchlist += c.watchlist;
                totals.merged++;
                console.log(`  ✓ fusionné : ${c.seances} séances, ${c.avis} avis, ${c.filmsVus} vus`);
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.log(`  ❌ erreur : ${msg.slice(0, 120)}`);
            }
        }
        else {
            totals.merged++;
        }
    }
    console.log("\n" + "─".repeat(60));
    console.log(`🔀 Paires fusionnées : ${totals.merged}`);
    if (APPLY) {
        console.log(`📅 Séances déplacées : ${totals.seances}`);
        console.log(`⭐ Avis déplacés     : ${totals.avis}`);
        console.log(`🎬 Films vus déplacés: ${totals.filmsVus}`);
        console.log(`❤️  Favoris fusionnés : ${totals.favoris}`);
        console.log(`🔖 Watchlist fusionnée : ${totals.watchlist}`);
    }
    const remaining = await prisma.film.count();
    console.log(`\n🎬 Films restants    : ${remaining}\n`);
    await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
//# sourceMappingURL=dedup-films.js.map