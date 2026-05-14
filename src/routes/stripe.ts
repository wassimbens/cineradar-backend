// ─────────────────────────────────────────────────────────
//  Routes Stripe — Abonnements Premium CinéRadar
//
//  POST /api/stripe/create-checkout   Crée une session Stripe Checkout
//  POST /api/stripe/webhook           Webhook Stripe (events)
//  GET  /api/stripe/subscription      Statut de l'abonnement actuel
//  POST /api/stripe/portal            Portail client Stripe
// ─────────────────────────────────────────────────────────

import { FastifyPluginAsync } from "fastify";
import Stripe from "stripe";
import { extractUser } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const STRIPE_SECRET        = process.env["STRIPE_SECRET_KEY"];
const STRIPE_WEBHOOK_SECRET = process.env["STRIPE_WEBHOOK_SECRET"];
const STRIPE_PRICE_ID      = process.env["STRIPE_PRICE_ID"];
const SITE_URL             = process.env["SITE_URL"] ?? "http://localhost:3002";

// ── Initialisation Stripe ────────────────────────────────

function getStripe(): Stripe {
  if (!STRIPE_SECRET) throw new Error("STRIPE_SECRET_KEY manquant");
  return new Stripe(STRIPE_SECRET, { apiVersion: "2026-04-22.dahlia" });
}

// ── Helpers ──────────────────────────────────────────────

/**
 * Retourne la fin de période d'abonnement depuis le premier item.
 * Dans Stripe v22, current_period_end est sur subscription.items.data[0].
 */
function getPeriodEnd(sub: Stripe.Subscription): Date | null {
  const firstItem = sub.items?.data?.[0];
  if (firstItem?.current_period_end) {
    return new Date(firstItem.current_period_end * 1000);
  }
  return null;
}

/**
 * Envoie une notification de paiement échoué.
 * Log en console (+ hook pour mailer optionnel).
 */
async function notifyPaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = typeof invoice.customer === "string"
    ? invoice.customer
    : invoice.customer?.id ?? "inconnu";

  const amount = invoice.amount_due != null
    ? `${(invoice.amount_due / 100).toFixed(2)} ${invoice.currency?.toUpperCase() ?? "EUR"}`
    : "montant inconnu";

  console.warn(
    `[Stripe] Paiement échoué — customer=${customerId}, montant=${amount}, invoice=${invoice.id}`
  );

  // Lookup de l'utilisateur pour enrichir le log
  try {
    const user = await prisma.user.findFirst({
      where: { stripeCustomerId: customerId },
      select: { email: true, pseudo: true },
    });
    if (user) {
      console.warn(`[Stripe] Paiement échoué pour ${user.email} (@${user.pseudo ?? "sans pseudo"})`);
      // Si Resend / Nodemailer configuré, envoyer l'email ici :
      // await mailer.send({ to: user.email, subject: "Problème de paiement", ... })
    }
  } catch (err) {
    console.error("[Stripe] Impossible de trouver l'utilisateur pour invoice.payment_failed :", err);
  }
}

// ── Plugin ────────────────────────────────────────────────

const stripeRoutes: FastifyPluginAsync = async (fastify) => {

  // ── rawBody parser pour le webhook Stripe ────────────
  // Doit être enregistré AVANT les autres routes pour capturer
  // le body brut avant tout parsing JSON.
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    function (_req, body, done) {
      done(null, body);
    }
  );


  // ── POST /api/stripe/create-checkout ─────────────────
  fastify.post("/stripe/create-checkout", async (request, reply) => {
    const user = extractUser(request);
    if (!user) return reply.code(401).send({ error: "Non authentifié" });
    if (!STRIPE_PRICE_ID) return reply.code(503).send({ error: "Stripe non configuré" });

    const stripe = getStripe();

    // Récupère l'utilisateur complet depuis la DB pour stripeCustomerId / isPremium
    const dbUser = await prisma.user.findUnique({
      where: { email: user.email },
      select: { id: true, nom: true, pseudo: true, stripeCustomerId: true, isPremium: true },
    });
    if (!dbUser) return reply.code(404).send({ error: "Utilisateur introuvable" });

    if (dbUser.isPremium) {
      return reply.code(400).send({ error: "Vous êtes déjà abonné Premium" });
    }

    // Créer ou récupérer le customer Stripe
    let customerId = dbUser.stripeCustomerId ?? undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: dbUser.nom ?? dbUser.pseudo ?? undefined,
        metadata: { userId: dbUser.id },
      });
      customerId = customer.id;
      await prisma.user.update({
        where: { id: dbUser.id },
        data: { stripeCustomerId: customer.id },
      });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${SITE_URL}/profil?premium=success`,
      cancel_url:  `${SITE_URL}/premium?canceled=1`,
      locale: "fr",
      subscription_data: {
        metadata: { userId: dbUser.id },
      },
    });

    return { url: session.url };
  });


  // ── POST /api/stripe/webhook ──────────────────────────
  // Reçoit les événements Stripe.
  // IMPORTANT : le body est lu en Buffer brut grâce au addContentTypeParser ci-dessus.
  fastify.post("/stripe/webhook", async (request, reply) => {
    if (!STRIPE_WEBHOOK_SECRET) {
      return reply.code(503).send({ error: "Webhook non configuré" });
    }

    const sig = request.headers["stripe-signature"] as string | undefined;
    if (!sig) {
      return reply.code(400).send({ error: "Header stripe-signature manquant" });
    }

    const stripe = getStripe();

    let event: Stripe.Event;
    try {
      // request.body est ici un Buffer grâce au parser addContentTypeParser
      const rawBody = request.body as Buffer;
      event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error("[Stripe] Webhook signature invalide :", err);
      return reply.code(400).send({ error: "Signature invalide" });
    }

    // ── Traitement des événements ──────────────────────
    switch (event.type) {

      // Abonnement créé
      case "customer.subscription.created":
      // Abonnement mis à jour (renouvellement, changement de plan…)
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        const userId = sub.metadata["userId"] ?? null;
        const isActive = sub.status === "active" || sub.status === "trialing";
        const periodEnd = getPeriodEnd(sub);

        await prisma.user.updateMany({
          where: userId
            ? { OR: [{ id: userId }, { stripeCustomerId: customerId }] }
            : { stripeCustomerId: customerId },
          data: {
            isPremium: isActive,
            premiumUntil: isActive ? periodEnd : null,
            stripeSubscriptionId: sub.id,
          },
        });

        console.log(
          `[Stripe] ${event.type} — customerId=${customerId}, userId=${userId ?? "?"}, ` +
          `premium=${isActive}, until=${periodEnd?.toISOString() ?? "null"}`
        );
        break;
      }

      // Abonnement annulé ou expiré
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

        await prisma.user.updateMany({
          where: { stripeCustomerId: customerId },
          data: {
            isPremium: false,
            premiumUntil: null,
            stripeSubscriptionId: null,
          },
        });

        console.log(`[Stripe] customer.subscription.deleted — customerId=${customerId}`);
        break;
      }

      // Paiement échoué
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await notifyPaymentFailed(invoice);
        break;
      }

      default:
        // Événement non géré — ignorer silencieusement
        break;
    }

    return { received: true };
  });


  // ── GET /api/stripe/subscription ─────────────────────
  fastify.get("/stripe/subscription", async (request, reply) => {
    const user = extractUser(request);
    if (!user) return reply.code(401).send({ error: "Non authentifié" });

    const dbUser = await prisma.user.findUnique({
      where: { email: user.email },
      select: { isPremium: true, premiumUntil: true },
    });

    return {
      isPremium:    dbUser?.isPremium    ?? false,
      premiumUntil: dbUser?.premiumUntil ?? null,
    };
  });


  // ── POST /api/stripe/portal ───────────────────────────
  // Redirige vers le portail client Stripe (gérer/annuler l'abonnement).
  fastify.post("/stripe/portal", async (request, reply) => {
    const user = extractUser(request);
    if (!user) return reply.code(401).send({ error: "Non authentifié" });

    const dbUser = await prisma.user.findUnique({
      where: { email: user.email },
      select: { stripeCustomerId: true },
    });
    if (!dbUser?.stripeCustomerId) {
      return reply.code(400).send({ error: "Aucun abonnement actif" });
    }

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: dbUser.stripeCustomerId,
      return_url: `${SITE_URL}/profil`,
    });

    return { url: session.url };
  });

};

export default stripeRoutes;
