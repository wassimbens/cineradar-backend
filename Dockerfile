# ── Étape 1 : dépendances ────────────────────────────────────
FROM node:20-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Étape 2 : build TypeScript ───────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN chmod +x node_modules/.bin/prisma && node_modules/.bin/prisma generate
RUN npm run build

# ── Étape 3 : image finale (légère) ─────────────────────────
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# OpenSSL requis par Prisma
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/prisma       ./prisma

EXPOSE 3003

# Applique les migrations puis démarre le serveur
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
