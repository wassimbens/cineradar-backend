import { createClient } from "redis";
import * as dotenv from "dotenv";
dotenv.config();

const REDIS_URL = process.env["REDIS_URL"] ?? "redis://127.0.0.1:6379";

async function main() {
  const client = createClient({ url: REDIS_URL });
  await client.connect();
  const keys = await client.keys("*");
  if (keys.length === 0) {
    console.log("Cache vide.");
  } else {
    await client.del(keys);
    console.log(`✅ ${keys.length} clés supprimées du cache Redis.`);
  }
  await client.disconnect();
}
main().catch(err => { console.error(err); process.exit(1); });
