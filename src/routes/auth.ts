// ─────────────────────────────────────────────────────────
//  Routes d'authentification — email + mot de passe
//
//  POST  /api/auth/register              Création de compte → email de confirmation
//  POST  /api/auth/login                 Connexion → JWT
//  POST  /api/auth/logout                Déconnexion
//  GET   /api/auth/me                    Profil du porteur du JWT
//  GET   /api/auth/verify-email?token=   Confirme l'email
//  POST  /api/auth/forgot-password       Envoie un email de reset
//  POST  /api/auth/reset-password        Applique le nouveau mot de passe
//  PATCH /api/auth/set-password          Ajoute/change MDP sur compte existant (legacy)
//  PATCH /api/auth/update-pseudo         Change le pseudo (JWT requis)
// ─────────────────────────────────────────────────────────

import { FastifyPluginAsync } from "fastify";
import rateLimit from "@fastify/rate-limit";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { signToken, extractUser } from "../middleware/auth.js";
import {
  sendEmail,
  emailConfirmationInscription,
  emailResetMotDePasse,
} from "../lib/email.js";

const prisma = new PrismaClient();

const COOKIE_NAME = "cineradar_session";
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env["NODE_ENV"] === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 30, // 30 jours
};

const SITE_URL = process.env["SITE_URL"] ?? "http://localhost:3002";
const PSEUDO_REGEX = /^[a-zA-Z0-9_-]{3,20}$/;

/** Génère un token URL-safe de 32 octets */
function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

const authRoutes: FastifyPluginAsync = async (fastify) => {

  // ── Rate limiting sur les endpoints sensibles ───────────
  // Max 10 tentatives par IP sur 15 min pour les endpoints d'auth
  await fastify.register(rateLimit, {
    max: 10,
    timeWindow: "15 minutes",
    // Uniquement sur les routes auth (register, login, forgot-password, reset-password)
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: () => ({
      error: "Trop de tentatives — réessayez dans 15 minutes",
    }),
    // Appliqué uniquement aux routes de cette liste
    allowList: (req) => {
      const authSensitive = ["/auth/login", "/auth/register", "/auth/forgot-password", "/auth/reset-password"];
      return !authSensitive.some((r) => req.routeOptions?.url?.endsWith(r));
    },
  });

  // ── GET /api/auth/check-pseudo ───────────────────────
  fastify.get<{ Querystring: { pseudo: string } }>(
    "/auth/check-pseudo",
    async (req, reply) => {
      const { pseudo } = req.query;
      if (!pseudo || !PSEUDO_REGEX.test(pseudo)) {
        return reply.send({ available: false, reason: "format" });
      }
      const existing = await prisma.user.findUnique({
        where: { pseudo },
        select: { id: true },
      });
      return reply.send({ available: !existing });
    }
  );

  // ── POST /api/auth/register ───────────────────────────
  fastify.post<{
    Body: { email: string; pseudo: string; password: string; nom?: string };
  }>("/auth/register", async (req, reply) => {
    const { email, pseudo, password, nom } = req.body ?? {};

    if (!email || !pseudo || !password) {
      return reply.status(400).send({ error: "email, pseudo et password requis" });
    }
    if (!PSEUDO_REGEX.test(pseudo)) {
      return reply.status(400).send({
        error: "Pseudo invalide : 3–20 caractères, lettres, chiffres, _ et -",
      });
    }
    if (password.length < 6) {
      return reply.status(400).send({ error: "Le mot de passe doit faire au moins 6 caractères" });
    }

    // Unicité email + pseudo
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { pseudo }] },
    });
    if (existing) {
      if (existing.email === email)   return reply.status(409).send({ error: "Email déjà utilisé" });
      if (existing.pseudo === pseudo) return reply.status(409).send({ error: "Pseudo déjà pris" });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        pseudo,
        nom: nom ?? null,
        emailVerified: false,
        password: { create: { hash } },
      },
    });

    // ── Créer et envoyer le token de confirmation ──────
    const token = generateToken();
    await prisma.emailVerifToken.create({
      data: {
        token,
        userId: user.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
      },
    });

    const verifyUrl = `${SITE_URL}/auth/verify-email?token=${token}`;
    const { subject, html } = emailConfirmationInscription({ nom: user.nom, verifyUrl });

    // Envoi async — ne bloque pas la réponse
    sendEmail({ to: email, subject, html }).catch((err) =>
      fastify.log.warn(`[Auth] Erreur envoi email confirmation : ${err}`)
    );

    const jwt = signToken({ userId: user.id, email: user.email, pseudo: user.pseudo });
    reply.setCookie(COOKIE_NAME, jwt, COOKIE_OPTS);

    return reply.send({
      ok: true,
      token: jwt,
      emailVerified: false,
      user: { id: user.id, email: user.email, pseudo: user.pseudo, nom: user.nom, isPremium: user.isPremium, premiumUntil: user.premiumUntil },
    });
  });

  // ── POST /api/auth/login ──────────────────────────────
  fastify.post<{ Body: { email: string; password: string } }>(
    "/auth/login",
    async (req, reply) => {
      const { email, password } = req.body ?? {};
      if (!email || !password) {
        return reply.status(400).send({ error: "email et password requis" });
      }

      const user = await prisma.user.findUnique({
        where: { email },
        include: { password: true },
      });

      if (!user || !user.password) {
        return reply.status(401).send({ error: "Email ou mot de passe incorrect" });
      }

      const valid = await bcrypt.compare(password, user.password.hash);
      if (!valid) {
        return reply.status(401).send({ error: "Email ou mot de passe incorrect" });
      }

      const token = signToken({ userId: user.id, email: user.email, pseudo: user.pseudo });
      reply.setCookie(COOKIE_NAME, token, COOKIE_OPTS);

      return reply.send({
        ok: true,
        token,
        emailVerified: user.emailVerified,
        user: { id: user.id, email: user.email, pseudo: user.pseudo, nom: user.nom, isPremium: user.isPremium, premiumUntil: user.premiumUntil },
      });
    }
  );

  // ── POST /api/auth/logout ─────────────────────────────
  fastify.post("/auth/logout", async (req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return reply.send({ ok: true });
  });

  // ── GET /api/auth/me ──────────────────────────────────
  fastify.get("/auth/me", async (req, reply) => {
    const payload = extractUser(req);
    if (!payload) return reply.status(401).send({ error: "Non authentifié" });

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true, email: true, pseudo: true, nom: true,
        avatar: true, bio: true, ville: true, isPublic: true,
        emailVerified: true, isPremium: true, premiumUntil: true,
      },
    });
    if (!user) return reply.status(401).send({ error: "Utilisateur introuvable" });
    return reply.send(user);
  });

  // ── GET /api/auth/verify-email?token= ─────────────────
  fastify.get<{ Querystring: { token?: string } }>(
    "/auth/verify-email",
    async (req, reply) => {
      const { token } = req.query;
      if (!token) return reply.status(400).send({ error: "Token manquant" });

      const record = await prisma.emailVerifToken.findUnique({ where: { token } });

      if (!record) return reply.status(400).send({ error: "Token invalide" });
      if (record.usedAt) return reply.status(400).send({ error: "Token déjà utilisé" });
      if (record.expiresAt < new Date()) return reply.status(400).send({ error: "Token expiré" });

      // Marquer comme vérifié
      await prisma.$transaction([
        prisma.user.update({ where: { id: record.userId }, data: { emailVerified: true } }),
        prisma.emailVerifToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      ]);

      // Redirige vers la page de succès frontend
      return reply.redirect(`${SITE_URL}/auth/email-confirme`);
    }
  );

  // ── POST /api/auth/resend-verification ────────────────
  fastify.post("/auth/resend-verification", async (req, reply) => {
    const payload = extractUser(req);
    if (!payload) return reply.status(401).send({ error: "Non authentifié" });

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) return reply.status(404).send({ error: "Utilisateur introuvable" });
    if (user.emailVerified) return reply.send({ ok: true, message: "Email déjà vérifié" });

    // Invalider les anciens tokens non utilisés
    await prisma.emailVerifToken.deleteMany({
      where: { userId: user.id, usedAt: null },
    });

    const token = generateToken();
    await prisma.emailVerifToken.create({
      data: {
        token,
        userId: user.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    const verifyUrl = `${SITE_URL}/auth/verify-email?token=${token}`;
    const { subject, html } = emailConfirmationInscription({ nom: user.nom, verifyUrl });
    await sendEmail({ to: user.email, subject, html });

    return reply.send({ ok: true });
  });

  // ── POST /api/auth/forgot-password ────────────────────
  fastify.post<{ Body: { email: string } }>(
    "/auth/forgot-password",
    async (req, reply) => {
      const { email } = req.body ?? {};
      if (!email) return reply.status(400).send({ error: "email requis" });

      // Toujours répondre OK pour ne pas révéler si l'email existe
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return reply.send({ ok: true });

      // Invalider les anciens tokens
      await prisma.passwordResetToken.deleteMany({
        where: { userId: user.id, usedAt: null },
      });

      const token = generateToken();
      await prisma.passwordResetToken.create({
        data: {
          token,
          userId: user.id,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h
        },
      });

      const resetUrl = `${SITE_URL}/auth/reset-password?token=${token}`;
      const { subject, html } = emailResetMotDePasse({ nom: user.nom, resetUrl });

      sendEmail({ to: email, subject, html }).catch((err) =>
        fastify.log.warn(`[Auth] Erreur envoi email reset : ${err}`)
      );

      return reply.send({ ok: true });
    }
  );

  // ── POST /api/auth/reset-password ─────────────────────
  fastify.post<{ Body: { token: string; password: string } }>(
    "/auth/reset-password",
    async (req, reply) => {
      const { token, password } = req.body ?? {};

      if (!token || !password) {
        return reply.status(400).send({ error: "token et password requis" });
      }
      if (password.length < 6) {
        return reply.status(400).send({ error: "Le mot de passe doit faire au moins 6 caractères" });
      }

      const record = await prisma.passwordResetToken.findUnique({ where: { token } });

      if (!record) return reply.status(400).send({ error: "Token invalide" });
      if (record.usedAt) return reply.status(400).send({ error: "Token déjà utilisé" });
      if (record.expiresAt < new Date()) return reply.status(400).send({ error: "Token expiré — refaites une demande" });

      const hash = await bcrypt.hash(password, 10);

      await prisma.$transaction(async (tx) => {
        // Upsert du mot de passe
        const existing = await tx.password.findUnique({ where: { userId: record.userId } });
        if (existing) {
          await tx.password.update({ where: { userId: record.userId }, data: { hash } });
        } else {
          await tx.password.create({ data: { userId: record.userId, hash } });
        }
        // Marquer le token comme utilisé
        await tx.passwordResetToken.update({
          where: { id: record.id },
          data: { usedAt: new Date() },
        });
      });

      return reply.send({ ok: true, message: "Mot de passe mis à jour" });
    }
  );

  // ── PATCH /api/auth/set-password ──────────────────────
  fastify.patch<{
    Body: { email: string; password: string; pseudo?: string; nom?: string };
  }>("/auth/set-password", async (req, reply) => {
    const { email, password, pseudo, nom } = req.body ?? {};
    if (!email || !password) {
      return reply.status(400).send({ error: "email et password requis" });
    }
    if (password.length < 6) {
      return reply.status(400).send({ error: "Le mot de passe doit faire au moins 6 caractères" });
    }

    let user = await prisma.user.findUnique({
      where: { email },
      include: { password: true },
    });
    if (!user) {
      user = await prisma.user.create({
        data: { email, nom: nom ?? null },
        include: { password: true },
      });
    }

    if (pseudo && !user.pseudo) {
      if (!PSEUDO_REGEX.test(pseudo)) {
        return reply.status(400).send({ error: "Pseudo invalide" });
      }
      const taken = await prisma.user.findFirst({ where: { pseudo, NOT: { id: user.id } } });
      if (taken) return reply.status(409).send({ error: "Pseudo déjà pris" });
      await prisma.user.update({ where: { id: user.id }, data: { pseudo } });
    }

    if (nom) await prisma.user.update({ where: { id: user.id }, data: { nom } });

    const hash = await bcrypt.hash(password, 10);
    if (user.password) {
      await prisma.password.update({ where: { userId: user.id }, data: { hash } });
    } else {
      await prisma.password.create({ data: { userId: user.id, hash } });
    }

    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    const token = signToken({ userId: updated!.id, email: updated!.email, pseudo: updated!.pseudo });
    reply.setCookie(COOKIE_NAME, token, COOKIE_OPTS);

    return reply.send({
      ok: true,
      token,
      user: { id: updated!.id, email: updated!.email, pseudo: updated!.pseudo, nom: updated!.nom },
    });
  });

  // ── PATCH /api/auth/update-pseudo ─────────────────────
  fastify.patch<{ Body: { pseudo: string } }>(
    "/auth/update-pseudo",
    async (req, reply) => {
      const payload = extractUser(req);
      if (!payload) return reply.status(401).send({ error: "Non authentifié" });

      const { pseudo } = req.body ?? {};
      if (!pseudo || !PSEUDO_REGEX.test(pseudo)) {
        return reply.status(400).send({ error: "Pseudo invalide" });
      }

      const taken = await prisma.user.findFirst({
        where: { pseudo, NOT: { id: payload.userId } },
      });
      if (taken) return reply.status(409).send({ error: "Pseudo déjà pris" });

      const user = await prisma.user.update({
        where: { id: payload.userId },
        data: { pseudo },
      });

      const token = signToken({ userId: user.id, email: user.email, pseudo: user.pseudo });
      reply.setCookie(COOKIE_NAME, token, COOKIE_OPTS);
      return reply.send({ ok: true, token, pseudo: user.pseudo });
    }
  );

  // ── PATCH /api/auth/change-password ──────────────────
  // Requiert JWT + mot de passe actuel + nouveau mot de passe
  fastify.patch<{
    Body: { currentPassword: string; newPassword: string };
  }>("/auth/change-password", async (req, reply) => {
    const payload = extractUser(req);
    if (!payload) return reply.status(401).send({ error: "Non authentifié" });

    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || !newPassword) {
      return reply.status(400).send({ error: "currentPassword et newPassword requis" });
    }
    if (newPassword.length < 6) {
      return reply.status(400).send({ error: "Le nouveau mot de passe doit faire au moins 6 caractères" });
    }
    if (currentPassword === newPassword) {
      return reply.status(400).send({ error: "Le nouveau mot de passe doit être différent de l'ancien" });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { password: true },
    });
    if (!user) return reply.status(404).send({ error: "Utilisateur introuvable" });
    if (!user.password) {
      return reply.status(400).send({ error: "Aucun mot de passe défini sur ce compte" });
    }

    const valid = await bcrypt.compare(currentPassword, user.password.hash);
    if (!valid) return reply.status(401).send({ error: "Mot de passe actuel incorrect" });

    const hash = await bcrypt.hash(newPassword, 10);
    await prisma.password.update({ where: { userId: user.id }, data: { hash } });

    return reply.send({ ok: true, message: "Mot de passe mis à jour" });
  });

  // ── PATCH /api/auth/change-email ──────────────────────
  // Requiert JWT + nouveau email + mot de passe pour confirmation
  fastify.patch<{
    Body: { newEmail: string; password: string };
  }>("/auth/change-email", async (req, reply) => {
    const payload = extractUser(req);
    if (!payload) return reply.status(401).send({ error: "Non authentifié" });

    const { newEmail, password } = req.body ?? {};
    if (!newEmail || !password) {
      return reply.status(400).send({ error: "newEmail et password requis" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      return reply.status(400).send({ error: "Adresse email invalide" });
    }

    // Vérifier que le nouvel email n'est pas déjà pris
    const taken = await prisma.user.findUnique({ where: { email: newEmail } });
    if (taken) return reply.status(409).send({ error: "Adresse email déjà utilisée" });

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { password: true },
    });
    if (!user) return reply.status(404).send({ error: "Utilisateur introuvable" });
    if (!user.password) {
      return reply.status(400).send({ error: "Aucun mot de passe défini sur ce compte" });
    }

    const valid = await bcrypt.compare(password, user.password.hash);
    if (!valid) return reply.status(401).send({ error: "Mot de passe incorrect" });

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { email: newEmail, emailVerified: false },
    });

    // Envoyer un email de confirmation au nouvel email
    const token = generateToken();
    await prisma.emailVerifToken.create({
      data: {
        token,
        userId: updated.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    const verifyUrl = `${SITE_URL}/auth/verify-email?token=${token}`;
    const { subject, html } = emailConfirmationInscription({ nom: updated.nom, verifyUrl });
    sendEmail({ to: newEmail, subject, html }).catch(() => {});

    // Nouveau JWT avec le nouvel email
    const newToken = signToken({ userId: updated.id, email: updated.email, pseudo: updated.pseudo });
    reply.setCookie(COOKIE_NAME, newToken, COOKIE_OPTS);

    return reply.send({
      ok: true,
      token: newToken,
      email: updated.email,
      message: "Adresse email mise à jour. Un email de confirmation a été envoyé.",
    });
  });

  // ── DELETE /api/auth/delete-account ───────────────────
  // Supprime définitivement le compte (requiert JWT + mot de passe)
  fastify.delete<{
    Body: { password: string };
  }>("/auth/delete-account", async (req, reply) => {
    const payload = extractUser(req);
    if (!payload) return reply.status(401).send({ error: "Non authentifié" });

    const { password } = req.body ?? {};
    if (!password) return reply.status(400).send({ error: "password requis" });

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { password: true },
    });
    if (!user) return reply.status(404).send({ error: "Utilisateur introuvable" });

    // Si le compte a un mot de passe, le vérifier
    if (user.password) {
      const valid = await bcrypt.compare(password, user.password.hash);
      if (!valid) return reply.status(401).send({ error: "Mot de passe incorrect" });
    }

    // Supprimer le compte (cascade via Prisma)
    await prisma.user.delete({ where: { id: user.id } });

    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return reply.send({ ok: true, message: "Compte supprimé définitivement" });
  });
};

export default authRoutes;
