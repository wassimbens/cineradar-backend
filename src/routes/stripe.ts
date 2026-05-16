// ─────────────────────────────────────────────────────────
//  Routes Stripe — Checkout, Portal, Webhook
//
//  POST /api/stripe/checkout   Crée une session de paiement
//  POST /api/stripe/portal     Ouvre le Customer Portal
//  POST /api/stripe/webhook    Reçoit les événements Stripe
// ─────────────────────────────────────────────────────────

import { FastifyPluginAsync } from "fastify";
import Stripe from "stripe";
import { prisma } from "../lib/prisma.js";
import { extractUser } from "../middleware/auth.js";

const stripe = new Stripe(process.env["STRIPE_SECRET_KEY"] ?? "");

// Stripe API 2026+ peut retourner un string ISO ou un timestamp Unix
function parsePeriodEnd(raw: unknown): Date {
  if (typeof raw === "number" && raw > 0) return new Date(raw * 1000);
  if (typeof raw === "string") { const d = new Date(raw); if (!isNaN(d.getTime())) return d; }
  // Fallback : +1 mois
  const d = new Date(); d.setMonth(d.getMonth() + 1); return d;
}

const PRICE_MONTHLY  = process.env["STRIPE_PRICE_MONTHLY"]  ?? "";
const PRICE_ANNUAL   = process.env["STRIPE_PRICE_ANNUAL"]   ?? "";
const WEBHOOK_SECRET = process.env["STRIPE_WEBHOOK_SECRET"] ?? "";
const FRONTEND_URL   = process.env["FRONTEND_URL"] ?? "https://cineradar.fr";

// ── Plugin ────────────────────────────────────────────────

const stripeRoutes: FastifyPluginAsync = async (fastify) => {

  // ── POST /api/stripe/checkout ─────────────────────────
  fastify.post<{ Body: { plan: "monthly" | "annual" } }>(
    "/stripe/checkout",
    async (request, reply) => {
      const user = extractUser(request);
      if (!user) return reply.code(401).send({ error: "Non authentifié" });

      const { plan } = request.body ?? {};
      const priceId = plan === "annual" ? PRICE_ANNUAL : PRICE_MONTHLY;
      if (!priceId) return reply.code(500).send({ error: "Prix non configuré" });

      const dbUser = await prisma.user.findUnique({
        where: { id: user.userId },
        select: { id: true, email: true, stripeCustomerId: true, isPremium: true },
      });
      if (!dbUser) return reply.code(404).send({ error: "Utilisateur introuvable" });

      // Déjà abonné → renvoyer vers le portail
      if (dbUser.isPremium && dbUser.stripeCustomerId) {
        const portal = await stripe.billingPortal.sessions.create({
          customer: dbUser.stripeCustomerId,
          return_url: `${FRONTEND_URL}/abonnement`,
        });
        return { url: portal.url };
      }

      // Récupérer ou créer le Stripe Customer
      let customerId = dbUser.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({ email: dbUser.email });
        customerId = customer.id;
        await prisma.user.update({
          where: { id: dbUser.id },
          data: { stripeCustomerId: customerId },
        });
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ["card"],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: "subscription",
        success_url: `${FRONTEND_URL}/abonnement/succes?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:  `${FRONTEND_URL}/abonnement`,
        locale: "fr",
        allow_promotion_codes: true,
        subscription_data: {
          metadata: { userId: dbUser.id },
        },
      });

      return { url: session.url };
    }
  );

  // ── POST /api/stripe/portal ───────────────────────────
  fastify.post("/stripe/portal", async (request, reply) => {
    const user = extractUser(request);
    if (!user) return reply.code(401).send({ error: "Non authentifié" });

    const dbUser = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { stripeCustomerId: true },
    });
    if (!dbUser?.stripeCustomerId) {
      return reply.code(400).send({ error: "Aucun abonnement trouvé" });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: dbUser.stripeCustomerId,
      return_url: `${FRONTEND_URL}/profil`,
    });

    return { url: session.url };
  });

  // ── POST /api/stripe/webhook ──────────────────────────
  // Nécessite le body brut (Buffer) pour vérifier la signature Stripe.
  // On enregistre ce sous-plugin avec son propre content-type parser.
  fastify.register(async (webhookApp) => {
    webhookApp.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_req, body, done) => done(null, body)
    );

    webhookApp.post("/stripe/webhook", async (request, reply) => {
      const sig = request.headers["stripe-signature"];
      if (!sig || !WEBHOOK_SECRET) {
        return reply.code(400).send({ error: "Webhook non configuré" });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let event: { type: string; data: { object: any } };
      try {
        event = stripe.webhooks.constructEvent(
          request.body as Buffer,
          sig as string,
          WEBHOOK_SECRET
        );
      } catch {
        return reply.code(400).send({ error: "Signature invalide" });
      }

      switch (event.type) {

        // ── Paiement réussi ──────────────────────────────
        case "checkout.session.completed": {
          const session = event.data.object;
          if (session.mode !== "subscription") break;

          const customerId     = session.customer as string;
          const subscriptionId = session.subscription as string;

          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          const periodEnd = parsePeriodEnd((subscription as any).current_period_end);

          await prisma.user.updateMany({
            where: { stripeCustomerId: customerId },
            data: {
              isPremium:            true,
              premiumUntil:         periodEnd,
              stripeSubscriptionId: subscriptionId,
            },
          });
          break;
        }

        // ── Renouvellement ou changement de plan ─────────
        case "customer.subscription.updated": {
          const sub = event.data.object;
          const customerId = sub.customer as string;
          const isActive   = sub.status === "active" || sub.status === "trialing";
          const periodEnd  = parsePeriodEnd((sub as any).current_period_end);

          await prisma.user.updateMany({
            where: { stripeCustomerId: customerId },
            data: {
              isPremium:            isActive,
              premiumUntil:         isActive ? periodEnd : null,
              stripeSubscriptionId: sub.id as string,
            },
          });
          break;
        }

        // ── Résiliation ──────────────────────────────────
        case "customer.subscription.deleted": {
          const sub = event.data.object;
          const customerId = sub.customer as string;

          await prisma.user.updateMany({
            where: { stripeCustomerId: customerId },
            data: {
              isPremium:            false,
              premiumUntil:         null,
              stripeSubscriptionId: null,
            },
          });
          break;
        }
      }

      return { received: true };
    });
  });

};

export default stripeRoutes;
