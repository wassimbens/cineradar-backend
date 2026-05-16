// ─────────────────────────────────────────────────────────
//  Routes Messages
//
//  GET  /api/messages              Liste des conversations
//  GET  /api/messages/:pseudo      Thread avec un utilisateur (marque comme lu)
//  POST /api/messages/:pseudo      Envoyer un message
//  GET  /api/messages/unread-count Nb de messages non lus
// ─────────────────────────────────────────────────────────

import { FastifyPluginAsync } from "fastify";
import { PrismaClient } from "@prisma/client";
import { extractUser } from "../middleware/auth.js";

const prisma = new PrismaClient();

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
  // Liste des conversations (dernier message par interlocuteur)
  fastify.get("/messages", async (req, reply) => {
    const me = extractUser(req);
    if (!me) return reply.status(401).send({ error: "Non authentifié" });

    // Tous les messages impliquant l'utilisateur
    const messages = await prisma.message.findMany({
      where: {
        OR: [{ senderId: me.userId }, { receiverId: me.userId }],
      },
      orderBy: { createdAt: "desc" },
      include: {
        sender:   { select: { id: true, pseudo: true, nom: true, avatar: true } },
        receiver: { select: { id: true, pseudo: true, nom: true, avatar: true } },
      },
    });

    // Grouper par interlocuteur, garder le dernier message
    const byPartner = new Map<string, typeof messages[number]>();
    for (const msg of messages) {
      const partnerId = msg.senderId === me.userId ? msg.receiverId : msg.senderId;
      if (!byPartner.has(partnerId)) byPartner.set(partnerId, msg);
    }

    // Compter les non-lus par conversation
    const unreadByPartner = await prisma.message.groupBy({
      by: ["senderId"],
      where: { receiverId: me.userId, lu: false },
      _count: { id: true },
    });
    const unreadMap = new Map(unreadByPartner.map((r) => [r.senderId, r._count.id]));

    const conversations = [...byPartner.values()].map((msg) => {
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

    // Marquer les messages reçus comme lus
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
      select: { id: true, content: true, senderId: true, lu: true, createdAt: true },
    });

    return reply.send({ partner, messages });
  });

  // ── POST /api/messages/:pseudo ───────────────────────
  fastify.post<{ Params: { pseudo: string }; Body: { content: string } }>(
    "/messages/:pseudo",
    async (req, reply) => {
      const me = extractUser(req);
      if (!me) return reply.status(401).send({ error: "Non authentifié" });

      const { content } = req.body ?? {};
      if (!content?.trim()) return reply.status(400).send({ error: "Message vide" });
      if (content.length > 2000) return reply.status(400).send({ error: "Message trop long (2000 chars max)" });

      const partner = await prisma.user.findUnique({ where: { pseudo: req.params.pseudo } });
      if (!partner) return reply.status(404).send({ error: "Utilisateur introuvable" });
      if (partner.id === me.userId) return reply.status(400).send({ error: "Impossible de se contacter soi-même" });

      const message = await prisma.message.create({
        data: { senderId: me.userId, receiverId: partner.id, content: content.trim() },
        select: { id: true, content: true, senderId: true, createdAt: true },
      });

      return reply.status(201).send(message);
    }
  );
};

export default messagesRoutes;
