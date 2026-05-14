# ── Étape 1 : dépendances ────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Étape 2 : build TypeScript ───────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

# ── Étape 3 : image finale (légère) ─────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/prisma       ./prisma

EXPOSE 3003

# Applique les migrations puis démarre le serveur
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
