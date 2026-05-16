'use strict';
// Script de démarrage Railway :
// 1. Nettoie les données orphelines qui bloquent prisma db push
// 2. Synchronise le schéma Prisma avec la DB
// 3. Démarre le serveur Node.js

const { execFileSync, spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();

  // ── Étape 1 : nettoyage données orphelines ────────────────
  // Certaines tables ont des FK qui ne peuvent être ajoutées que si les données
  // existantes sont cohérentes. On supprime les lignes sans parent avant db push.
  const cleanups = [
    'DELETE FROM "UserPosterChoice" WHERE "userId" NOT IN (SELECT id FROM "User")',
    'DELETE FROM "Follow" WHERE "followerId" NOT IN (SELECT id FROM "User")',
    'DELETE FROM "Follow" WHERE "followedId" NOT IN (SELECT id FROM "User")',
    'DELETE FROM "Notification" WHERE "userId" NOT IN (SELECT id FROM "User")',
    'DELETE FROM "Message" WHERE "senderId" NOT IN (SELECT id FROM "User")',
    'DELETE FROM "Message" WHERE "receiverId" NOT IN (SELECT id FROM "User")',
  ];

  for (const sql of cleanups) {
    try {
      const n = await prisma.$executeRawUnsafe(sql);
      if (n > 0) console.log(`[startup] Cleaned ${n} orphaned row(s): ${sql.split('"')[1]}`);
    } catch (e) {
      // Table inexistante ou autre erreur non-fatale → on continue
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('does not exist')) {
        console.warn(`[startup] Cleanup warning (${sql.split('"')[1]}):`, msg);
      }
    }
  }

  await prisma.$disconnect();

  // ── Étape 2 : synchronisation du schéma ──────────────────
  console.log('[startup] Syncing DB schema...');
  execFileSync('./node_modules/.bin/prisma', ['db', 'push'], { stdio: 'inherit' });

  // ── Étape 3 : démarrage du serveur ───────────────────────
  console.log('[startup] Starting server...');
  const srv = spawn('node', ['dist/index.js'], { stdio: 'inherit' });

  // Propager les signaux d'arrêt proprement
  ['SIGTERM', 'SIGINT'].forEach(sig =>
    process.on(sig, () => { srv.kill(sig); })
  );
  srv.on('close', code => process.exit(code ?? 0));
  srv.on('error', err => { console.error('[startup] Server error:', err); process.exit(1); });
}

main().catch(err => {
  console.error('[startup] Fatal error:', err);
  process.exit(1);
});
