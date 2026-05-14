"use strict";
/**
 * Script de test — Phase 1 AlloCiné uniquement (découverte)
 * Ne scrape PAS les séances, liste juste les cinémas trouvés.
 *
 * Usage : npx tsx src/scripts/test-allocine-discovery.ts
 */
Object.defineProperty(exports, "__esModule", { value: true });
const playwright_1 = require("playwright");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const NATIO_START = 5700;
const NATIO_END = 5900; // réduit pour le test
const HTTP_CONCURR = 10;
function extractIdsFromText(text, ids) {
    for (const m of text.matchAll(/salle_gen_csalle=([A-Z][A-Z0-9]*)/g))
        ids.add(m[1]);
    for (const m of text.matchAll(/"(?:internalId|theaterId|theaterCode)"\s*:\s*"([A-Z][A-Z0-9]*)"/g))
        ids.add(m[1]);
    for (const m of text.matchAll(/theater-([A-Z][A-Z0-9]*)\b/g))
        ids.add(m[1]);
}
async function runConcurrent(tasks, concurrency) {
    let i = 0;
    while (i < tasks.length) {
        await Promise.allSettled(tasks.slice(i, i + concurrency).map(t => t()));
        i += concurrency;
    }
}
async function main() {
    console.log("🔍 Test découverte AlloCiné (natio 5700-5900)…\n");
    const browser = await playwright_1.chromium.launch({ headless: true });
    const ctx = await browser.newContext({ userAgent: UA, locale: "fr-FR" });
    const ids = new Set();
    let checked = 0;
    let found = 0;
    const tasks = [];
    for (let n = NATIO_START; n <= NATIO_END; n++) {
        const natio = n;
        tasks.push(async () => {
            try {
                const url = `https://www.allocine.fr/seance/salle_gen_idnat_natio-${natio}.html`;
                const resp = await ctx.request.get(url, {
                    headers: { Accept: "text/html" },
                    timeout: 10_000,
                });
                checked++;
                if (resp.ok()) {
                    const before = ids.size;
                    extractIdsFromText(await resp.text(), ids);
                    if (ids.size > before) {
                        found++;
                        process.stdout.write(`  natio-${natio} → +${ids.size - before} IDs (total ${ids.size})\n`);
                    }
                }
            }
            catch { }
        });
    }
    await runConcurrent(tasks, HTTP_CONCURR);
    // Test quelques pages département
    console.log("\n📋 Test pages département…");
    const depts = ["75", "69", "13", "33", "31", "59", "67", "34", "06", "44", "35", "76", "38", "57", "62", "83", "2A"];
    for (const dept of depts) {
        try {
            const url = `https://www.allocine.fr/salle/departement_gen_numdt-${dept}.html`;
            const resp = await ctx.request.get(url, { timeout: 10_000 });
            if (resp.ok()) {
                const before = ids.size;
                extractIdsFromText(await resp.text(), ids);
                console.log(`  dept-${dept} → +${ids.size - before} IDs (total ${ids.size})`);
            }
            else {
                console.log(`  dept-${dept} → HTTP ${resp.status()}`);
            }
        }
        catch (e) {
            console.log(`  dept-${dept} → erreur`);
        }
    }
    await ctx.close();
    await browser.close();
    console.log(`\n✅ Résultat final : ${ids.size} cinémas découverts`);
    console.log(`📊 Pages natio vérifiées : ${checked}, avec résultats : ${found}`);
    if (ids.size > 0) {
        console.log("\n🎬 Échantillon d'IDs trouvés :");
        const sample = [...ids].slice(0, 30);
        sample.forEach(id => console.log(`   ${id}`));
        if (ids.size > 30)
            console.log(`   … et ${ids.size - 30} autres`);
    }
}
main().catch(console.error);
//# sourceMappingURL=test-allocine-discovery.js.map