// ─────────────────────────────────────────────────────────
//  Routes Messages
//
//  GET    /api/messages                      Conversations
//  GET    /api/messages/unread-count         Nb non lus
//  GET    /api/messages/:pseudo              Thread complet
//  POST   /api/messages/:pseudo              Envoyer un message
//  POST   /api/messages/react/:messageId     Toggler une réaction
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

const messagesRoutes: FastifyPluginAsync = async (fastify) => {

  // ── GET /api/messages/unread-count ───────────────────
  fastify.get("/messages/unread-count", async (req, reply) => {
    const me = extractUser(req);
    if (!me) return reply.status(401).send({ error: "Non authentifié" });
    const count = await prisma.message.count({
      where: { receiverId: me.userId, lu: false },
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
      where: { receiverId: me.userId, lu: false },
      _count: { id: true },
    });
    const unreadMap = new Map(unreadByPartner.map(r => [r.senderId, r._count.id]));

    const conversations = [...byPartner.values()].map(msg => {
      const partner = msg.senderId === me.userId ? msg.receiver : msg.sender;
      return {
        partner,
        lastMessage: { content: msg.content, createdAt: msg.createdAt, fromMe: msg.senderId === me.userId },
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
        createdAt: true,
        replyToId: true,
        replyTo: { select: { id: true, content: true, senderId: true } },
        reactions: { select: { emoji: true, userId: true } },
      },
    });

    const formatted = messages.map(msg => ({
      id: msg.id,
      content: msg.content,
      senderId: msg.senderId,
      lu: msg.lu,
      createdAt: msg.createdAt,
      replyTo: msg.replyTo ?? null,
      reactions: groupReactions(msg.reactions, me.userId),
    }));

    return reply.send({ partner, messages: formatted });
  });

  // ── POST /api/messages/:pseudo ───────────────────────
  fastify.post<{ Params: { pseudo: string }; Body: { content: string; replyToId?: string } }>(
    "/messages/:pseudo",
    async (req, reply) => {
      const me = extractUser(req);
      if (!me) return reply.status(401).send({ error: "Non authentifié" });

      const { content, replyToId } = req.body ?? {};
      if (!content?.trim()) return reply.status(400).send({ error: "Message vide" });
      if (content.length > 2000) return reply.status(400).send({ error: "Message trop long" });

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
          content: content.trim(),
          ...(replyToId ? { replyToId } : {}),
        },
        select: { id: true, content: true, senderId: true, createdAt: true, replyToId: true },
      });

      // Notification in-app pour le destinataire (max 1/h par expéditeur)
      const senderName = sender?.pseudo ?? sender?.nom ?? "Quelqu'un";
      const since1h = new Date(Date.now() - 60 * 60 * 1000);
      const alreadyNotified = await prisma.notification.findFirst({
        where: { userId: partner.id, type: "message", lien: `/messages/${senderName}`, createdAt: { gte: since1h } },
      });
      if (!alreadyNotified) {
        await prisma.notification.create({
          data: {
            userId:   partner.id,
            type:     "message",
            titre:    `${senderName} vous a envoyé un message`,
            corps:    content.trim().slice(0, 100) + (content.trim().length > 100 ? "…" : ""),
            lien:     `/messages/${senderName}`,
            imageUrl: sender?.avatar ?? null,
          },
        }).catch(() => {});
      }

      return reply.status(201).send(message);
    }
  );

  // ── POST /api/messages/react/:messageId ──────────────
  // Toggle une réaction emoji (ajoute si absente, retire si présente)
  fastify.post<{ Params: { messageId: string }; Body: { emoji: string } }>(
    "/messages/react/:messageId",
    async (req, reply) => {
      const me = extractUser(req);
      if (!me) return reply.status(401).send({ error: "Non authentifié" });

      const { emoji } = req.body ?? {};
      if (!emoji) return reply.status(400).send({ error: "Emoji requis" });

      // Vérifier que le message appartient à une conversation de l'utilisateur
      const msg = await prisma.message.findUnique({
        where: { id: req.params.messageId },
        select: { senderId: true, receiverId: true },
      });
      if (!msg) return reply.status(404).send({ error: "Message introuvable" });
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
