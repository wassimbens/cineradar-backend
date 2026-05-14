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
    const titre = process.argv[2] ?? "Anatomie";
    const film = await prisma.film.findFirst({
        where: { titre: { contains: titre, mode: "insensitive" } },
        select: { id: true, titre: true, annee: true },
    });
    if (!film) {
        console.log("Film non trouvé:", titre);
        return;
    }
    console.log(`\nFilm: "${film.titre}" (${film.annee})`);
    const seances = await prisma.seance.findMany({
        where: { filmId: film.id, dateHeure: { gte: new Date() } },
        select: {
            dateHeure: true, source: true,
            salle: { select: { cinema: { select: { nom: true, ville: true } } } },
        },
        orderBy: { dateHeure: "asc" },
    });
    console.log(`\n${seances.length} séances futures\n`);
    // Par source
    const bySource = {};
    for (const s of seances)
        bySource[s.source] = (bySource[s.source] ?? 0) + 1;
    console.log("Par source:", bySource);
    // Par cinéma
    const byCinema = new Map();
    for (const s of seances) {
        const key = `${s.salle.cinema.nom} (${s.salle.cinema.ville})`;
        const e = byCinema.get(key) ?? { count: 0, dates: new Set() };
        e.count++;
        e.dates.add(s.dateHeure.toISOString().slice(0, 10));
        byCinema.set(key, e);
    }
    console.log("\nPar cinéma:");
    [...byCinema.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .forEach(([c, v]) => console.log(`  ${v.count.toString().padStart(3)} séances  |  ${c}  |  jours: ${[...v.dates].slice(0, 4).join(", ")}${v.dates.size > 4 ? " ..." : ""}`));
    await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
//# sourceMappingURL=diag-film.js.map