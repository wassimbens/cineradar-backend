'use strict';
const { execFileSync, spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');

// ─────────────────────────────────────────────────────────────
//  Nettoyage des données orphelines avant prisma db push.
//
//  Problème : la DB contient des tables sans contrainte FK (car
//  elles ont été créées avant que Prisma les ajoute). Certaines
//  lignes référencent des userId/filmId qui n'existent plus.
//  PostgreSQL refuse d'ajouter la FK sur ces données corrompues.
//
//  Solution : supprimer les lignes orphelines dans l'ordre
//  parent→enfant, puis laisser db push ajouter les contraintes.
// ─────────────────────────────────────────────────────────────

async function deleteOrphans(prisma, table, column, refTable, refColumn) {
  try {
    const n = await prisma.$executeRawUnsafe(
      `DELETE FROM "${table}" WHERE "${column}" NOT IN (SELECT "${refColumn}" FROM "${refTable}")`
    );
    if (n > 0) console.log(`[startup] Cleaned ${n} orphaned row(s) in ${table}.${column}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes('does not exist')) {
      console.warn(`[startup] Warning (${table}.${column}):`, msg);
    }
  }
}

async function main() {
  const prisma = new PrismaClient();

  try {
    // ── Étape 1 : nettoyage données orphelines ────────────
    console.log('[startup] Cleaning orphaned data...');

    // Tables enfants de Liste — à nettoyer avant Liste
    await deleteOrphans(prisma, 'ListeFilm',   'listeId',    'Liste', 'id');
    await deleteOrphans(prisma, 'ListeMembre', 'listeId',    'Liste', 'id');
    await deleteOrphans(prisma, 'ListeFilm',   'filmId',     'Film',  'id');

    // Tables enfants de Alerte
    await deleteOrphans(prisma, 'SeanceNotifiee', 'alerteId', 'Alerte', 'id');
    await deleteOrphans(prisma, 'SeanceNotifiee', 'seanceId', 'Seance', 'id');

    // Tables directement liées à User
    await deleteOrphans(prisma, 'ListeMembre',        'userId',     'User', 'id');
    await deleteOrphans(prisma, 'Liste',              'authorId',   'User', 'id');
    await deleteOrphans(prisma, 'Follow',             'followerId', 'User', 'id');
    await deleteOrphans(prisma, 'Follow',             'followedId', 'User', 'id');
    await deleteOrphans(prisma, 'FilmFavori',         'userId',     'User', 'id');
    await deleteOrphans(prisma, 'WatchlistItem',      'userId',     'User', 'id');
    await deleteOrphans(prisma, 'CinemaFavori',       'userId',     'User', 'id');
    await deleteOrphans(prisma, 'Avis',               'userId',     'User', 'id');
    await deleteOrphans(prisma, 'FilmVu',             'userId',     'User', 'id');
    await deleteOrphans(prisma, 'EmailVerifToken',    'userId',     'User', 'id');
    await deleteOrphans(prisma, 'PasswordResetToken', 'userId',     'User', 'id');
    await deleteOrphans(prisma, 'Password',           'userId',     'User', 'id');
    await deleteOrphans(prisma, 'Notification',       'userId',     'User', 'id');
    await deleteOrphans(prisma, 'UserPosterChoice',   'userId',     'User', 'id');
    await deleteOrphans(prisma, 'Message',            'senderId',   'User', 'id');
    await deleteOrphans(prisma, 'Message',            'receiverId', 'User', 'id');

    // Tables liées à Film
    await deleteOrphans(prisma, 'FilmFavori',    'filmId', 'Film', 'id');
    await deleteOrphans(prisma, 'WatchlistItem', 'filmId', 'Film', 'id');
    await deleteOrphans(prisma, 'Avis',          'filmId', 'Film', 'id');
    await deleteOrphans(prisma, 'FilmVu',        'filmId', 'Film', 'id');

    // Tables liées à Cinema / Salle
    await deleteOrphans(prisma, 'CinemaFavori', 'cinemaId', 'Cinema', 'id');
    await deleteOrphans(prisma, 'Salle',        'cinemaId', 'Cinema', 'id');
    await deleteOrphans(prisma, 'Seance',       'salleId',  'Salle',  'id');
    await deleteOrphans(prisma, 'Seance',       'filmId',   'Film',   'id');

  } finally {
    await prisma.$disconnect();
  }

  // ── Étape 2 : synchronisation du schéma ──────────────────
  console.log('[startup] Syncing DB schema...');
  execFileSync('./node_modules/.bin/prisma', ['db', 'push'], { stdio: 'inherit' });

  // ── Étape 3 : démarrage du serveur ───────────────────────
  console.log('[startup] Starting server...');
  const srv = spawn('node', ['dist/index.js'], { stdio: 'inherit' });
  ['SIGTERM', 'SIGINT'].forEach(sig => process.on(sig, () => srv.kill(sig)));
  srv.on('close', code => process.exit(code ?? 0));
  srv.on('error', err => { console.error('[startup] Server error:', err); process.exit(1); });
}

main().catch(err => {
  console.error('[startup] Fatal error:', err);
  process.exit(1);
});
