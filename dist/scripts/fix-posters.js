"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Script one-shot : corrige les URLs d'affiches cassées dans la base
const prisma_js_1 = require("../lib/prisma.js");
const POSTERS = {
    "Dune : Deuxième Partie": "https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg",
    "Oppenheimer": "https://image.tmdb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg",
    "Past Lives": "https://image.tmdb.org/t/p/w500/pHkKbIRoCe7zIFvqan9LqSo9bEm.jpg",
    "Poor Things": "https://image.tmdb.org/t/p/w500/mCR4F1aIUxSBjxO8C73oWTpY7KU.jpg",
    "Anatomie d'une chute": "https://image.tmdb.org/t/p/w500/tEjJGqEOJBJ2OtTsBKXtFxfJvZF.jpg",
    "The Zone of Interest": "https://image.tmdb.org/t/p/w500/hUu9zyZmKDEKcSMmJrEsRuqwDSd.jpg",
    "Les Trois Mousquetaires : D'Artagnan": "https://image.tmdb.org/t/p/w500/9KShGMjDDdHEDpBx8rWAlKMvJVK.jpg",
    "Killers of the Flower Moon": "https://image.tmdb.org/t/p/w500/dB6Krk806zeqd0YoiGhnfRKAeva.jpg",
    "Mission : Impossible – Dead Reckoning Partie 1": "https://image.tmdb.org/t/p/w500/NNxYkU70HPurnNCSiCjYAmacwm.jpg",
    "La Salle des profs": null,
};
async function main() {
    for (const [titre, affiche] of Object.entries(POSTERS)) {
        const film = await prisma_js_1.prisma.film.findFirst({ where: { titre } });
        if (!film) {
            console.log(`⚠️  Film introuvable : ${titre}`);
            continue;
        }
        // Vérifier que l'URL est accessible avant de la stocker
        let urlValide = false;
        if (affiche) {
            try {
                const res = await fetch(affiche, { method: "HEAD" });
                urlValide = res.ok;
            }
            catch {
                urlValide = false;
            }
        }
        await prisma_js_1.prisma.film.update({
            where: { id: film.id },
            data: { affiche: urlValide ? affiche : null },
        });
        console.log(`${urlValide ? "✅" : "❌ null"} ${titre}`);
    }
    await prisma_js_1.prisma.$disconnect();
}
main().catch(console.error);
//# sourceMappingURL=fix-posters.js.map