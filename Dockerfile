# ── Étape 1 : dépendances de production ──────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
COPY package*.json ./
RUN npm ci --omit=dev

# ── Étape 2 : build TypeScript ───────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
COPY package*.json ./
RUN npm ci
RUN chmod -R 755 node_modules/.bin/
COPY . .
RUN node_modules/.bin/prisma generate
RUN node_modules/.bin/tsc

# ── Étape 3 : image finale ────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl libc6-compat

COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/prisma       ./prisma
COPY package*.json ./

EXPOSE 3003

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
