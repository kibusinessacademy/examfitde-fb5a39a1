/**
 * CI Guard: Validates JOB_DEFINITIONS pool assignments against the golden contract.
 * Run: deno run --allow-read scripts/check-pool-contract.ts
 * Fails if any pool assignment drifts without a deliberate contract update.
 */

const CONTRACT_PATH = "scripts/job-pool-contract.json";
const JOB_MAP_PATH = "supabase/functions/_shared/job-map.ts";

async function main() {
  // Load golden contract
  const contractText = await Deno.readTextFile(CONTRACT_PATH);
  const contract: Record<string, string> = JSON.parse(contractText);

  // Dynamic import of job-map
  const jobMap = await import(`../${JOB_MAP_PATH}`);
  const jobDefs: Record<string, { pool: string }> = jobMap.JOB_DEFINITIONS;

  const errors: string[] = [];

  // Check every contract entry against JOB_DEFINITIONS
  for (const [jobType, expectedPool] of Object.entries(contract)) {
    const actual = jobDefs[jobType];
    if (!actual) {
      errors.push(`MISSING: "${jobType}" is in contract but not in JOB_DEFINITIONS`);
      continue;
    }
    if (actual.pool !== expectedPool) {
      errors.push(`DRIFT: "${jobType}" contract="${expectedPool}" but JOB_DEFINITIONS="${actual.pool}"`);
    }
  }

  // Check for new job types not in contract
  for (const jobType of Object.keys(jobDefs)) {
    if (!(jobType in contract)) {
      errors.push(`UNCONTRACTED: "${jobType}" exists in JOB_DEFINITIONS but has no contract entry — add it to ${CONTRACT_PATH}`);
    }
  }

  if (errors.length > 0) {
    console.error("❌ Pool Contract Guard FAILED:\n");
    for (const e of errors) console.error(`  • ${e}`);
    console.error(`
HOW TO FIX:
  Option 1: Change JOB_DEFINITIONS in ${JOB_MAP_PATH} to match the contract.
  Option 2: Deliberately update ${CONTRACT_PATH} to reflect the new pool assignment.
             Run: npx ts-node scripts/update-pool-contract.ts  (or manually edit the JSON)
  IMPORTANT: If you change a pool, ensure a backfill migration exists for in-flight jobs.
`);
    Deno.exit(1);
  }

  console.log(`✅ Pool Contract Guard passed (${Object.keys(contract).length} entries verified).`);
}

await main();
