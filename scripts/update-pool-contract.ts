/**
 * Regenerates scripts/job-pool-contract.json from the SSOT (JOB_DEFINITIONS).
 * Run: deno run -A scripts/update-pool-contract.ts
 * Use this ONLY when you deliberately change a pool assignment.
 */

const CONTRACT_PATH = "scripts/job-pool-contract.json";
const JOB_MAP_PATH = "supabase/functions/_shared/job-map.ts";

async function main() {
  const jobMap = await import(`../${JOB_MAP_PATH}`);
  const jobDefs: Record<string, { pool: string }> = jobMap.JOB_DEFINITIONS;

  // Build sorted contract
  const contract: Record<string, string> = {};
  const sortedKeys = Object.keys(jobDefs).sort();
  for (const key of sortedKeys) {
    contract[key] = jobDefs[key].pool;
  }

  const json = JSON.stringify(contract, null, 2) + "\n";
  await Deno.writeTextFile(CONTRACT_PATH, json);

  console.log(`✅ Pool contract updated (${sortedKeys.length} entries) → ${CONTRACT_PATH}`);
  console.log("   ⚠️  Remember: if you changed a pool, create a backfill migration for in-flight jobs!");
}

await main();
