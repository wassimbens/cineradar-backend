-- Supprime les doublons de séances avant d'ajouter la contrainte unique.
-- On garde la séance la plus ancienne (premier créé) pour chaque groupe.
DELETE FROM "Seance" s
WHERE s.id NOT IN (
  SELECT DISTINCT ON ("filmId", "salleId", "dateHeure") id
  FROM "Seance"
  ORDER BY "filmId", "salleId", "dateHeure", "createdAt" ASC
);

-- Contrainte unique : une séance = un film + une salle + un horaire
CREATE UNIQUE INDEX "Seance_filmId_salleId_dateHeure_key"
  ON "Seance"("filmId", "salleId", "dateHeure");
