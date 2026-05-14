"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    // Séances dans les 7 prochains jours
    const now = new Date();
    const in7 = new Date(now);
    in7.setDate(in7.getDate() + 7);
    const films = await prisma.film.findMany({
        where: { seances: { some: { dateHeure: { gte: now, lte: in7 } } } },
        include: { _count: { select: { seances: { where: { dateHeure: { gte: now, lte: in7 } } } } } },
    });
    films.sort((a, b) => b._count.seances - a._count.seances);
    console.log(`Films avec séances dans 7 jours: ${films.length}`);
    films.forEach((f) => console.log(`  [${f._count.seances}] ${f.titre} (${f.annee}) tmdb=${f.tmdbId}`));
    await prisma.$disconnect();
}
main().catch((err) => { console.error(err); process.exit(1); });
//# sourceMappingURL=check-films.js.map