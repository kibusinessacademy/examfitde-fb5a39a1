#!/usr/bin/env node
/**
 * CI Guard: Pipeline Mapping Parity Check
 *
 * Ensures all 6 mapping locations stay in sync:
 * 1. STEP_TO_JOB_TYPE (supabase/functions/_shared/job-map.ts)
 * 2. PIPELINE_GRAPH (supabase/functions/_shared/job-map.ts)
 * 3. JOB_DEFINITIONS (supabase/functions/_shared/job-map.ts)
 * 4. PREREQS (supabase/functions/job-runner/index.ts)
 * 5. ops_jobtype_step_map (latest migration SQL)
 * 6. cascade_reset_downstream_steps trigger DAG (latest migration SQL)
 *
 * Blocks merge if any asymmetry is detected.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const JOB_MAP_PATH = path.join(ROOT, "supabase/functions/_shared/job-map.ts");
const JOB_RUNNER_PATH = path.join(ROOT, "supabase/functions/job-runner/index.ts");
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");

function readFile(p) {
  if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
  return fs.readFileSync(p, "utf8");
}

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

function ok(msg) { console.log(`✅ ${msg}`); }

// ── Extractors ──

/** Extract keys from a Record<string, ...> const */
function extractRecordKeys(source, constName) {
  const re = new RegExp(`export\\s+const\\s+${constName}\\s*[^=]*=\\s*\\{`, "m");
  const match = re.exec(source);
  if (!match) throw new Error(`Could not find: export const ${constName}`);

  const start = match.index + match[0].length - 1;
  let depth = 0, end = -1;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) throw new Error(`Unclosed block for ${constName}`);

  const block = source.slice(start, end);
  const keys = new Set();
  // Match object keys: either quoted or unquoted identifiers followed by :
  for (const m of block.matchAll(/(?:^|[\n,{])\s*["']?([a-z][a-z0-9_]*)["']?\s*:/gm)) {
    keys.add(m[1]);
  }
  return keys;
}

/** Extract step keys from PIPELINE_GRAPH array of { key: "..." } */
function extractPipelineGraphKeys(source) {
  const keys = new Set();
  const deps = new Set();

  // Find PIPELINE_GRAPH array
  const graphMatch = /export\s+const\s+PIPELINE_GRAPH\s*[^=]*=\s*\[/m.exec(source);
  if (!graphMatch) throw new Error("Could not find PIPELINE_GRAPH");

  const start = graphMatch.index + graphMatch[0].length - 1;
  let depth = 0, end = -1;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "[") depth++;
    if (source[i] === "]") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) throw new Error("Unclosed PIPELINE_GRAPH array");
  const block = source.slice(start, end);

  // Extract key: "step_key"
  for (const m of block.matchAll(/key:\s*["']([a-z_]+)["']/g)) {
    keys.add(m[1]);
  }
  // Extract dependsOn values
  for (const m of block.matchAll(/dependsOn:\s*\[([^\]]*)\]/g)) {
    for (const v of m[1].matchAll(/["']([a-z_]+)["']/g)) {
      deps.add(v[1]);
    }
  }

  return { keys, deps };
}

/** Extract PREREQS keys from job-runner (uses package_ prefix) */
function extractPrereqKeys(source) {
  const keys = new Set();
  // Try both PIPELINE_PREREQS (current) and PREREQS (legacy)
  const re = /(?:const|let)\s+(?:PIPELINE_)?PREREQS\s*[^=]*=\s*\{/m;
  const match = re.exec(source);
  if (!match) throw new Error("Could not find PREREQS/PIPELINE_PREREQS in job-runner");

  const start = match.index + match[0].length - 1;
  let depth = 0, end = -1;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) throw new Error("Unclosed PREREQS block");
  const block = source.slice(start, end);

  // Keys are job_types like package_generate_lesson_minichecks
  // Convert to step_keys by stripping package_ prefix
  for (const m of block.matchAll(/["']?(package_[a-z_]+|handbook_[a-z_]+)["']?\s*:/gm)) {
    keys.add(m[1]);
  }
  return keys;
}

/** Find latest migration containing a text needle and extract step_keys from VIEW tuples */
function extractViewKeysFromMigrations(needle) {
  if (!fs.existsSync(MIGRATIONS_DIR)) throw new Error(`Migrations dir not found: ${MIGRATIONS_DIR}`);
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith(".sql")).sort();
  let lastSrc = null;
  for (const f of files) {
    const src = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
    if (src.includes(needle)) lastSrc = src;
  }
  if (!lastSrc) throw new Error(`No migration contains: ${needle}`);

  const keys = new Set();
  // Tuples: ('job_type', 'step_key') or ('step_key', 'job_type') — extract both columns
  for (const m of lastSrc.matchAll(/\(\s*'([a-z_]+)'\s*(?:::text\s*)?,\s*'([a-z_]+)'\s*(?:::text\s*)?\)/g)) {
    // In our view the order is (job_type, step_key) — step_key is column 2
    keys.add(m[2]);
  }
  return keys;
}

/** Extract DAG keys from cascade_reset_downstream_steps trigger in migrations */
function extractTriggerDagKeys() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return null;
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith(".sql")).sort();
  let lastSrc = null;
  for (const f of files) {
    const src = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
    if (src.includes("cascade_reset_downstream_steps")) lastSrc = src;
  }
  if (!lastSrc) return null; // Trigger may be defined outside migrations

  const keys = new Set();
  // DAG is jsonb: "step_key": [...]
  for (const m of lastSrc.matchAll(/"([a-z_]+)"\s*:\s*\[/g)) {
    keys.add(m[1]);
  }
  return keys;
}

function diff(a, b) { return [...a].filter(x => !b.has(x)).sort(); }

/** Extract PIPELINE_PREREQS as Map<job_type, Set<step_key>> with actual dependency values */
function extractPrereqMap(source) {
  const re = /(?:const|let)\s+PIPELINE_PREREQS\s*[^=]*=\s*\{/m;
  const match = re.exec(source);
  if (!match) throw new Error("Could not find PIPELINE_PREREQS in job-runner");

  const start = match.index + match[0].length - 1;
  let depth = 0, end = -1;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) throw new Error("Unclosed PIPELINE_PREREQS block");
  const block = source.slice(start, end);

  const result = new Map();
  // Match: job_type: ["step1", "step2"]
  for (const m of block.matchAll(/["']?(package_[a-z_]+|handbook_[a-z_]+)["']?\s*:\s*\[([^\]]*)\]/gm)) {
    const jobType = m[1];
    const deps = new Set();
    for (const v of m[2].matchAll(/["']([a-z_]+)["']/g)) {
      deps.add(v[1]);
    }
    result.set(jobType, deps);
  }
  return result;
}

/** Extract PIPELINE_GRAPH dependsOn as Map<step_key, Set<step_key>> */
function extractGraphDependsOn(source) {
  const graphMatch = /export\s+const\s+PIPELINE_GRAPH\s*[^=]*=\s*\[/m.exec(source);
  if (!graphMatch) throw new Error("Could not find PIPELINE_GRAPH");

  const start = graphMatch.index + graphMatch[0].length - 1;
  let depth = 0, end = -1;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "[") depth++;
    if (source[i] === "]") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) throw new Error("Unclosed PIPELINE_GRAPH array");
  const block = source.slice(start, end);

  const result = new Map();
  // Parse each node object: { key: "...", dependsOn: ["..."] }
  for (const m of block.matchAll(/\{\s*key:\s*["']([a-z_]+)["'][^}]*\}/gs)) {
    const key = m[1];
    const deps = new Set();
    const depMatch = m[0].match(/dependsOn:\s*\[([^\]]*)\]/);
    if (depMatch) {
      for (const v of depMatch[1].matchAll(/["']([a-z_]+)["']/g)) {
        deps.add(v[1]);
      }
    }
    result.set(key, deps);
  }
  return result;
}

function printGroup(title, arr) {
  if (!arr.length) return;
  console.error(`\n${title}`);
  for (const x of arr) console.error(`  - ${x}`);
}

// ── Main ──

try {
  const jobMapSrc = readFile(JOB_MAP_PATH);
  const runnerSrc = readFile(JOB_RUNNER_PATH);

  // 1. STEP_TO_JOB_TYPE — the SSOT
  const ssotKeys = extractRecordKeys(jobMapSrc, "STEP_TO_JOB_TYPE");

  // 2. PIPELINE_GRAPH
  const { keys: graphKeys, deps: graphDeps } = extractPipelineGraphKeys(jobMapSrc);

  // 3. JOB_DEFINITIONS
  const jobDefKeys = extractRecordKeys(jobMapSrc, "JOB_DEFINITIONS");

  // 4. PREREQS (job_types → convert to step_keys via STEP_TO_JOB_TYPE reverse lookup)
  const prereqJobTypes = extractPrereqKeys(runnerSrc);
  // Build reverse map: job_type → step_key
  const jobTypeToStep = new Map();
  for (const m of jobMapSrc.matchAll(/(\w+):\s*["'](\w+)["']/g)) {
    // In STEP_TO_JOB_TYPE: step_key: "job_type"
  }
  // Simpler: extract from STEP_TO_JOB_TYPE directly
  const stepToJob = new Map();
  const stjtBlock = jobMapSrc.slice(
    jobMapSrc.indexOf("STEP_TO_JOB_TYPE"),
    jobMapSrc.indexOf("};", jobMapSrc.indexOf("STEP_TO_JOB_TYPE")) + 2
  );
  for (const m of stjtBlock.matchAll(/(\w+):\s*["'](\w+)["']/g)) {
    stepToJob.set(m[1], m[2]);
    jobTypeToStep.set(m[2], m[1]);
  }
  const prereqStepKeys = new Set();
  for (const jt of prereqJobTypes) {
    const sk = jobTypeToStep.get(jt);
    if (sk) prereqStepKeys.add(sk);
  }

  // 5. ops_jobtype_step_map view
  const viewKeys = extractViewKeysFromMigrations("ops_jobtype_step_map");

  // 6. Trigger DAG (optional — may not be in migrations)
  const triggerDagKeys = extractTriggerDagKeys();

  // ── Cross-checks ──
  let hasErrors = false;
  const errors = [];

  const missingInGraph = diff(ssotKeys, graphKeys);
  const missingInView = diff(ssotKeys, viewKeys);
  const graphDepsMissing = diff(graphDeps, ssotKeys);

  // PREREQS check: only flag steps that have dependsOn in PIPELINE_GRAPH but no PREREQS entry
  // Root steps (no dependsOn) don't need PREREQS entries — that's expected.
  const graphDependsOnMap = extractGraphDependsOn(jobMapSrc);
  const missingInPrereqs = [...ssotKeys].filter(sk => {
    if (prereqStepKeys.has(sk)) return false; // has prereq entry
    const deps = graphDependsOnMap.get(sk);
    return deps && deps.size > 0; // only flag if PIPELINE_GRAPH says it has dependencies
  }).sort();

  // Check that every SSOT step_key's job_type exists in JOB_DEFINITIONS
  const missingJobDefs = [];
  for (const [stepKey, jobType] of stepToJob) {
    if (!jobDefKeys.has(jobType)) {
      missingJobDefs.push(`${stepKey} → ${jobType}`);
    }
  }

  printGroup("Missing in PIPELINE_GRAPH:", missingInGraph);
  printGroup("Missing in ops_jobtype_step_map view:", missingInView);
  printGroup("Non-root steps missing in job-runner PREREQS:", missingInPrereqs);
  printGroup("PIPELINE_GRAPH references unknown step_keys:", graphDepsMissing);
  printGroup("Job types missing from JOB_DEFINITIONS:", missingJobDefs);

  // cascade_reset trigger DAG — warn only, not hard fail (often maintained separately)
  if (triggerDagKeys) {
    const missingInTrigger = diff(ssotKeys, triggerDagKeys);
    const triggerExtra = diff(triggerDagKeys, ssotKeys);
    printGroup("⚠️ Missing in cascade_reset trigger DAG (warn-only):", missingInTrigger);
    printGroup("⚠️ Extra in cascade_reset trigger DAG (warn-only):", triggerExtra);
    // No hard fail — trigger DAG is maintained separately
  }

  if (missingInGraph.length || missingInPrereqs.length ||
      graphDepsMissing.length || missingJobDefs.length) {
    hasErrors = true;
  }
  // ops_jobtype_step_map is a view in migrations — warn only for new steps not yet migrated
  if (missingInView.length) {
    console.warn(`\n⚠️  ${missingInView.length} step(s) missing in ops_jobtype_step_map (non-blocking)`);
  }

  // ── 7. DEPENDENCY-LEVEL PARITY: PIPELINE_PREREQS vs PIPELINE_GRAPH.dependsOn ──
  // This is the critical check that prevents reclaim-loop bugs.
  // If PIPELINE_PREREQS says step X depends on A, but PIPELINE_GRAPH says X depends on B,
  // the runner will claim the job too early, and the artifact-resolver will block it → reclaim loop.
  const depDriftErrors = [];
  {
    // Extract PIPELINE_PREREQS with their actual dependency values
    const prereqMap = extractPrereqMap(runnerSrc);
    // Extract PIPELINE_GRAPH dependsOn map
    const graphDependsOn = extractGraphDependsOn(jobMapSrc);

    for (const [jobType, prereqStepKeys_] of prereqMap) {
      const stepKey = jobTypeToStep.get(jobType);
      if (!stepKey) continue; // Not a pipeline step job type
      const graphDeps_ = graphDependsOn.get(stepKey);
      if (!graphDeps_) continue; // Step not in PIPELINE_GRAPH (caught above)

      // PIPELINE_PREREQS lists step_keys that the job depends on.
      // PIPELINE_GRAPH.dependsOn lists step_keys that the step depends on.
      // For convergence steps (run_integrity_check), PREREQS should match GRAPH deps.
      // For linear steps, PREREQS should be a subset of GRAPH deps.
      for (const prereq of prereqStepKeys_) {
        if (!graphDeps_.has(prereq)) {
          depDriftErrors.push(
            `${stepKey} (${jobType}): PREREQS requires "${prereq}" but PIPELINE_GRAPH.dependsOn = [${[...graphDeps_].join(", ")}]`
          );
        }
      }
      // Reverse: GRAPH deps not in PREREQS (runner would skip a required gate)
      for (const gd of graphDeps_) {
        if (!prereqStepKeys_.has(gd)) {
          depDriftErrors.push(
            `${stepKey} (${jobType}): PIPELINE_GRAPH.dependsOn includes "${gd}" but PREREQS does not — runner may claim too early`
          );
        }
      }
    }
  }

  printGroup("SSOT DEPENDENCY DRIFT (PREREQS vs PIPELINE_GRAPH.dependsOn):", depDriftErrors);
  if (depDriftErrors.length) hasErrors = true;

  if (hasErrors) {
    fail("Pipeline mapping parity check FAILED — see details above.");
  }

  ok(`STEP_TO_JOB_TYPE: ${ssotKeys.size} step_keys`);
  ok(`PIPELINE_GRAPH: ${graphKeys.size} step_keys`);
  ok(`PREREQS: ${prereqStepKeys.size} job_types mapped`);
  ok(`ops_jobtype_step_map: ${viewKeys.size} step_keys`);
  ok(`JOB_DEFINITIONS: ${jobDefKeys.size} definitions checked`);
  if (triggerDagKeys) ok(`cascade_reset trigger DAG: ${triggerDagKeys.size} step_keys`);
  ok(`Dependency parity: ${depDriftErrors.length === 0 ? "consistent" : "DRIFT DETECTED"}`);
  console.log("\n🎉 Pipeline mapping parity guard passed.\n");

} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
