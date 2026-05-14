async function main() {
  const r = await fetch("http://localhost:3003/api/films/all-classics");
  const data = await r.json() as Array<{ genres?: string[] }>;
  console.log("Films:", data.length);
  const genres = new Map<string, number>();
  for (const f of data) {
    for (const g of (f.genres ?? [])) {
      genres.set(g, (genres.get(g) ?? 0) + 1);
    }
  }
  console.log("Genres uniques:", genres.size);
  const sorted = [...genres.entries()].sort((a, b) => b[1] - a[1]);
  for (const [g, c] of sorted) {
    console.log(" ", JSON.stringify(g).padEnd(40), c);
  }
}
main();
