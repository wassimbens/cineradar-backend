"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
// Diagnostic AlloCiné API JSON - dump complet de la structure
const playwright_1 = require("playwright");
const fs = __importStar(require("fs"));
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const today = new Date().toISOString().split("T")[0];
async function main() {
    const browser = await playwright_1.chromium.launch({ headless: true });
    const ctx = await browser.newContext({ userAgent: UA, locale: "fr-FR" });
    const response = await ctx.request.get(`https://www.allocine.fr/_/showtimes/theater-C0159/d-${today}/`, { headers: { "Referer": "https://www.allocine.fr/seance/salle_gen_csalle=C0159.html" } });
    const body = await response.text();
    const data = JSON.parse(body);
    // Sauvegarder la réponse complète pour inspection
    fs.writeFileSync("/tmp/allocine-response.json", JSON.stringify(data, null, 2));
    console.log("Réponse sauvegardée dans /tmp/allocine-response.json");
    // Structure détaillée
    console.log(`Films: ${data.results?.length}`);
    const r = data.results?.[0];
    if (r) {
        console.log("\n--- Movie ---");
        console.log(JSON.stringify(r.movie, null, 2));
        console.log("\n--- Showtimes keys ---");
        console.log(Object.keys(r.showtimes));
        console.log("\n--- First showtime per key ---");
        for (const [key, arr] of Object.entries(r.showtimes)) {
            if (Array.isArray(arr) && arr.length > 0) {
                console.log(`${key}: ${JSON.stringify(arr[0])}`);
            }
        }
    }
    // Aussi: theater info
    console.log("\n--- Theater info from results[0] ---");
    console.log(JSON.stringify(data.results?.[0]?.theater ?? data.theater ?? "(not found)"));
    // Top-level keys
    console.log("\n--- Top-level keys ---");
    console.log(Object.keys(data));
    await ctx.close();
    await browser.close();
}
main().catch(console.error);
//# sourceMappingURL=debug-allocine-api.js.map