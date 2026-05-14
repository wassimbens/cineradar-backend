"use strict";
// ─────────────────────────────────────────────────────────
//  Script : vérifie les alertes actives et envoie les emails
//  de notification pour les nouvelles séances correspondantes.
//
//  Logique :
//    1. Charge toutes les alertes actives
//    2. Pour chaque alerte, trouve les films correspondants
//    3. Récupère leurs séances dans les 7 prochains jours
//    4. Filtre par proximité géographique (rayon en km)
//    5. Exclut les séances déjà notifiées
//    6. Envoie l'email + marque les séances comme notifiées
//
//  Usage :
//    npx tsx src/scripts/check-alertes.ts
// ─────────────────────────────────────────────────────────
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
const email_js_1 = require("../lib/email.js");
dotenv.config();
const prisma = new client_1.PrismaClient();
const SITE_URL = process.env["SITE_URL"] ?? "http://localhost:3002";
// ── Géocodage (Nominatim — sans clé API) ─────────────────
const geocodeCache = new Map();
async function geocodeVille(ville) {
    const key = ville.toLowerCase().trim();
    if (geocodeCache.has(key))
        return geocodeCache.get(key) ?? null;
    try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(ville + ", France")}&format=json&limit=1`;
        const res = await fetch(url, {
            headers: { "User-Agent": "CineRadar/1.0 (contact@cineradar.fr)" },
            signal: AbortSignal.timeout(6_000),
        });
        if (!res.ok) {
            geocodeCache.set(key, null);
            return null;
        }
        const data = (await res.json());
        if (!data.length) {
            geocodeCache.set(key, null);
            return null;
        }
        const coords = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
        geocodeCache.set(key, coords);
        return coords;
    }
    catch {
        geocodeCache.set(key, null);
        return null;
    }
}
// ── Distance Haversine (km) ───────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
// ── Formatage date/heure ──────────────────────────────────
function formatDateHeure(d) {
    return d.toLocaleDateString("fr-FR", {
        weekday: "short",
        day: "numeric",
        month: "short",
    }) + " à " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
// ── Traitement d'une alerte ───────────────────────────────
async function processAlerte(alerte) {
    // 1. Géocoder la ville de l'alerte
    const villeCoords = await geocodeVille(alerte.ville);
    // 2. Trouver les films correspondant au titre
    const films = await prisma.film.findMany({
        where: {
            OR: [
                { titre: { contains: alerte.filmTitre, mode: "insensitive" } },
                { titreOriginal: { contains: alerte.filmTitre, mode: "insensitive" } },
                ...(alerte.filmId ? [{ id: alerte.filmId }] : []),
            ],
        },
        select: { id: true, titre: true, affiche: true },
    });
    if (!films.length)
        return { sent: false, newSeances: 0 };
    // 3. Séances dans les 7 prochains jours, pour ces films
    const now = new Date();
    const limit = new Date(now);
    limit.setDate(limit.getDate() + 7);
    // Ids des séances déjà notifiées pour cette alerte
    const dejaNotifiees = await prisma.seanceNotifiee.findMany({
        where: { alerteId: alerte.id },
        select: { seanceId: true },
    });
    const notifieesIds = new Set(dejaNotifiees.map((n) => n.seanceId));
    // 4. Charger les séances avec leur cinéma
    const seancesRaw = await prisma.seance.findMany({
        where: {
            filmId: { in: films.map((f) => f.id) },
            dateHeure: { gte: now, lte: limit },
            id: { notIn: Array.from(notifieesIds) },
        },
        include: {
            salle: {
                include: { cinema: true },
            },
        },
        orderBy: { dateHeure: "asc" },
    });
    if (!seancesRaw.length)
        return { sent: false, newSeances: 0 };
    // 5. Filtrer par proximité
    const seancesFiltrees = seancesRaw.filter((s) => {
        const cinema = s.salle.cinema;
        // Si le cinéma a des coordonnées et qu'on a géocodé la ville → haversine
        if (villeCoords && cinema.latitude && cinema.longitude) {
            const dist = haversineKm(villeCoords.lat, villeCoords.lon, cinema.latitude, cinema.longitude);
            return dist <= alerte.rayon;
        }
        // Sinon : correspondance nom de ville (fallback)
        return cinema.ville.toLowerCase().includes(alerte.ville.toLowerCase()) ||
            alerte.ville.toLowerCase().includes(cinema.ville.toLowerCase());
    });
    if (!seancesFiltrees.length)
        return { sent: false, newSeances: 0 };
    // 6. Grouper par cinéma
    const parCinema = new Map();
    for (const s of seancesFiltrees) {
        const cinema = s.salle.cinema;
        if (!parCinema.has(cinema.id)) {
            parCinema.set(cinema.id, {
                id: cinema.id,
                nom: cinema.nom,
                adresse: cinema.adresse,
                ville: cinema.ville,
                seances: [],
            });
        }
        parCinema.get(cinema.id).seances.push({
            id: s.id,
            dateHeure: s.dateHeure,
            version: s.version,
            format: s.format,
        });
    }
    const cinemasGroupes = Array.from(parCinema.values());
    const film = films[0]; // film principal pour l'email
    // 7. Envoyer l'email de notification
    const { subject, html } = (0, email_js_1.emailNotificationAlerte)({
        filmTitre: film.titre,
        filmAffiche: film.affiche ?? null,
        ville: alerte.ville,
        rayon: alerte.rayon,
        cinemas: cinemasGroupes.map((c) => ({
            nom: c.nom,
            adresse: `${c.adresse}, ${c.ville}`,
            seances: c.seances.map((s) => ({
                dateHeure: formatDateHeure(s.dateHeure),
                version: s.version,
                format: s.format ?? undefined,
            })),
        })),
        alerteId: alerte.id,
        siteUrl: SITE_URL,
    });
    await (0, email_js_1.sendEmail)({ to: alerte.email, subject, html });
    // 8. Marquer les séances comme notifiées
    await prisma.seanceNotifiee.createMany({
        data: seancesFiltrees.map((s) => ({
            alerteId: alerte.id,
            seanceId: s.id,
        })),
        skipDuplicates: true,
    });
    return { sent: true, newSeances: seancesFiltrees.length };
}
// ── Main ──────────────────────────────────────────────────
async function main() {
    console.log("\n🔔 Vérification des alertes…\n");
    const alertes = await prisma.alerte.findMany({
        where: { active: true },
        orderBy: { createdAt: "asc" },
    });
    console.log(`📋 ${alertes.length} alerte(s) active(s)\n`);
    if (!alertes.length) {
        console.log("Aucune alerte à traiter.");
        await prisma.$disconnect();
        return;
    }
    let notified = 0;
    let skipped = 0;
    let errors = 0;
    for (const alerte of alertes) {
        process.stdout.write(`  🎬 "${alerte.filmTitre}" → ${alerte.email} (${alerte.ville}, ${alerte.rayon}km)… `);
        try {
            // Pause entre chaque alerte pour respecter le rate-limit Nominatim (1 req/s)
            await new Promise((r) => setTimeout(r, 1100));
            const { sent, newSeances } = await processAlerte(alerte);
            if (sent) {
                console.log(`✅ Email envoyé (${newSeances} séance(s))`);
                notified++;
            }
            else {
                console.log("⏭️  Aucune nouvelle séance");
                skipped++;
            }
        }
        catch (err) {
            console.log(`💥 ${err}`);
            errors++;
        }
    }
    console.log(`
📊 Résultat :
   ✅  ${notified} email(s) envoyé(s)
   ⏭️  ${skipped} alerte(s) sans nouveauté
   💥  ${errors} erreur(s)
  `);
    await prisma.$disconnect();
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=check-alertes.js.map