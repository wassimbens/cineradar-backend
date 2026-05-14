-- CreateEnum
CREATE TYPE "Version" AS ENUM ('VO', 'VF', 'VOSTFR');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Film" (
    "id" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "titreOriginal" TEXT,
    "synopsis" TEXT,
    "affiche" TEXT,
    "duree" INTEGER,
    "genres" TEXT[],
    "realisateur" TEXT,
    "acteurs" TEXT[],
    "annee" INTEGER,
    "tmdbId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Film_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cinema" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "adresse" TEXT NOT NULL,
    "ville" TEXT NOT NULL,
    "codePostal" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "siteWeb" TEXT,
    "telephone" TEXT,
    "chaine" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cinema_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Salle" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "capacite" INTEGER,
    "cinemaId" TEXT NOT NULL,

    CONSTRAINT "Salle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Seance" (
    "id" TEXT NOT NULL,
    "dateHeure" TIMESTAMP(3) NOT NULL,
    "version" "Version" NOT NULL,
    "format" TEXT,
    "langue" TEXT,
    "prix" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "filmId" TEXT NOT NULL,
    "salleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Seance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alerte" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "filmTitre" TEXT NOT NULL,
    "ville" TEXT NOT NULL,
    "rayon" INTEGER NOT NULL DEFAULT 10,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "filmId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alerte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeanceNotifiee" (
    "id" TEXT NOT NULL,
    "alerteId" TEXT NOT NULL,
    "seanceId" TEXT NOT NULL,
    "envoyeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeanceNotifiee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Film_tmdbId_key" ON "Film"("tmdbId");

-- CreateIndex
CREATE INDEX "Seance_filmId_dateHeure_idx" ON "Seance"("filmId", "dateHeure");

-- CreateIndex
CREATE INDEX "Seance_salleId_dateHeure_idx" ON "Seance"("salleId", "dateHeure");

-- CreateIndex
CREATE INDEX "Alerte_email_idx" ON "Alerte"("email");

-- CreateIndex
CREATE INDEX "Alerte_filmId_ville_idx" ON "Alerte"("filmId", "ville");

-- CreateIndex
CREATE UNIQUE INDEX "SeanceNotifiee_alerteId_seanceId_key" ON "SeanceNotifiee"("alerteId", "seanceId");

-- AddForeignKey
ALTER TABLE "Salle" ADD CONSTRAINT "Salle_cinemaId_fkey" FOREIGN KEY ("cinemaId") REFERENCES "Cinema"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seance" ADD CONSTRAINT "Seance_filmId_fkey" FOREIGN KEY ("filmId") REFERENCES "Film"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seance" ADD CONSTRAINT "Seance_salleId_fkey" FOREIGN KEY ("salleId") REFERENCES "Salle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alerte" ADD CONSTRAINT "Alerte_filmId_fkey" FOREIGN KEY ("filmId") REFERENCES "Film"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alerte" ADD CONSTRAINT "Alerte_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeanceNotifiee" ADD CONSTRAINT "SeanceNotifiee_alerteId_fkey" FOREIGN KEY ("alerteId") REFERENCES "Alerte"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeanceNotifiee" ADD CONSTRAINT "SeanceNotifiee_seanceId_fkey" FOREIGN KEY ("seanceId") REFERENCES "Seance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
