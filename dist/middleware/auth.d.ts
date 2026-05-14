import { FastifyRequest, FastifyReply } from "fastify";
export interface JwtPayload {
    userId: string;
    email: string;
    pseudo: string | null;
}
/** Décore request.user si cookie ou Bearer présent — ne bloque pas si absent */
export declare function extractUser(request: FastifyRequest): JwtPayload | null;
/** Génère un token JWT valable 30 jours */
export declare function signToken(payload: JwtPayload): string;
/** Hook Fastify qui exige une session valide */
export declare function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void>;
//# sourceMappingURL=auth.d.ts.map