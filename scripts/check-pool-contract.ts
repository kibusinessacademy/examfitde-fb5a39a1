/**
 * CI Guard: Validates JOB_DEFINITIONS pool assignments against the golden contract.
 * Run: deno run --allow-read scripts/check-pool-contract.ts
 *
 * SSOT hierarchy:
 *   1. job_type_policies (DB) — runtime authority
 *   2. job-pool-contract.json — CI golden snapshot (must mirror DB)
 *   3. JOB_DEFINITIONS in job-map.ts — code reference (must match contract)
 *
 * Fails CI if any pool assignment drifts without a deliberate contract update.
 * Only "default" and "prebuild" are valid pools. Legacy "core"/"content" are rejected.
 */

const CONTRACT_PATH = "scripts/job-pool-contract.json";
const JOB_MAP_PATH = "supabase/functions/_shared/job-map.ts";
const VALID_POOLS = new Set(["default", "prebuild"]);

async function main() {
  // Load golden contract
  const contractText = await Deno.readTextFile(CONTRACT_PATH);
  const contract: Record<string, string> = JSON.parse(contractText);

  // Dynamic import of job-map
  const jobMap = await import(`../${JOB_MAP_PATH}`);
  const jobDefs: Record<string, { pool: string }> = jobMap.JOB_DEFINITIONS;

  const errors: string[] = [];

  // ── 1. Validate contract pools are valid ──
  for (const [jobType, pool] of Object.entries(contract)) {
    if (!VALID_POOLS.has(pool)) {
      errors.push(`INVALID_POOL: "${jobType}" in contract has pool="${pool}" — only ${[...VALID_POOLS].join("/")} allowed`);
    }
  }

  // ── 2. Check every contract entry against JOB_DEFINITIONS ──
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

  // ── 3. Check for new job types not in contract ──
  for (const jobType of Object.keys(jobDefs)) {
    if (!(jobType in contract)) {
      // Only warn for non-contract types — they still must have valid pools
      if (!VALID_POOLS.has(jobDefs[jobType].pool)) {
        errors.push(`INVALID_POOL: "${jobType}" in JOB_DEFINITIONS has pool="${jobDefs[jobType].pool}" — only ${[...VALID_POOLS].join("/")} allowed`);
      }
    }
  }

  // ── 4. Reject legacy pools in JOB_DEFINITIONS ──
  for (const [jobType, def] of Object.entries(jobDefs)) {
    if (!VALID_POOLS.has(def.pool)) {
      errors.push(`LEGACY_POOL: "${jobType}" uses deprecated pool="${def.pool}" — migrate to ${[...VALID_POOLS].join("/")}`);
    }
  }

  if (errors.length > 0) {
    console.error("❌ Pool Contract Guard FAILED:\n");
    for (const e of errors) console.error(`  • ${e}`);
    console.error(`
HOW TO FIX:
  1. Ensure JOB_DEFINITIONS in ${JOB_MAP_PATH} uses only "default" or "prebuild" pools.
  2. Update ${CONTRACT_PATH} to match: deno run -A scripts/update-pool-contract.ts
  3. Ensure job_type_policies in DB matches the contract.
  4. If changing a pool, create a backfill migration for in-flight jobs.
  
  IMPORTANT: "core" and "content" are legacy pools — replace with "default".
`);
    Deno.exit(1);
  }

  console.log(`✅ Pool Contract Guard passed (${Object.keys(contract).length} contract entries, ${Object.keys(jobDefs).length} definitions verified).`);
}

await main();
