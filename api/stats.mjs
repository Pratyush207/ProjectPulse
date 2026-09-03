import { getStats, SEEDS, SEED_WEIGHT, json } from "../lib/helpers.mjs";

export default { fetch: async (req) => {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const stats = await getStats();
  return json({ stats, seeds: SEEDS, seedWeight: SEED_WEIGHT });
} };
