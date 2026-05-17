// ─────────────────────────────────────────────────────────
//  Routes Messages
//
//  GET    /api/messages                          Conversations
//  GET    /api/messages/unread-count             Nb non lus
//  GET    /api/messages/:pseudo                  Thread complet
//  POST   /api/messages/:pseudo                  Envoyer un message (+ filmId optionnel)
//  DELETE /api/messages/:messageId               Suppression (soft delete)
//  PATCH  /api/messages/:messageId               Modifier un message
//  POST   /api/messages/:pseudo/pin/:messageId   Épingler / désépingler
//  POST   /api/messages/react/:messageId         Toggler une réaction
// ─────────────────────────────────────────────────────────

import { FastifyPluginAsync } from "fastify";
import { PrismaClient } from "@prisma/client";
import { extractUser } from "../middleware/auth.js";

const prisma = new PrismaClient();

function groupReactions(reactions: { emoji: string; userId: string }[], myId: string) {
  const map = new Map<string, { emoji: string; count: number; mine: boolean }>();
  for (const r of reactions) {
    const entry = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
    entry.count++;
    if (r.userId === myId) entry.mine = true;
    map.set(r.emoji, entry);
  }
  return [...map.values()];
}

const FILM_SELECT = {
  id: true,
  titre: true,
  affiche: true,
  annee: true,
  imdbNote: true,
  tmdbNote: true,
  genres: true,
} as const;

const messagesRoutes: FastifyPluginAsync = async (fastify) => {

  // ── GET /api/messages/unread-count ───────────────────
  fastify.get("/messages/unread-count", async (req, reply) => {
    const me = extractUser(req);
    if (!me) return reply.status(401).send({ error: "Non authentifié" });
    const count = await prisma.message.count({
      where: { receiverId: me.userId, lu: false, deleted: false },
    });
    return { count };
  });

  // ── GET /api/messages ────────────────────────────────
  fastify.get("/messages", async (req, reply) => {
    const me = extractUser(req);
    if (!me) return reply.status(401).send({ error: "Non authentifié" });

    const messages = await prisma.message.findMany({
      where: { OR: [{ senderId: me.userId }, { receiverId: me.userId }] },
      orderBy: { createdAt: "desc" },
      include: {
        sender:   { select: { id: true, pseudo: true, nom: true, avatar: true } },
        receiver: { select: { id: true, pseudo: true, nom: true, avatar: true } },
      },
    });

    const byPartner = new Map<string, typeof messages[number]>();
    for (const msg of messages) {
      const partnerId = msg.senderId === me.userId ? msg.receiverId : msg.senderId;
      if (!byPartner.has(partnerId)) byPartner.set(partnerId, msg);
    }

    const unreadByPartner = await prisma.message.groupBy({
      by: ["senderId"],
      where: { receiverId: me.userId, lu: false, deleted: false },
      _count: { id: true },
    });
    const unreadMap = new Map(unreadByPartner.map(r => [r.senderId, r._count.id]));

    const conversations = [...byPartner.values()].map(msg => {
      const partner = msg.senderId === me.userId ? msg.receiver : msg.sender;
      const displayContent = msg.deleted ? "Message supprimé" : msg.content;
      return {
        partner,
        lastMessage: { content: displayContent, createdAt: msg.createdAt, fromMe: msg.senderId === me.userId },
        unreadCount: unreadMap.get(partner.id) ?? 0,
      };
    });

    return reply.send(conversations);
  });

  // ── GET /api/messages/:pseudo ────────────────────────
  fastify.get<{ Params: { pseudo: string } }>("/messages/:pseudo", async (req, reply) => {
    const me = extractUser(req);
    if (!me) return reply.status(401).send({ error: "Non authentifié" });

    const partner = await prisma.user.findUnique({
      where: { pseudo: req.params.pseudo },
      select: { id: true, pseudo: true, nom: true, avatar: true },
    });
    if (!partner) return reply.status(404).send({ error: "Utilisateur introuvable" });

    await prisma.message.updateMany({
      where: { senderId: partner.id, receiverId: me.userId, lu: false },
      data: { lu: true },
    });

    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { senderId: me.userId, receiverId: partner.id },
          { senderId: partner.id, receiverId: me.userId },
        ],
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        content: true,
        senderId: true,
        lu: true,
        edited: true,
        editedAt: true,
        deleted: true,
        pinned: true,
        createdAt: true,
        replyToId: true,
        replyTo: { select: { id: true, content: true, senderId: true, deleted: true } },
        film: { select: FILM_SELECT },
        reactions: { select: { emoji: true, userId: true } },
      },
    });

    const formatted = messages.map(msg => ({
      id: msg.id,
      content: msg.deleted ? "Message supprimé" : msg.content,
      senderId: msg.senderId,
      lu: msg.lu,
      edited: msg.edited,
      editedAt: msg.editedAt,
      deleted: msg.deleted,
      pinned: msg.pinned,
      createdAt: msg.createdAt,
      replyTo: msg.replyTo
        ? {
            id: msg.replyTo.id,
            content: msg.replyTo.deleted ? "Message supprimé" : msg.replyTo.content,
            senderId: msg.replyTo.senderId,
          }
        : null,
      film: msg.film ?? null,
      reactions: msg.deleted ? [] : groupReactions(msg.reactions, me.userId),
    }));

    // Message épinglé (le plus récent)
    const pinnedMsg = formatted.slice().reverse().find(m => m.pinned) ?? null;

    return reply.send({ partner, messages: formatted, pinned: pinnedMsg });
  });

  // ── POST /api/messages/:pseudo ───────────────────────
  fastify.post<{
    Params: { pseudo: string };
    Body: { content?: string; replyToId?: string; filmId?: string };
  }>(
    "/messages/:pseudo",
    async (req, reply) => {
      const me = extractUser(req);
      if (!me) return reply.status(401).send({ error: "Non authentifié" });

      const { content = "", replyToId, filmId } = req.body ?? {};
      const trimmed = content.trim();

      // Au moins content ou filmId requis
      if (!trimmed && !filmId) return reply.status(400).send({ error: "Message vide" });
      if (trimmed.length > 2000) return reply.status(400).send({ error: "Message trop long" });

      const partner = await prisma.user.findUnique({ where: { pseudo: req.params.pseudo } });
      if (!partner) return reply.status(404).send({ error: "Utilisateur introuvable" });
      if (partner.id === me.userId) return reply.status(400).send({ error: "Impossible de se contacter soi-même" });

      const sender = await prisma.user.findUnique({
        where: { id: me.userId },
        select: { pseudo: true, nom: true, avatar: true },
      });

      const message = await prisma.message.create({
        data: {
          senderId: me.userId,
          receiverId: partner.id,
          content: trimmed,
          ...(replyToId ? { replyToId } : {}),
          ...(filmId ? { filmId } : {}),
        },
        select: {
          id: true, content: true, senderId: true, createdAt: true,
          replyToId: true, filmId: true,
          film: { select: FILM_SELECT },
        },
      });

      // Notification in-app (max 1/h par expéditeur)
      const senderName = sender?.pseudo ?? sender?.nom ?? "Quelqu'un";
      const since1h = new Date(Date.now() - 60 * 60 * 1000);
      const alreadyNotified = await prisma.notification.findFirst({
        where: { userId: partner.id, type: "message", lien: `/messages/${senderName}`, createdAt: { gte: since1h } },
      });
      if (!alreadyNotified) {
        const notifCorps = filmId && !trimmed
          ? `${senderName} vous a partagé un film`
          : (trimmed.slice(0, 100) + (trimmed.length > 100 ? "…" : ""));
        await prisma.notification.create({
          data: {
            userId:   partner.id,
            type:     "message",
            titre:    `${senderName} vous a envoyé un message`,
            corps:    notifCorps,
            lien:     `/messages/${senderName}`,
            imageUrl: sender?.avatar ?? null,
          },
        }).catch(() => {});
      }

      return reply.status(201).send(message);
    }
  );

  // ── DELETE /api/messages/:messageId ─────────────────
  fastify.delete<{ Params: { messageId: string } }>(
    "/messages/:messageId",
    async (req, reply) => {
      const me = extractUser(req);
      if (!me) return reply.status(401).send({ error: "Non authentifié" });

      const msg = await prisma.message.findUnique({ where: { id: req.params.messageId } });
      if (!msg) return reply.status(404).send({ error: "Message introuvable" });
      if (msg.senderId !== me.userId) return reply.status(403).send({ error: "Accès refusé" });

      await prisma.message.update({
        where: { id: req.params.messageId },
        data: { deleted: true, pinned: false },
      });

      return reply.send({ ok: true });
    }
  );

  // ── PATCH /api/messages/:messageId ──────────────────
  fastify.patch<{ Params: { messageId: string }; Body: { content: string } }>(
    "/messages/:messageId",
    async (req, reply) => {
      const me = extractUser(req);
      if (!me) return reply.status(401).send({ error: "Non authentifié" });

      const { content } = req.body ?? {};
      if (!content?.trim()) return reply.status(400).send({ error: "Contenu requis" });
      if (content.trim().length > 2000) return reply.status(400).send({ error: "Message trop long" });

      const msg = await prisma.message.findUnique({ where: { id: req.params.messageId } });
      if (!msg) return reply.status(404).send({ error: "Message introuvable" });
      if (msg.senderId !== me.userId) return reply.status(403).send({ error: "Accès refusé" });
      if (msg.deleted) return reply.status(400).send({ error: "Message supprimé" });

      const updated = await prisma.message.update({
        where: { id: req.params.messageId },
        data: { content: content.trim(), edited: true, editedAt: new Date() },
        select: { id: true, content: true, edited: true, editedAt: true },
      });

      return reply.send(updated);
    }
  );

  // ── POST /api/messages/:pseudo/pin/:messageId ────────
  fastify.post<{ Params: { pseudo: string; messageId: string } }>(
    "/messages/:pseudo/pin/:messageId",
    async (req, reply) => {
      const me = extractUser(req);
      if (!me) return reply.status(401).send({ error: "Non authentifié" });

      const partner = await prisma.user.findUnique({ where: { pseudo: req.params.pseudo } });
      if (!partner) return reply.status(404).send({ error: "Utilisateur introuvable" });

      const msg = await prisma.message.findUnique({ where: { id: req.params.messageId } });
      if (!msg) return reply.status(404).send({ error: "Message introuvable" });
      if (msg.senderId !== me.userId && msg.receiverId !== me.userId) {
        return reply.status(403).send({ error: "Accès refusé" });
      }
      if (msg.deleted) return reply.status(400).send({ error: "Message supprimé" });

      const newPinned = !msg.pinned;

      // Désépingler tous les messages de la conversation d'abord
      if (newPinned) {
        await prisma.message.updateMany({
          where: {
            pinned: true,
            OR: [
              { senderId: me.userId, receiverId: partner.id },
              { senderId: partner.id, receiverId: me.userId },
            ],
          },
          data: { pinned: false },
        });
      }

      await prisma.message.update({
        where: { id: req.params.messageId },
        data: { pinned: newPinned },
      });

      return reply.send({ ok: true, pinned: newPinned });
    }
  );

  // ── POST /api/messages/react/:messageId ──────────────
  fastify.post<{ Params: { messageId: string }; Body: { emoji: string } }>(
    "/messages/react/:messageId",
    async (req, reply) => {
      const me = extractUser(req);
      if (!me) return reply.status(401).send({ error: "Non authentifié" });

      const { emoji } = req.body ?? {};
      if (!emoji) return reply.status(400).send({ error: "Emoji requis" });

      const msg = await prisma.message.findUnique({
        where: { id: req.params.messageId },
        select: { senderId: true, receiverId: true, deleted: true },
      });
      if (!msg) return reply.status(404).send({ error: "Message introuvable" });
      if (msg.deleted) return reply.status(400).send({ error: "Message supprimé" });
      if (msg.senderId !== me.userId && msg.receiverId !== me.userId) {
        return reply.status(403).send({ error: "Accès refusé" });
      }

      const existing = await prisma.messageReaction.findUnique({
        where: { userId_messageId_emoji: { userId: me.userId, messageId: req.params.messageId, emoji } },
      });

      if (existing) {
        await prisma.messageReaction.delete({ where: { id: existing.id } });
        return reply.send({ ok: true, action: "removed" });
      } else {
        await prisma.messageReaction.create({
          data: { userId: me.userId, messageId: req.params.messageId, emoji },
        });
        return reply.send({ ok: true, action: "added" });
      }
    }
  );
};

export default messagesRoutes;
