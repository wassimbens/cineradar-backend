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
const client_1 = require("@prisma/client");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const prisma = new client_1.PrismaClient();
async function main() {
    const film = await prisma.film.findFirst({
        where: { titre: { contains: "VENGEANCE EST", mode: "insensitive" } },
        select: { id: true, titre: true, annee: true },
    });
    if (!film) {
        console.log("Film not found");
        return;
    }
    console.log(`\nFilm: ${film.titre} (${film.annee})`);
    const seances = await prisma.seance.findMany({
        where: { filmId: film.id, dateHeure: { gte: new Date() } },
        select: {
            dateHeure: true,
            version: true,
            source: true,
            salle: {
                select: {
                    nom: true,
                    cinema: { select: { nom: true, ville: true } },
                },
            },
        },
        orderBy: [
            { salle: { cinema: { nom: "asc" } } },
            { dateHeure: "asc" },
        ],
    });
    console.log(`\n${seances.length} séances futures :\n`);
    const byCinema = new Map();
    for (const s of seances) {
        const key = `${s.salle.cinema.nom} (${s.salle.cinema.ville})`;
        const arr = byCinema.get(key) ?? [];
        arr.push(`${s.dateHeure.toISOString().slice(0, 16)} [${s.version}] via ${s.source}`);
        byCinema.set(key, arr);
    }
    for (const [cinema, dates] of byCinema) {
        console.log(`  ${cinema} (${dates.length} séances):`);
        for (const d of dates)
            console.log(`    - ${d}`);
    }
    await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
//# sourceMappingURL=check-vengeance2.js.map