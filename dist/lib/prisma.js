"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
// Singleton Prisma : évite de créer trop de connexions en dev (hot reload)
const globalForPrisma = globalThis;
exports.prisma = globalForPrisma.prisma ??
    new client_1.PrismaClient({
        log: process.env["NODE_ENV"] === "development"
            ? ["query", "warn", "error"]
            : ["warn", "error"],
    });
if (process.env["NODE_ENV"] !== "production") {
    globalForPrisma.prisma = exports.prisma;
}
//# sourceMappingURL=prisma.js.map