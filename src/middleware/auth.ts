// ─────────────────────────────────────────────────────────
//  Middleware JWT — extrait l'utilisateur depuis le cookie
// ─────────────────────────────────────────────────────────

import jwt from "jsonwebtoken";
import { FastifyRequest, FastifyReply } from "fastify";

const JWT_SECRET = process.env["JWT_SECRET"] ?? "cineradar-secret";

export interface JwtPayload {
  userId: string;
  email:  string;
  pseudo: string | null;
}

/** Décore request.user si cookie ou Bearer présent — ne bloque pas si absent.
 *  Priorité : Bearer > Cookie (le front gère explicitement son token localStorage). */
export function extractUser(request: FastifyRequest): JwtPayload | null {
  // 1. Header Authorization: Bearer <token> — priorité maximale
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const bearerToken = authHeader.slice(7);
    try {
      return jwt.verify(bearerToken, JWT_SECRET) as JwtPayload;
    } catch {
      // Bearer invalide → tente le cookie ci-dessous
    }
  }

  // 2. Cookie httpOnly — fallback (SSR ou requêtes sans header)
  const cookieToken = (request.cookies as Record<string, string>)?.["cineradar_session"];
  if (cookieToken) {
    try {
      return jwt.verify(cookieToken, JWT_SECRET) as JwtPayload;
    } catch {
      return null;
    }
  }

  return null;
}

/** Génère un token JWT valable 30 jours */
export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}

/** Hook Fastify qui exige une session valide */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const user = extractUser(request);
  if (!user) {
    reply.code(401).send({ error: "Authentification requise" });
    return;
  }
  // Attache l'utilisateur à la requête
  (request as FastifyRequest & { user: JwtPayload }).user = user;
}
