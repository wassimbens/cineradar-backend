/**
 * lib/genres.ts
 * ─────────────────────────────────────────────────────────
 * Helper de normalisation des genres : convertit toutes les
 * variantes (anglais, MAJUSCULES, FR avec accents) vers une
 * forme canonique française unique. Utilisé par les scrapers
 * pour éviter d'introduire de nouveaux doublons.
 * ─────────────────────────────────────────────────────────
 */

const CANONICAL = [
  "Action", "Animation", "Aventure", "Biopic",
  "Comédie", "Comédie dramatique", "Comédie musicale", "Comédie romantique",
  "Concert", "Court métrage", "Crime", "Divers",
  "Documentaire", "Drame", "Espionnage", "Famille",
  "Fantastique", "Guerre", "Historique", "Horreur",
  "Judiciaire", "Musique", "Mystère", "Noir", "Opéra",
  "Performance", "Policier", "Romance", "Satire",
  "Science-Fiction", "Sport", "Téléfilm", "Thriller", "Western",
] as const;

const CANONICAL_SET = new Set<string>(CANONICAL);

const RAW_MAP: Record<string, string> = {
  "action":            "Action",
  "adventure":         "Aventure",
  "adventures":        "Aventure",
  "animation":         "Animation",
  "biography":         "Biopic",
  "biographie":        "Biopic",
  "biopic":            "Biopic",
  "comedy":            "Comédie",
  "comedie":           "Comédie",
  "comedydrama":       "Comédie dramatique",
  "comedy_drama":      "Comédie dramatique",
  "comedy drama":      "Comédie dramatique",
  "comedie dramatique":"Comédie dramatique",
  "romcom":            "Comédie romantique",
  "romantic comedy":   "Comédie romantique",
  "comedie romantique":"Comédie romantique",
  "concert":           "Concert",
  "performance":       "Performance",
  "court metrage":     "Court métrage",
  "court-metrage":     "Court métrage",
  "shortfilm":         "Court métrage",
  "short":             "Court métrage",
  "crime":             "Crime",
  "detective":         "Policier",
  "policier":          "Policier",
  "mystery":           "Mystère",
  "mystere":           "Mystère",
  "noir":              "Noir",
  "filmnoir":          "Noir",
  "documentary":       "Documentaire",
  "documentaire":      "Documentaire",
  "drama":             "Drame",
  "drame":             "Drame",
  "espionnage":        "Espionnage",
  "spy":               "Espionnage",
  "family":            "Famille",
  "famille":           "Famille",
  "fantasy":           "Fantastique",
  "fantastique":       "Fantastique",
  "war":               "Guerre",
  "warmovie":          "Guerre",
  "guerre":            "Guerre",
  "history":           "Historique",
  "histoire":          "Historique",
  "historical":        "Historique",
  "historical_epic":   "Historique",
  "historicalepic":    "Historique",
  "historique":        "Historique",
  "horror":            "Horreur",
  "horreur":           "Horreur",
  "epouvante":         "Horreur",
  "epouvantehorreur":  "Horreur",
  "epouvante horreur": "Horreur",
  "judiciaire":        "Judiciaire",
  "courtroom":         "Judiciaire",
  "music":             "Musique",
  "musique":           "Musique",
  "musical":           "Comédie musicale",
  "comedie musicale":  "Comédie musicale",
  "comedy musical":    "Comédie musicale",
  "opera":             "Opéra",
  "romance":           "Romance",
  "romantic":          "Romance",
  "satire":            "Satire",
  "scifi":             "Science-Fiction",
  "sci-fi":            "Science-Fiction",
  "sciencefiction":    "Science-Fiction",
  "science fiction":   "Science-Fiction",
  "science-fiction":   "Science-Fiction",
  "sport":             "Sport",
  "sports":            "Sport",
  "thriller":          "Thriller",
  "tvmovie":           "Téléfilm",
  "tv movie":          "Téléfilm",
  "telefilm":          "Téléfilm",
  "western":           "Western",
  "divers":            "Divers",
  "kids":              "Famille",
  "children":          "Famille",
  "teen":              "Famille",
};

function normKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/[_\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fallbackCapitalize(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  if (t === t.toUpperCase()) {
    return t.charAt(0) + t.slice(1).toLowerCase();
  }
  return t;
}

/**
 * Normalise un genre unique vers sa forme canonique française.
 * Renvoie une chaîne vide si l'entrée est invalide.
 */
export function canonicalGenre(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  if (CANONICAL_SET.has(raw)) return raw;
  const key = normKey(raw);
  if (!key) return "";
  const compact = key.replace(/\s/g, "");
  return RAW_MAP[key] ?? RAW_MAP[compact] ?? fallbackCapitalize(raw);
}

/**
 * Normalise + déduplique (case-insensitive) un tableau de genres.
 * Préserve l'ordre d'apparition.
 */
export function normalizeGenres(genres: string[] | null | undefined): string[] {
  if (!genres || !Array.isArray(genres)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of genres) {
    const norm = canonicalGenre(g);
    if (!norm) continue;
    const key = norm.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(norm);
  }
  return out;
}
