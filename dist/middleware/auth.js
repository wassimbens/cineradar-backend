"use strict";
// ─────────────────────────────────────────────────────────
//  Middleware JWT — extrait l'utilisateur depuis le cookie
// ─────────────────────────────────────────────────────────
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractUser = extractUser;
exports.signToken = signToken;
exports.requireAuth = requireAuth;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env["JWT_SECRET"] ?? "cineradar-secret";
/** Décore request.user si cookie ou Bearer présent — ne bloque pas si absent.
 *  Priorité : Bearer > Cookie (le front gère explicitement son token localStorage). */
function extractUser(request) {
    // 1. Header Authorization: Bearer <token> — priorité maximale
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
        const bearerToken = authHeader.slice(7);
        try {
            return jsonwebtoken_1.default.verify(bearerToken, JWT_SECRET);
        }
        catch {
            // Bearer invalide → tente le cookie ci-dessous
        }
    }
    // 2. Cookie httpOnly — fallback (SSR ou requêtes sans header)
    const cookieToken = request.cookies?.["cineradar_session"];
    if (cookieToken) {
        try {
            return jsonwebtoken_1.default.verify(cookieToken, JWT_SECRET);
        }
        catch {
            return null;
        }
    }
    return null;
}
/** Génère un token JWT valable 30 jours */
function signToken(payload) {
    return jsonwebtoken_1.default.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}
/** Hook Fastify qui exige une session valide */
async function requireAuth(request, reply) {
    const user = extractUser(request);
    if (!user) {
        reply.code(401).send({ error: "Authentification requise" });
        return;
    }
    // Attache l'utilisateur à la requête
    request.user = user;
}
//# sourceMappingURL=auth.js.map