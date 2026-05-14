// Script one-shot : corrige la ville et le code postal des cinémas UGC
// dont l'adresse contient un vrai CP (ex: "...75017 PARIS") mais dont
// ville = "Paris" et codePostal = "75000" ont été mis par défaut.
import { prisma } from "../lib/prisma.js";

/**
 * Extrait le code postal et la ville depuis une adresse française.
 * Ex: "Centre Commercial Créteil Soleil  94000 CRETEIL"
 *     → { codePostal: "94000", ville: "Créteil" }
 */
function parseAdresse(adresse: string): { codePostal: string; ville: string } | null {
  // Cherche un code postal français (5 chiffres) suivi du nom de ville
  const match = adresse.match(/(\d{5})\s+([A-ZÀÂÄÉÈÊËÎÏÔÙÛÜÇ][A-ZÀÂÄÉÈÊËÎÏÔÙÛÜÇ0-9\s'\-]+?)(?:\s*$)/i);
  if (!match) return null;

  const codePostal = match[1];
  // Capitalise proprement : "MONTIGNY-LE-BRETONNEUX" → "Montigny-le-Bretonneux"
  const ville = match[2]
    .trim()
    .toLowerCase()
    .replace(/(?:^|\s|-|')(\p{L})/gu, (c) => c.toUpperCase());

  return { codePostal, ville };
}

async function main() {
  // Cible uniquement les cinémas avec les valeurs par défaut du scraper
  const cinemas = await prisma.cinema.findMany({
    where: { ville: "Paris", codePostal: "75000" },
    select: { id: true, nom: true, adresse: true },
  });

  console.log(`\n🔍 ${cinemas.length} cinémas à corriger\n`);

  let corrigés = 0;
  let ignorés  = 0;

  for (const cinema of cinemas) {
    const parsed = parseAdresse(cinema.adresse);

    if (!parsed) {
      console.log(`⚠️  Adresse non parseable : ${cinema.nom}\n   → "${cinema.adresse}"`);
      ignorés++;
      continue;
    }

    await prisma.cinema.update({
      where: { id: cinema.id },
      data:  { ville: parsed.ville, codePostal: parsed.codePostal },
    });

    console.log(`✅ ${cinema.nom}`);
    console.log(`   ${cinema.adresse}`);
    console.log(`   → ${parsed.ville} (${parsed.codePostal})\n`);
    corrigés++;
  }

  console.log(`\n📊 Résultat : ${corrigés} corrigés, ${ignorés} ignorés`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
