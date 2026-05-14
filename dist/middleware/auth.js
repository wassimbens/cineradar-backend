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
/** Décore request.user si cookie ou Bearer présent — ne bloque pas si absent */
function extractUser(request) {
    try {
        // 1. Cookie httpOnly
        const cookieToken = request.cookies?.["cineradar_session"];
        if (cookieToken)
            return jsonwebtoken_1.default.verify(cookieToken, JWT_SECRET);
        // 2. Header Authorization: Bearer <token>
        const authHeader = request.headers.authorization;
        if (authHeader?.startsWith("Bearer ")) {
            const bearerToken = authHeader.slice(7);
            return jsonwebtoken_1.default.verify(bearerToken, JWT_SECRET);
        }
        return null;
    }
    catch {
        return null;
    }
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