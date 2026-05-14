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
    // Lister tous les films avec séances futures
    const films = await prisma.film.findMany({
        where: {
            seances: { some: { dateHeure: { gte: new Date() } } },
        },
        select: {
            id: true,
            titre: true,
            annee: true,
            _count: { select: { seances: { where: { dateHeure: { gte: new Date() } } } } },
        },
        orderBy: { titre: "asc" },
    });
    console.log(`\n${films.length} films avec séances futures :\n`);
    for (const f of films) {
        console.log(`  [${f._count.seances}] ${f.titre} (${f.annee ?? "?"}) — ${f.id}`);
    }
    // Chercher aussi les films avec "vengeance" ou "moi" dans le titre
    const special = films.filter(f => f.titre.toLowerCase().includes("vengeance") ||
        f.titre.toLowerCase().includes("moi"));
    if (special.length) {
        console.log("\n--- Films correspondants ---");
        special.forEach(f => console.log(`  ${f.titre} (${f.annee}) — ${f._count.seances} séances`));
    }
    await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
//# sourceMappingURL=check-vengeance.js.map