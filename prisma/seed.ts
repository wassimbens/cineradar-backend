import { PrismaClient, Version } from "@prisma/client";

const prisma = new PrismaClient();

// ─── Données de seed ─────────────────────────────────────

const cinemas = [
  {
    nom: "UGC Ciné Cité Les Halles",
    adresse: "7 Place de la Rotonde, Forum des Halles",
    ville: "Paris",
    codePostal: "75001",
    latitude: 48.8623,
    longitude: 2.3472,
    siteWeb: "https://www.ugc.fr",
    telephone: "0892700000",
    chaine: "UGC",
    salles: ["Salle 1", "Salle 2", "Salle 3", "Grande Salle"],
  },
  {
    nom: "MK2 Bibliothèque",
    adresse: "128-162 Avenue de France",
    ville: "Paris",
    codePostal: "75013",
    latitude: 48.8303,
    longitude: 2.3765,
    siteWeb: "https://www.mk2.com",
    telephone: "0892692696",
    chaine: "MK2",
    salles: ["Salle A", "Salle B", "Dolby Atmos"],
  },
  {
    nom: "Pathé Wepler",
    adresse: "16 Place de Clichy",
    ville: "Paris",
    codePostal: "75018",
    latitude: 48.8837,
    longitude: 2.3268,
    siteWeb: "https://www.pathe.fr",
    telephone: "0892696696",
    chaine: "Pathé",
    salles: ["Salle 1", "Salle 2", "IMAX"],
  },
  {
    nom: "Le Grand Rex",
    adresse: "1 Boulevard Poissonnière",
    ville: "Paris",
    codePostal: "75002",
    latitude: 48.8706,
    longitude: 2.3488,
    siteWeb: "https://www.legrandrex.com",
    telephone: "0892687095",
    chaine: null,
    salles: ["Grande Salle Rex", "Salle Club"],
  },
  {
    nom: "Cinéma du Panthéon",
    adresse: "13 Rue Victor Cousin",
    ville: "Paris",
    codePostal: "75005",
    latitude: 48.8494,
    longitude: 2.3419,
    siteWeb: "https://www.cinema-du-pantheon.com",
    telephone: "0143264686",
    chaine: null,
    salles: ["Salle Unique"],
  },
];

const films = [
  {
    titre: "Dune : Deuxième Partie",
    titreOriginal: "Dune: Part Two",
    synopsis:
      "Paul Atréides unit ses forces avec Chani et les Fremen pour mener la révolte contre ceux qui ont détruit sa famille. Alors qu'il doit choisir entre l'amour de sa vie et le destin de l'univers, il s'efforce d'éviter un avenir terrible qu'il est seul à pouvoir prévoir.",
    affiche:
      "https://image.tmdb.org/t/p/w500/czembW0Rk1CPkci9rNA0e5aJh60.jpg",
    duree: 167,
    genres: ["Science-Fiction", "Aventure"],
    realisateur: "Denis Villeneuve",
    acteurs: ["Timothée Chalamet", "Zendaya", "Rebecca Ferguson"],
    annee: 2024,
    tmdbId: "693134",
  },
  {
    titre: "Oppenheimer",
    titreOriginal: "Oppenheimer",
    synopsis:
      "L'histoire de J. Robert Oppenheimer, physicien théoricien américain qui a joué un rôle clé dans le projet Manhattan et le développement de la bombe atomique.",
    affiche:
      "https://image.tmdb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg",
    duree: 180,
    genres: ["Drame", "Histoire"],
    realisateur: "Christopher Nolan",
    acteurs: ["Cillian Murphy", "Emily Blunt", "Matt Damon"],
    annee: 2023,
    tmdbId: "872585",
  },
  {
    titre: "Past Lives",
    titreOriginal: "Past Lives",
    synopsis:
      "Nora et Hae Sung, deux amis d'enfance profondément liés, se séparent après que la famille de Nora quitte la Corée. Vingt ans plus tard, ils se retrouvent à New York, confrontés à leur passé et à leurs choix.",
    affiche:
      "https://image.tmdb.org/t/p/w500/k3waqVXAQSHi8MJMC62FYVHOJol.jpg",
    duree: 106,
    genres: ["Romance", "Drame"],
    realisateur: "Celine Song",
    acteurs: ["Greta Lee", "Teo Yoo", "John Magaro"],
    annee: 2023,
    tmdbId: "1075794",
  },
  {
    titre: "Poor Things",
    titreOriginal: "Poor Things",
    synopsis:
      "Bella Baxter, une jeune femme ramenée à la vie par un brillant et peu orthodoxe scientifique, s'enfuit avec un avocat libertin et voyage à travers les continents. Libre de tout préjugé de l'époque, elle devient résolue à défendre l'égalité et l'émancipation.",
    affiche:
      "https://image.tmdb.org/t/p/w500/kCGlIMHnOm8JPXSmailDXfqZEcz.jpg",
    duree: 141,
    genres: ["Science-Fiction", "Comédie", "Romance"],
    realisateur: "Yorgos Lanthimos",
    acteurs: ["Emma Stone", "Mark Ruffalo", "Willem Dafoe"],
    annee: 2023,
    tmdbId: "792307",
  },
  {
    titre: "Anatomie d'une chute",
    titreOriginal: "Anatomie d'une chute",
    synopsis:
      "Sandra, une romancière allemande, est soupçonnée d'avoir tué son mari après sa mort suspecte. Son fils malvoyant est le seul témoin potentiel. Un procès va mettre à nu leur vie de couple.",
    affiche:
      "https://image.tmdb.org/t/p/w500/sEEAKezsGBBvKA6cNHp1u24CYGB.jpg",
    duree: 151,
    genres: ["Drame", "Thriller"],
    realisateur: "Justine Triet",
    acteurs: ["Sandra Hüller", "Swann Arlaud", "Milo Machado-Graner"],
    annee: 2023,
    tmdbId: "1008042",
  },
  {
    titre: "The Zone of Interest",
    titreOriginal: "The Zone of Interest",
    synopsis:
      "Le commandant d'Auschwitz Rudolf Höss et sa femme Hedwig s'efforcent de construire une vie de rêve pour leur famille dans une maison avec jardin à côté du camp.",
    affiche:
      "https://image.tmdb.org/t/p/w500/hUu9zyZmKDEKcSMmJrEsRuqwDSd.jpg",
    duree: 105,
    genres: ["Drame", "Guerre", "Histoire"],
    realisateur: "Jonathan Glazer",
    acteurs: ["Christian Friedel", "Sandra Hüller"],
    annee: 2023,
    tmdbId: "930564",
  },
  {
    titre: "Les Trois Mousquetaires : D'Artagnan",
    titreOriginal: "Les Trois Mousquetaires : D'Artagnan",
    synopsis:
      "Paris, 1627. Au péril de sa vie, d'Artagnan monte à la capitale rejoindre le régiment des Mousquetaires du Roi. Sur la route il croise des hommes de Milady, une femme mystérieuse dont il tombe éperdument amoureux.",
    affiche:
      "https://image.tmdb.org/t/p/w500/9KShGMjDDdHEDpBx8rWAlKMvJVK.jpg",
    duree: 121,
    genres: ["Aventure", "Action"],
    realisateur: "Martin Bourboulon",
    acteurs: ["François Civil", "Vincent Cassel", "Eva Green"],
    annee: 2023,
    tmdbId: "933260",
  },
  {
    titre: "Killers of the Flower Moon",
    titreOriginal: "Killers of the Flower Moon",
    synopsis:
      "Dans l'Oklahoma des années 1920, le peuple Osage est victime d'une série de meurtres mystérieux après la découverte de pétrole sur ses terres. Une investigation du FBI s'ensuit.",
    affiche:
      "https://image.tmdb.org/t/p/w500/dB6Krk806zeqd0YoiGhnfRKAeva.jpg",
    duree: 206,
    genres: ["Crime", "Drame", "Histoire"],
    realisateur: "Martin Scorsese",
    acteurs: ["Leonardo DiCaprio", "Robert De Niro", "Lily Gladstone"],
    annee: 2023,
    tmdbId: "466420",
  },
  {
    titre: "Mission : Impossible – Dead Reckoning Partie 1",
    titreOriginal: "Mission: Impossible – Dead Reckoning Part One",
    synopsis:
      "Ethan Hunt et son équipe de l'IMF doivent retrouver une nouvelle arme terrifiante avant qu'elle ne tombe entre de mauvaises mains.",
    affiche:
      "https://image.tmdb.org/t/p/w500/NNxYkU70HPurnNCSiCjYAmacwm.jpg",
    duree: 163,
    genres: ["Action", "Thriller", "Aventure"],
    realisateur: "Christopher McQuarrie",
    acteurs: ["Tom Cruise", "Hayley Atwell", "Ving Rhames"],
    annee: 2023,
    tmdbId: "575264",
  },
  {
    titre: "La Salle des profs",
    titreOriginal: "Das Lehrerzimmer",
    synopsis:
      "Carla Nowak, jeune professeure idéaliste, est confrontée à une affaire de vols dans son collège. Voulant agir avec équité, elle mène sa propre enquête, mais ses méthodes vont la plonger dans un conflit qui l'échappera rapidement à tout contrôle.",
    affiche:
      "https://image.tmdb.org/t/p/w500/mA8bHMsEJGxsRSEzMVuSXMixT2v.jpg",
    duree: 98,
    genres: ["Drame"],
    realisateur: "İlker Çatak",
    acteurs: ["Leonie Benesch", "Leonard Stettnisch"],
    annee: 2023,
    tmdbId: "1009248",
  },
];

// ─── Fonctions de seed ────────────────────────────────────

async function seedCinemas() {
  console.log("🎬 Insertion des cinémas...");

  const createdCinemas: Array<{ id: string; salles: Array<{ id: string }> }> =
    [];

  for (const cinemaData of cinemas) {
    const { salles: salleNoms, ...cinemaFields } = cinemaData;

    const cinema = await prisma.cinema.create({
      data: {
        ...cinemaFields,
        salles: {
          create: salleNoms.map((nom) => ({ nom })),
        },
      },
      include: { salles: true },
    });

    createdCinemas.push(cinema);
    console.log(`  ✓ ${cinema.nom} (${cinema.salles.length} salles)`);
  }

  return createdCinemas;
}

async function seedFilms() {
  console.log("\n🎞️  Insertion des films...");

  const createdFilms = [];

  for (const filmData of films) {
    const film = await prisma.film.create({ data: filmData });
    createdFilms.push(film);
    console.log(`  ✓ ${film.titre} (${film.annee})`);
  }

  return createdFilms;
}

async function seedSeances(
  createdCinemas: Array<{ id: string; salles: Array<{ id: string }> }>,
  createdFilms: Array<{ id: string }>
) {
  console.log("\n🕐 Insertion des séances...");

  const versions: Version[] = [Version.VF, Version.VO, Version.VOSTFR];
  const formats = ["2D", "3D", "2D"];
  const now = new Date();
  let count = 0;

  for (const cinema of createdCinemas) {
    // Chaque cinéma propose 4 films au hasard parmi les 10
    const filmsForCinema = [...createdFilms]
      .sort(() => Math.random() - 0.5)
      .slice(0, 4);

    for (const film of filmsForCinema) {
      const salle = cinema.salles[Math.floor(Math.random() * cinema.salles.length)];
      const version = versions[Math.floor(Math.random() * versions.length)];
      const format = formats[Math.floor(Math.random() * formats.length)];

      // 2 séances par film : une aujourd'hui, une demain
      for (let dayOffset = 0; dayOffset < 2; dayOffset++) {
        const dateHeure = new Date(now);
        dateHeure.setDate(now.getDate() + dayOffset);
        // Horaire entre 14h et 22h
        dateHeure.setHours(14 + Math.floor(Math.random() * 8), 0, 0, 0);

        await prisma.seance.create({
          data: {
            filmId: film.id,
            salleId: salle.id,
            dateHeure,
            version,
            format,
            prix: version === Version.VO ? 11.5 : 10.5,
            source: "seed",
          },
        });
        count++;
      }
    }
  }

  console.log(`  ✓ ${count} séances créées`);
}

// ─── Main ─────────────────────────────────────────────────

async function main() {
  console.log("🌱 Démarrage du seed CinéRadar...\n");

  // Nettoyage dans l'ordre des dépendances (FK)
  await prisma.seanceNotifiee.deleteMany();
  await prisma.seance.deleteMany();
  await prisma.alerte.deleteMany();
  await prisma.salle.deleteMany();
  await prisma.cinema.deleteMany();
  await prisma.film.deleteMany();
  await prisma.user.deleteMany();
  console.log("🗑️  Base de données nettoyée\n");

  const createdCinemas = await seedCinemas();
  const createdFilms = await seedFilms();
  await seedSeances(createdCinemas, createdFilms);

  console.log("\n✅ Seed terminé avec succès !");
  console.log(`   → ${createdCinemas.length} cinémas`);
  console.log(`   → ${createdFilms.length} films`);
}

main()
  .catch((e) => {
    console.error("❌ Erreur lors du seed :", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
