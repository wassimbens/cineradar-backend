"use strict";
// ─────────────────────────────────────────────────────────
//  AlertesService — création et gestion des alertes email
// ─────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.alertesService = exports.AlertesService = void 0;
const prisma_js_1 = require("../lib/prisma.js");
class AlertesService {
    /**
     * Crée une alerte en base de données.
     * Si une alerte identique (même email + filmTitre + ville) existe déjà,
     * on la retourne sans doublon.
     */
    async createAlerte(input) {
        const { email, filmTitre, ville, rayon } = input;
        // Chercher un film correspondant au titre (pour lier l'alerte si possible)
        const film = await prisma_js_1.prisma.film.findFirst({
            where: { titre: { contains: filmTitre, mode: "insensitive" } },
        });
        // Vérifier si une alerte identique existe déjà
        const existing = await prisma_js_1.prisma.alerte.findFirst({
            where: {
                email: { equals: email, mode: "insensitive" },
                filmTitre: { equals: filmTitre, mode: "insensitive" },
                ville: { equals: ville, mode: "insensitive" },
                active: true,
            },
        });
        if (existing) {
            return { alerte: existing, created: false };
        }
        const alerte = await prisma_js_1.prisma.alerte.create({
            data: {
                email,
                filmTitre,
                ville,
                rayon,
                ...(film ? { filmId: film.id } : {}),
            },
        });
        return { alerte, created: true };
    }
    /**
     * Désactive une alerte (désabonnement).
     */
    async deactivateAlerte(id) {
        return prisma_js_1.prisma.alerte.update({
            where: { id },
            data: { active: false },
        });
    }
    /**
     * Récupère toutes les alertes actives pour un email.
     */
    async getAlertesByEmail(email) {
        return prisma_js_1.prisma.alerte.findMany({
            where: { email: { equals: email, mode: "insensitive" }, active: true },
            orderBy: { createdAt: "desc" },
        });
    }
}
exports.AlertesService = AlertesService;
exports.alertesService = new AlertesService();
//# sourceMappingURL=alertes.service.js.map