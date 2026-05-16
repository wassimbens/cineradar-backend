// ─────────────────────────────────────────────────────────
//  Routes Alertes
//
//  POST /api/alertes                    Créer une alerte
//  GET  /api/alertes/:id/unsubscribe    Désabonnement
// ─────────────────────────────────────────────────────────

import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { alertesService } from "../services/alertes.service.js";
import { sendEmail, emailConfirmationAlerte } from "../lib/email.js";

const createAlerteSchema = z.object({
  email:      z.string().email("Email invalide"),
  filmTitre:  z.string().min(1, "Le titre du film est requis").max(200).trim(),
  ville:      z.string().min(1, "La ville est requise").max(100).trim(),
  rayon:      z.number().int().min(1).max(50).default(10),
});

const alertesRoutes: FastifyPluginAsync = async (fastify) => {

  // ── POST /api/alertes ─────────────────────────────────
  /**
   * Crée une alerte email pour un film dans une ville.
   * Envoie un email de confirmation via Resend.
   */
  fastify.post("/alertes", async (request, reply) => {
    const parsed = createAlerteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Données invalides",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { email, filmTitre, ville, rayon } = parsed.data;

    try {
      // Vérifier la limite d'alertes pour les utilisateurs non-Pro
      const { prisma } = await import("../lib/prisma.js");
      const user = await prisma.user.findUnique({
        where: { email },
        select: { isPremium: true, _count: { select: { alertes: { where: { active: true } } } } },
      });
      const MAX_ALERTES_FREE = 3;
      if (user && !user.isPremium && user._count.alertes >= MAX_ALERTES_FREE) {
        return reply.code(403).send({
          error: "Limite atteinte",
          message: `Les comptes gratuits sont limités à ${MAX_ALERTES_FREE} alertes actives. Passez à Pro pour des alertes illimitées.`,
          limitReached: true,
        });
      }

      const { alerte, created } = await alertesService.createAlerte({
        email,
        filmTitre,
        ville,
        rayon,
      });

      // Email de confirmation (seulement si nouvelle alerte)
      if (created) {
        const { subject, html } = emailConfirmationAlerte({
          filmTitre,
          ville,
          rayon,
          email,
          alerteId: alerte.id,
        });

        // On envoie l'email sans bloquer la réponse
        sendEmail({ to: email, subject, html }).catch((err) => {
          console.error("[Email] Erreur envoi confirmation :", err);
        });
      }

      return reply.code(created ? 201 : 200).send({
        success: true,
        created,
        alerteId: alerte.id,
        message: created
          ? "Alerte créée. Un email de confirmation vous a été envoyé."
          : "Vous avez déjà une alerte identique active.",
      });
    } catch (err) {
      console.error("[Alertes] Erreur création :", err);
      return reply.code(500).send({ error: "Erreur interne" });
    }
  });

  // ── GET /api/alertes/:id/unsubscribe ──────────────────
  /**
   * Désactive une alerte (lien de désabonnement depuis l'email).
   * Retourne une page HTML de confirmation.
   */
  fastify.get("/alertes/:id/unsubscribe", async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const alerte = await alertesService.deactivateAlerte(id);

      const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Désabonnement — CinéRadar</title>
  <style>
    body { margin: 0; font-family: sans-serif; background: #f5f5f5;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 12px; padding: 48px 40px; max-width: 440px;
            text-align: center; box-shadow: 0 2px 16px rgba(0,0,0,.08); }
    .icon { font-size: 3rem; margin-bottom: 16px; }
    h1 { margin: 0 0 8px; font-size: 1.4rem; color: #1a1a1a; }
    p  { margin: 0 0 24px; color: #666; font-size: 0.95rem; line-height: 1.6; }
    a  { display: inline-block; padding: 10px 24px; background: #e53e3e; color: #fff;
         font-weight: 700; font-size: 0.875rem; border-radius: 8px; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>Désabonnement confirmé</h1>
    <p>
      Votre alerte pour <strong>${alerte.filmTitre}</strong> à <strong>${alerte.ville}</strong>
      a bien été supprimée. Vous ne recevrez plus de notifications pour ce film.
    </p>
    <a href="${process.env["SITE_URL"] ?? "http://localhost:3002"}">Retour sur CinéRadar</a>
  </div>
</body>
</html>`;

      return reply.code(200).header("Content-Type", "text/html; charset=utf-8").send(html);
    } catch {
      const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Erreur — CinéRadar</title>
  <style>
    body { margin:0; font-family:sans-serif; background:#f5f5f5;
           display:flex; align-items:center; justify-content:center; min-height:100vh; }
    .card { background:#fff; border-radius:12px; padding:48px 40px; max-width:440px;
            text-align:center; box-shadow:0 2px 16px rgba(0,0,0,.08); }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size:3rem;margin-bottom:16px;">❌</div>
    <h1 style="margin:0 0 8px;font-size:1.4rem;color:#1a1a1a;">Lien invalide</h1>
    <p style="color:#666;">Ce lien de désabonnement est invalide ou a déjà été utilisé.</p>
    <a href="${process.env["SITE_URL"] ?? "http://localhost:3002"}"
       style="display:inline-block;margin-top:8px;padding:10px 24px;background:#e53e3e;
              color:#fff;font-weight:700;font-size:0.875rem;border-radius:8px;text-decoration:none;">
      Retour sur CinéRadar
    </a>
  </div>
</body>
</html>`;
      return reply.code(404).header("Content-Type", "text/html; charset=utf-8").send(html);
    }
  });

};

export default alertesRoutes;
