import { createClient } from "redis";

const REDIS_URL = process.env["REDIS_URL"] ?? "redis://127.0.0.1:6379";

async function main() {
  const client = createClient({ url: REDIS_URL });
  await client.connect();

  const keys = await client.keys("films:*");
  if (keys.length === 0) {
    console.log("No cache keys found");
  } else {
    await client.del(keys);
    console.log(`Cleared ${keys.length} cache keys:`, keys);
  }

  await client.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
