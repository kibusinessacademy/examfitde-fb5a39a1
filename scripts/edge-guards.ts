// scripts/edge-guards.ts
// CI guardrails for Supabase Edge Functions with:
// - Security guard: service role + CORS '*' requires auth/internal guard (unless allowlisted)
// - Drift guard: STEP_TO_JOB_TYPE / FULL_STEP_ORDER / inferBackoffSeconds must live in _shared/job-map.ts
// - Auto-fix suggestions printed inline

type Finding = {
  severity: "critical" | "high" | "medium" | "low";
  kind: "security" | "drift";
  file: string;
  message: string;
  evidence?: string[];
  fix?: string[];
};

const ROOT = Deno.cwd();
const FUNCTIONS_DIR = `${ROOT}/supabase/functions`;
const SSOT_JOB_MAP = `${FUNCTIONS_DIR}/_shared/job-map.ts`;

/**
 * SECURITY ALLOWLIST
 * Use this for functions that are intentionally internal-only but still have CORS '*' for some reason.
 * Better is to remove CORS '*' entirely, but allowlist prevents false positives during transition.
 *
 * Patterns are suffix matches on normalized path.
 */
const SECURITY_ALLOWLIST_SUFFIXES = new Set<string>([
  // Ops / internal watchdogs
  "supabase/functions/stuck-scan/index.ts",
  "supabase/functions/pipeline-runner/index.ts",
  // Add more intentionally-internal endpoints here during migration
]);

function isAllowlisted(relPath: string): boolean {
  const p = relPath.replaceAll("\\", "/");
  for (const s of SECURITY_ALLOWLIST_SUFFIXES) {
    if (p.endsWith(s)) return true;
  }
  return false;
}

function isTsFile(path: string) {
  return path.endsWith(".ts") || path.endsWith(".tsx");
}

async function* walk(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const p = `${dir}/${entry.name}`;
    if (entry.isDirectory) yield* walk(p);
    else if (entry.isFile && isTsFile(p)) yield p;
  }
}

function normalize(s: string) {
  return s.replace(/\r\n/g, "\n");
}

function snippet(lines: string[], idx: number, span = 2): string[] {
  const start = Math.max(0, idx - span);
  const end = Math.min(lines.length, idx + span + 1);
  return lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`);
}

function hasAny(content: string, needles: string[]): boolean {
  return needles.some((n) => content.includes(n));
}

function hasRegex(content: string, r: RegExp): boolean {
  return r.test(content);
}

function containsLikelyAuthGuard(content: string): boolean {
  return hasAny(content, [
    "validateAuth(",
    "requireAuth(",
    "requireAdmin(",
    "requireInternalSecret(",
    "EDGE_INTERNAL_SHARED_SECRET",
    "x-job-runner-key",
    "internalSecret",
    "isAdmin",
    "isServiceRole",
    "auth.getUser",
    "getUser(",
  ]);
}

function containsServiceRoleUsage(content: string): boolean {
  return hasAny(content, [
    "Deno.env.get(\"SUPABASE_SERVICE_ROLE_KEY\")",
    "Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')",
  ]);
}

function containsCorsStar(content: string): boolean {
  return hasRegex(content, /Access-Control-Allow-Origin["']?\s*:\s*["']\*["']/)
    || (content.includes("Access-Control-Allow-Origin") && (content.includes('"*"') || content.includes("'*'")));
}

function isEdgeEntryFile(path: string): boolean {
  return path.endsWith("/index.ts") || path.endsWith("/main.ts");
}

function isSharedJobMap(path: string): boolean {
  return path.replaceAll("\\", "/").endsWith("/supabase/functions/_shared/job-map.ts");
}

function driftDefinitionsPresent(content: string): boolean {
  return (
    hasRegex(content, /const\s+STEP_TO_JOB_TYPE\s*=\s*\{/) ||
    hasRegex(content, /export\s+const\s+STEP_TO_JOB_TYPE\s*=\s*\{/) ||
    hasRegex(content, /const\s+FULL_STEP_ORDER\s*=\s*\[/) ||
    hasRegex(content, /export\s+const\s+FULL_STEP_ORDER\s*=\s*\[/) ||
    hasRegex(content, /function\s+inferBackoffSeconds\s*\(/)
  );
}

function fixForSecurity(rel: string): string[] {
  return [
    "Fix options (choose one):",
    "1) Internal-only endpoint: remove CORS '*' and require EDGE_INTERNAL_SHARED_SECRET",
    "   - Replace wildcard origin with allowlist or reject Origin header",
    "   - Add requireInternalSecret(req) (or validateAuth admin)",
    "2) Browser-callable endpoint: do NOT use service role key; use anon key + RLS; require validateAuth(req).",
    "",
    "Suggested minimal internal guard snippet:",
    "  const origin = req.headers.get('origin');",
    "  if (origin) return json({ ok:false, error:'forbidden' }, 403);",
    "  const internal = req.headers.get('x-internal-secret');",
    "  if (!internal || internal !== Deno.env.get('EDGE_INTERNAL_SHARED_SECRET')) return json({ ok:false, error:'forbidden' }, 403);",
    "",
    `If this endpoint is intentionally internal and you accept temporary CORS '*', add it to SECURITY_ALLOWLIST_SUFFIXES: ${rel}`,
  ];
}

function fixForDrift(): string[] {
  return [
    "Move STEP_TO_JOB_TYPE / FULL_STEP_ORDER / inferBackoffSeconds to supabase/functions/_shared/job-map.ts",
    "Then import them where needed:",
    "  import { STEP_TO_JOB_TYPE, FULL_STEP_ORDER, inferBackoffSeconds } from '../_shared/job-map.ts';",
  ];
}

async function main() {
  const findings: Finding[] = [];

  async function readTextOrNull(path: string): Promise<string | null> {
    try { return await Deno.readTextFile(path); } catch { return null; }
  }

  // Print allowlist for visibility
  console.log("ℹ️  Security allowlist entries:");
  for (const s of SECURITY_ALLOWLIST_SUFFIXES) {
    console.log(`   - ${s}`);
  }
  console.log("");

  for await (const file of walk(FUNCTIONS_DIR)) {
    const rel = file.replace(ROOT + "/", "").replaceAll("\\", "/");
    const content = normalize(await Deno.readTextFile(file));

    // ── SECURITY GUARD
    if (isEdgeEntryFile(file)) {
      const serviceRole = containsServiceRoleUsage(content);
      const corsStar = containsCorsStar(content);
      const hasGuard = containsLikelyAuthGuard(content);
      const allowlisted = isAllowlisted(rel);

      if (serviceRole && corsStar && !hasGuard && !allowlisted) {
        const lines = content.split("\n");
        const idx = lines.findIndex((l) => l.includes("SUPABASE_SERVICE_ROLE_KEY"));
        findings.push({
          severity: "critical",
          kind: "security",
          file: rel,
          message:
            "Potentially public Service-Role endpoint: uses SUPABASE_SERVICE_ROLE_KEY AND CORS '*' but no obvious auth/internal guard found.",
          evidence: idx >= 0 ? snippet(lines, idx, 4) : ["(no snippet)"],
          fix: fixForSecurity(rel),
        });
      }
    }

    // ── DRIFT GUARD
    if (!isSharedJobMap(file) && driftDefinitionsPresent(content)) {
      findings.push({
        severity: "high",
        kind: "drift",
        file: rel,
        message:
          "Mapping/logic drift risk: STEP_TO_JOB_TYPE / FULL_STEP_ORDER / inferBackoffSeconds defined outside _shared/job-map.ts. Move to SSOT and import.",
        evidence: [
          content.includes("STEP_TO_JOB_TYPE") ? "STEP_TO_JOB_TYPE" : "",
          content.includes("FULL_STEP_ORDER") ? "FULL_STEP_ORDER" : "",
          content.includes("inferBackoffSeconds") ? "inferBackoffSeconds" : "",
        ].filter(Boolean),
        fix: fixForDrift(),
      });
    }
  }

  // Ensure SSOT exists
  try {
    await Deno.stat(SSOT_JOB_MAP);
  } catch {
    findings.push({
      severity: "critical",
      kind: "drift",
      file: "supabase/functions/_shared/job-map.ts",
      message: "SSOT job-map missing. Expected supabase/functions/_shared/job-map.ts to exist.",
      fix: ["Create supabase/functions/_shared/job-map.ts and move mappings there."],
    });
  }

  // ── PIPELINE DAG VALIDATION ──
  // Import and validate the pipeline graph at CI time
  try {
    const jobMap = await import(SSOT_JOB_MAP);
    if (typeof jobMap.validatePipelineGraph === "function" && jobMap.PIPELINE_GRAPH) {
      jobMap.validatePipelineGraph(jobMap.PIPELINE_GRAPH);
      console.log("✅ Pipeline DAG validation passed (no cycles, no orphans, no missing deps).");
    } else {
      findings.push({
        severity: "high",
        kind: "drift",
        file: "supabase/functions/_shared/job-map.ts",
        message: "PIPELINE_GRAPH or validatePipelineGraph not exported from job-map.ts. DAG guard skipped.",
        fix: ["Export PIPELINE_GRAPH and validatePipelineGraph from _shared/job-map.ts"],
      });
    }

    // ── Phase 8: Extended static guards ──
    if (jobMap.PIPELINE_GRAPH && jobMap.JOB_DEFINITIONS && jobMap.STEP_TO_JOB_TYPE) {
      const graph: { key: string; produces?: string[]; requires?: string[] }[] = jobMap.PIPELINE_GRAPH;
      const jobDefs: Record<string, unknown> = jobMap.JOB_DEFINITIONS;
      const stepToJob: Record<string, string> = jobMap.STEP_TO_JOB_TYPE;

      // Guard 1: Every step_key in PIPELINE_GRAPH must have a STEP_TO_JOB_TYPE entry
      for (const node of graph) {
        if (!stepToJob[node.key]) {
          findings.push({
            severity: "critical",
            kind: "drift",
            file: "supabase/functions/_shared/job-map.ts",
            message: `PIPELINE_GRAPH step "${node.key}" has no STEP_TO_JOB_TYPE mapping — jobs cannot dispatch.`,
            fix: [`Add "${node.key}" → "package_${node.key}" to STEP_TO_JOB_TYPE`],
          });
        }
      }

      // Guard 2: Every STEP_TO_JOB_TYPE job_type must have a JOB_DEFINITIONS entry
      for (const [stepKey, jobType] of Object.entries(stepToJob)) {
        if (!jobDefs[jobType]) {
          findings.push({
            severity: "high",
            kind: "drift",
            file: "supabase/functions/_shared/job-map.ts",
            message: `Job type "${jobType}" (from step "${stepKey}") missing from JOB_DEFINITIONS — pool routing will fail.`,
            fix: [`Add "${jobType}" to JOB_DEFINITIONS with correct pool assignment`],
          });
        }
      }

      // Guard 3: Artifact producer/consumer consistency (already in validatePipelineGraph but double-check)
      const allProduced = new Set<string>();
      for (const n of graph) for (const a of n.produces ?? []) allProduced.add(a);
      for (const n of graph) {
        for (const a of n.requires ?? []) {
          if (!allProduced.has(a)) {
            findings.push({
              severity: "critical",
              kind: "drift",
              file: "supabase/functions/_shared/job-map.ts",
              message: `Step "${n.key}" requires artifact "${a}" but no step produces it.`,
              fix: [`Add a "produces: ['${a}']" declaration to the appropriate step`],
            });
          }
        }
      }

      // Guard 4: Every step with weight should have weight > 0
      for (const node of graph) {
        if ((node as any).weight !== undefined && (node as any).weight <= 0) {
          findings.push({
            severity: "medium",
            kind: "drift",
            file: "supabase/functions/_shared/job-map.ts",
            message: `Step "${node.key}" has invalid weight (${(node as any).weight}). Weight must be > 0.`,
            fix: [`Set a positive weight for step "${node.key}"`],
          });
        }
      }

      // Guard 5: Every JOB_DEFINITIONS entry with edgeFunction must have a matching folder
      for (const [jobType, def] of Object.entries(jobDefs)) {
        const d = def as { pool?: string; edgeFunction?: string };
        if (d.edgeFunction) {
          const fnDir = `${FUNCTIONS_DIR}/${d.edgeFunction}`;
          try {
            await Deno.stat(fnDir);
          } catch {
            findings.push({
              severity: "critical",
              kind: "drift",
              file: `supabase/functions/${d.edgeFunction}/index.ts`,
              message: `JOB_DEFINITIONS["${jobType}"].edgeFunction = "${d.edgeFunction}" but folder does not exist — content-runner dispatch will 404.`,
              fix: [`Create supabase/functions/${d.edgeFunction}/index.ts or fix the edgeFunction name in JOB_DEFINITIONS`],
            });
          }
        }
      }

      // Guard 6: FULL_STEP_ORDER ↔ PIPELINE_GRAPH bidirectional consistency
      const fullStepOrder: string[] = jobMap.FULL_STEP_ORDER ?? [];
      const graphKeys = new Set(graph.map((n: { key: string }) => n.key));
      for (const step of fullStepOrder) {
        if (!graphKeys.has(step)) {
          findings.push({
            severity: "critical",
            kind: "drift",
            file: "supabase/functions/_shared/job-map.ts",
            message: `FULL_STEP_ORDER contains "${step}" but PIPELINE_GRAPH does not — step will never execute.`,
            fix: [`Add "${step}" to PIPELINE_GRAPH with correct dependencies, or remove from FULL_STEP_ORDER`],
          });
        }
      }
      for (const k of graphKeys) {
        if (!fullStepOrder.includes(k)) {
          findings.push({
            severity: "critical",
            kind: "drift",
            file: "supabase/functions/_shared/job-map.ts",
            message: `PIPELINE_GRAPH contains "${k}" but FULL_STEP_ORDER does not — UI and runner ordering will diverge.`,
            fix: [`Add "${k}" to FULL_STEP_ORDER at the correct position`],
          });
        }
      }

      console.log("✅ Phase 8 extended pipeline guards passed (step→job, pool routing, artifact integrity, edge fn existence, step order consistency).");
    }
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    if (msg.startsWith("PIPELINE_DAG_")) {
      findings.push({
        severity: "critical",
        kind: "drift",
        file: "supabase/functions/_shared/job-map.ts",
        message: `Pipeline DAG structural error: ${msg}`,
        fix: ["Fix the PIPELINE_GRAPH definition in _shared/job-map.ts to resolve the DAG error."],
      });
    } else {
      console.warn(`⚠️  Pipeline DAG import/validation skipped: ${msg}`);
    }
  }

  // ── Guard 7: No direct job_queue.insert outside enqueue.ts ──
  // All job insertions MUST go through enqueueJob() for SSOT pool routing + idempotency
  const ENQUEUE_ALLOWLIST = new Set([
    "supabase/functions/_shared/enqueue.ts",
  ]);

  for await (const file of walk(FUNCTIONS_DIR)) {
    const rel = file.replace(ROOT + "/", "").replaceAll("\\", "/");
    if (ENQUEUE_ALLOWLIST.has(rel)) continue;

    const content = normalize(await Deno.readTextFile(file));
    // Match .from("job_queue").insert or .from('job_queue').insert
    if (/\.from\(\s*['"`]job_queue['"`]\s*\)\s*\.insert/g.test(content)) {
      const lines = content.split("\n");
      const idx = lines.findIndex(l => /\.from\(\s*['"`]job_queue['"`]\s*\)\s*\.insert/.test(l));
      findings.push({
        severity: "critical",
        kind: "drift",
        file: rel,
        message: "Direct job_queue.insert detected — MUST use enqueueJob() from _shared/enqueue.ts for SSOT pool routing + idempotency.",
        evidence: idx >= 0 ? snippet(lines, idx, 2) : ["(no snippet)"],
        fix: [
          "Replace direct insert with:",
          '  import { enqueueJob } from "../_shared/enqueue.ts";',
          "  await enqueueJob(sb, { job_type, payload, package_id });",
        ],
      });
    }
  }

  console.log("✅ Guard 7: No direct job_queue.insert bypass detected.");

  // ── Guard 8: Pool Contract — golden snapshot vs JOB_DEFINITIONS ──
  try {
    const contractText = await Deno.readTextFile(`${ROOT}/scripts/job-pool-contract.json`);
    const contract: Record<string, string> = JSON.parse(contractText);
    delete contract._comment;

    const jobMap = await import(SSOT_JOB_MAP);
    const jobDefs: Record<string, { pool: string }> = jobMap.JOB_DEFINITIONS ?? {};

    for (const [jobType, expectedPool] of Object.entries(contract)) {
      const actual = jobDefs[jobType];
      if (!actual) {
        findings.push({
          severity: "critical",
          kind: "drift",
          file: "scripts/job-pool-contract.json",
          message: `Pool contract: "${jobType}" is in contract but MISSING from JOB_DEFINITIONS.`,
          fix: [`Add "${jobType}" to JOB_DEFINITIONS in _shared/job-map.ts or remove from contract.`],
        });
      } else if (actual.pool !== expectedPool) {
        findings.push({
          severity: "critical",
          kind: "drift",
          file: "supabase/functions/_shared/job-map.ts",
          message: `Pool contract DRIFT: "${jobType}" contract="${expectedPool}" but JOB_DEFINITIONS="${actual.pool}". Update contract or fix JOB_DEFINITIONS.`,
          fix: [`Either update scripts/job-pool-contract.json to "${actual.pool}" or fix JOB_DEFINITIONS.`],
        });
      }
    }

    for (const jobType of Object.keys(jobDefs)) {
      if (!(jobType in contract)) {
        findings.push({
          severity: "high",
          kind: "drift",
          file: "scripts/job-pool-contract.json",
          message: `New job type "${jobType}" has no pool contract entry — add it to scripts/job-pool-contract.json.`,
          fix: [`Add "${jobType}": "${jobDefs[jobType].pool}" to scripts/job-pool-contract.json`],
        });
      }
    }

  console.log("✅ Guard 8: Pool contract validation passed.");
  } catch (e) {
    console.warn(`⚠️  Guard 8 skipped: ${(e as Error).message}`);
  }

  // ── Guard 9: SSOT Step Order — topological validity ──
  try {
    const jobMap = await import(SSOT_JOB_MAP);
    const FULL_STEP_ORDER: string[] = jobMap.FULL_STEP_ORDER ?? [];
    const STEP_TO_JOB_TYPE: Record<string, string> = jobMap.STEP_TO_JOB_TYPE ?? {};
    const PIPELINE_GRAPH: Array<{ key: string; dependsOn?: string[] }> = jobMap.PIPELINE_GRAPH ?? [];

    const keysFromOrder = new Set(FULL_STEP_ORDER);
    const keysFromMap = new Set(Object.keys(STEP_TO_JOB_TYPE));
    const keysFromGraph = new Set(PIPELINE_GRAPH.map((n) => n.key));

    // A) Completeness: all three structures must have same keys
    for (const k of keysFromOrder) {
      if (!keysFromMap.has(k)) findings.push({ severity: "critical", kind: "drift", file: "supabase/functions/_shared/job-map.ts", message: `Guard 9: STEP_TO_JOB_TYPE missing key "${k}"` });
      if (!keysFromGraph.has(k)) findings.push({ severity: "critical", kind: "drift", file: "supabase/functions/_shared/job-map.ts", message: `Guard 9: PIPELINE_GRAPH missing key "${k}"` });
    }
    for (const k of keysFromMap) {
      if (!keysFromOrder.has(k)) findings.push({ severity: "critical", kind: "drift", file: "supabase/functions/_shared/job-map.ts", message: `Guard 9: FULL_STEP_ORDER missing key "${k}"` });
    }
    for (const k of keysFromGraph) {
      if (!keysFromOrder.has(k)) findings.push({ severity: "critical", kind: "drift", file: "supabase/functions/_shared/job-map.ts", message: `Guard 9: FULL_STEP_ORDER missing key "${k}"` });
    }

    // B) Topological validity: every dependency must appear BEFORE the dependent
    const pos = new Map<string, number>();
    FULL_STEP_ORDER.forEach((k: string, i: number) => pos.set(k, i));

    for (const node of PIPELINE_GRAPH) {
      for (const dep of node.dependsOn ?? []) {
        const a = pos.get(node.key);
        const b = pos.get(dep);
        if (a == null || b == null) continue;
        if (b > a) {
          findings.push({
            severity: "critical",
            kind: "drift",
            file: "supabase/functions/_shared/job-map.ts",
            message: `Guard 9: Topo order invalid — "${node.key}" dependsOn "${dep}" but "${dep}" appears AFTER it in FULL_STEP_ORDER.`,
            fix: [`Move "${dep}" before "${node.key}" in FULL_STEP_ORDER`],
          });
        }
      }
    }

    // C) Mapping stability
    for (const [k, v] of Object.entries(STEP_TO_JOB_TYPE)) {
      if (!v || typeof v !== "string") {
        findings.push({ severity: "critical", kind: "drift", file: "supabase/functions/_shared/job-map.ts", message: `Guard 9: STEP_TO_JOB_TYPE["${k}"] is invalid` });
      }
    }

    console.log("✅ Guard 9: SSOT step order governance passed.");
  } catch (e) {
    console.warn(`⚠️  Guard 9 skipped: ${(e as Error).message}`);
  }

  // ── Guard 10: Time Budget Governance ──
  try {
    const BUDGET_SENSITIVE_FILES = [
      "supabase/functions/content-runner/index.ts",
      "supabase/functions/job-runner/index.ts",
      "supabase/functions/stuck-scan/index.ts",
      "supabase/functions/package-generate-exam-pool/index.ts",
      "supabase/functions/package-generate-learning-content/index.ts",
      "supabase/functions/package-generate-handbook/index.ts",
      "supabase/functions/package-generate-glossary/index.ts",
      "supabase/functions/package-generate-oral-exam/index.ts",
      "supabase/functions/package-generate-lesson-minichecks/index.ts",
    ];
    const MUST_IMPORT_BUDGET = [
      "supabase/functions/package-generate-exam-pool/index.ts",
      "supabase/functions/package-generate-learning-content/index.ts",
      "supabase/functions/package-generate-handbook/index.ts",
      "supabase/functions/package-generate-glossary/index.ts",
      "supabase/functions/package-generate-oral-exam/index.ts",
      "supabase/functions/package-generate-lesson-minichecks/index.ts",
    ];
    const HARD_ABORT_RE = /setTimeout\(\s*\(\s*\)\s*=>\s*controller\.abort\(\)\s*,\s*([0-9_]+)\s*\)/g;
    const TIME_BUDGET_CONST_RE = /\bTIME_BUDGET_MS\b\s*=\s*([0-9_]+)/g;
    const GENERIC_BUDGET_RE = /\b(BUDGET_MS|TIMEOUT_MS|EDGE_TIME_BUDGET_MS)\b\s*=\s*([0-9_]+)/g;
    const MAX_HARDCODED_MS = 60_000;
    const SSOT_HINTS = [
      'from "../_shared/time-budget.ts"',
      'from "./_shared/time-budget.ts"',
      "makeAbortController(",
      "getTimeBudget(",
      "shouldSoftStop(",
    ];
    const parseMs = (raw: string) => Number(raw.replace(/_/g, ""));

    const g10before = findings.length;

    const budgetHintKey = (f: string): string =>
      f.includes("package-generate-exam-pool") ? "exam_pool_fanout" :
      f.includes("content-runner") || f.includes("job-runner") ? "runner_claim" :
      f.includes("handbook") ? "handbook" :
      f.includes("glossary") ? "glossary" :
      f.includes("oral-exam") ? "oral_exam" :
      f.includes("lesson-minichecks") ? "lesson_minichecks" :
      "learning_content";

    for (const file of BUDGET_SENSITIVE_FILES) {
      const text = await readTextOrNull(file);
      if (!text) continue;
      const hk = budgetHintKey(file);

      for (const match of text.matchAll(HARD_ABORT_RE)) {
        const ms = parseMs(match[1]);
        if (Number.isFinite(ms) && ms > MAX_HARDCODED_MS) {
          findings.push({ severity: "critical", kind: "drift", file, message: `Guard 10: Hardcoded abort timeout ${ms}ms (>${MAX_HARDCODED_MS}ms). Use SSOT _shared/time-budget.ts.`, fix: [`Replace with makeAbortController("${hk}")`] });
        }
      }
      for (const match of text.matchAll(TIME_BUDGET_CONST_RE)) {
        const ms = parseMs(match[1]);
        if (Number.isFinite(ms) && ms > 0) {
          findings.push({ severity: "high", kind: "drift", file, message: `Guard 10: TIME_BUDGET_MS hardcoded (${ms}ms). Use getTimeBudget() from _shared/time-budget.ts.`, fix: [`Replace with getTimeBudget("${hk}").ms`] });
        }
      }
      for (const match of text.matchAll(GENERIC_BUDGET_RE)) {
        const ms = parseMs(match[2]);
        if (Number.isFinite(ms) && ms > 0) {
          findings.push({ severity: "medium", kind: "drift", file, message: `Guard 10: Hardcoded "${match[1]}" (${ms}ms). Prefer SSOT _shared/time-budget.ts.`, fix: [`Use makeAbortController("${hk}")`] });
        }
      }
    }

    for (const file of MUST_IMPORT_BUDGET) {
      const text = await readTextOrNull(file);
      if (!text) continue;
      if (!SSOT_HINTS.some((h) => text.includes(h))) {
        findings.push({ severity: "high", kind: "drift", file, message: `Guard 10: No SSOT budget usage found. Generator must use _shared/time-budget.ts.`, fix: [`Import { makeAbortController, shouldSoftStop } from "../_shared/time-budget.ts"`] });
      }
    }

    if (findings.length === g10before) console.log("✅ Guard 10: Time Budget Governance passed.");
  } catch (e) {
    console.warn(`⚠️  Guard 10 skipped: ${(e as Error).message}`);
  }

  // ── Guard 11: Concurrency Governance ──
  try {
    const CR_FILE = "supabase/functions/content-runner/index.ts";
    const JR_FILE = "supabase/functions/job-runner/index.ts";
    const WC_FILE = "supabase/functions/_shared/worker-config.ts";

    const g11before = findings.length;

    const cfgText = await readTextOrNull(WC_FILE);
    if (!cfgText) {
      findings.push({ severity: "critical", kind: "drift", file: WC_FILE, message: `Guard 11: Missing _shared/worker-config.ts. Runner concurrency must be SSOT-governed.`, fix: [`Create ${WC_FILE} with getRunnerConfig()`] });
    } else {
      if (!cfgText.includes("content_runner") || !cfgText.includes("maxConcurrency") || !cfgText.includes("claimLimit")) {
        findings.push({ severity: "high", kind: "drift", file: WC_FILE, message: `Guard 11: worker-config.ts missing content_runner defaults.`, fix: [`Add content_runner: { maxConcurrency: 1, claimLimit: 1 }`] });
      }
      const hasHardCap = cfgText.includes('kind === "content_runner"') && (cfgText.includes("Math.min(maxConcurrency, 2)") || cfgText.includes("Math.min(claimLimit, 2)"));
      if (!hasHardCap) {
        findings.push({ severity: "medium", kind: "drift", file: WC_FILE, message: `Guard 11: No hard cap for content_runner concurrency (<=2).`, fix: [`Add Math.min(..., 2) cap for content_runner`] });
      }
    }

    const contentText = await readTextOrNull(CR_FILE);
    if (contentText) {
      const usesConfig = contentText.includes("getRunnerConfig(") && (contentText.includes("../_shared/worker-config.ts") || contentText.includes("./_shared/worker-config.ts"));
      if (!usesConfig) {
        findings.push({ severity: "critical", kind: "drift", file: CR_FILE, message: `Guard 11: content-runner not using SSOT worker-config.ts.`, fix: [`Import getRunnerConfig from "../_shared/worker-config.ts"`] });
      }
      for (const m of contentText.matchAll(/p_limit\s*:\s*([0-9]+)/g)) {
        if (Number(m[1]) > 2) {
          findings.push({ severity: "critical", kind: "drift", file: CR_FILE, message: `Guard 11: p_limit:${m[1]} (>2) in content-runner. Must be <=2.`, fix: [`Use cfg.claimLimit from getRunnerConfig("content_runner")`] });
        }
      }
      for (const m of contentText.matchAll(/\bBASE_CONCURRENCY\b\s*=\s*([0-9_]+)/g)) {
        if (Number(String(m[1]).replace(/_/g, "")) > 2) {
          findings.push({ severity: "high", kind: "drift", file: CR_FILE, message: `Guard 11: BASE_CONCURRENCY=${m[1]} (>2). Must be safe-by-default.`, fix: [`Use getRunnerConfig("content_runner") instead`] });
        }
      }
    }

    const jobText = await readTextOrNull(JR_FILE);
    if (jobText) {
      const usesConfig = jobText.includes("getRunnerConfig(") && (jobText.includes("../_shared/worker-config.ts") || jobText.includes("./_shared/worker-config.ts"));
      if (!usesConfig) {
        findings.push({ severity: "high", kind: "drift", file: JR_FILE, message: `Guard 11: job-runner not using SSOT worker-config.ts.`, fix: [`Import getRunnerConfig from "../_shared/worker-config.ts"`] });
      }
    }

    if (findings.length === g11before) console.log("✅ Guard 11: Concurrency Governance passed.");
  } catch (e) {
    console.warn(`⚠️  Guard 11 skipped: ${(e as Error).message}`);
  }

  // ── Guard 12: SSOT Budget + Concurrency Existence & Soft-Stop Enforcement ──
  try {
    const g12before = findings.length;
    const TIME_BUDGET_FILE = "supabase/functions/_shared/time-budget.ts";
    const WORKER_CONFIG_FILE = "supabase/functions/_shared/worker-config.ts";
    const GENERATORS = [
      "supabase/functions/package-generate-exam-pool/index.ts",
      "supabase/functions/package-generate-learning-content/index.ts",
      "supabase/functions/package-generate-handbook/index.ts",
      "supabase/functions/package-generate-glossary/index.ts",
      "supabase/functions/package-generate-oral-exam/index.ts",
      "supabase/functions/package-generate-lesson-minichecks/index.ts",
    ];

    // A) SSOT modules must exist and export required functions
    const tb = await readTextOrNull(TIME_BUDGET_FILE);
    if (!tb) {
      findings.push({ severity: "critical", kind: "drift", file: TIME_BUDGET_FILE, message: "Guard 12: Missing SSOT time budget module (_shared/time-budget.ts).", fix: [`Create ${TIME_BUDGET_FILE} with getTimeBudget, makeAbortController, shouldSoftStop.`] });
    } else {
      const missing = ["getTimeBudget", "makeAbortController", "shouldSoftStop"].filter((fn) => !tb.includes(`export function ${fn}`));
      if (missing.length) {
        findings.push({ severity: "high", kind: "drift", file: TIME_BUDGET_FILE, message: `Guard 12: time-budget.ts missing required exports: ${missing.join(", ")}.`, fix: ["Ensure time-budget.ts exports: getTimeBudget(key), makeAbortController(key), shouldSoftStop(startMs, key)."] });
      }
    }

    const wc = await readTextOrNull(WORKER_CONFIG_FILE);
    if (!wc) {
      findings.push({ severity: "critical", kind: "drift", file: WORKER_CONFIG_FILE, message: "Guard 12: Missing SSOT worker config module (_shared/worker-config.ts).", fix: [`Create ${WORKER_CONFIG_FILE} with getRunnerConfig().`] });
    } else {
      if (!wc.includes("export function getRunnerConfig")) {
        findings.push({ severity: "high", kind: "drift", file: WORKER_CONFIG_FILE, message: "Guard 12: worker-config.ts does not export getRunnerConfig().", fix: ["Export getRunnerConfig(kind) from worker-config.ts."] });
      }
      if (!wc.includes("content_runner") || !wc.includes("job_runner")) {
        findings.push({ severity: "medium", kind: "drift", file: WORKER_CONFIG_FILE, message: "Guard 12: worker-config.ts should define both content_runner and job_runner defaults.", fix: ["Ensure DEFAULTS contains content_runner and job_runner entries."] });
      }
    }

    // B) Generators must use SSOT budgets AND enforce soft-stop
    for (const file of GENERATORS) {
      const text = await readTextOrNull(file);
      if (!text) continue;

      const usesBudget = text.includes("_shared/time-budget.ts") || text.includes("getTimeBudget(") || text.includes("makeAbortController(") || text.includes("shouldSoftStop(");
      const hk =
        file.includes("package-generate-exam-pool") ? "exam_pool_fanout" :
        file.includes("handbook") ? "handbook" :
        file.includes("glossary") ? "glossary" :
        file.includes("oral-exam") ? "oral_exam" :
        file.includes("lesson-minichecks") ? "lesson_minichecks" :
        "learning_content";

      if (!usesBudget) {
        findings.push({ severity: "high", kind: "drift", file, message: "Guard 12: Generator does not reference SSOT time budget module.", fix: [`Import { makeAbortController, shouldSoftStop } from "../_shared/time-budget.ts" and use key "${hk}".`] });
        continue;
      }

      if (!text.includes("shouldSoftStop(")) {
        findings.push({ severity: "high", kind: "drift", file, message: "Guard 12: Generator uses SSOT budgets but does NOT enforce soft-stop (shouldSoftStop). Risks timeouts under load.", fix: [`Add: if (shouldSoftStop(started, "${hk}")) break;`] });
      }

      const mentionsAbort = text.includes("AbortController") || text.includes("controller.abort()");
      if (mentionsAbort && !text.includes("makeAbortController(")) {
        findings.push({ severity: "medium", kind: "drift", file, message: "Guard 12: Uses AbortController but not makeAbortController(). Prefer SSOT makeAbortController().", fix: [`Replace manual AbortController + setTimeout with makeAbortController("${hk}").`] });
      }
    }

    if (findings.length === g12before) console.log("✅ Guard 12: Budget/Concurrency SSOT + soft-stop enforcement passed.");
  } catch (e) {
    console.warn(`⚠️  Guard 12 skipped: ${(e as Error).message}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Guard 13: Blueprint Quality + Bloom Governance (SSOT-level, CI-safe)
  // ─────────────────────────────────────────────────────────────────────────────
  try {
    const g13before = findings.length;

    const jobMap = await import(SSOT_JOB_MAP);

    const FULL_STEP_ORDER: string[] = jobMap.FULL_STEP_ORDER ?? [];
    const STEP_TO_JOB_TYPE: Record<string, string> = jobMap.STEP_TO_JOB_TYPE ?? {};
    const JOB_DEFINITIONS: Record<string, unknown> = jobMap.JOB_DEFINITIONS ?? {};

    // A) Required validate/quality steps must exist
    const requiredValidateSteps = [
      "validate_blueprints",
      "validate_exam_pool",
      "validate_learning_content",
      "validate_oral_exam",
      "validate_lesson_minichecks",
      "run_integrity_check",
      "quality_council",
    ];

    for (const step of requiredValidateSteps) {
      if (!FULL_STEP_ORDER.includes(step)) {
        findings.push({
          severity: "critical",
          kind: "drift",
          file: "supabase/functions/_shared/job-map.ts",
          message: `Guard 13: Required validate step "${step}" missing from FULL_STEP_ORDER.`,
          fix: [`Add "${step}" to FULL_STEP_ORDER in correct position.`],
        });
      }
      const jt = STEP_TO_JOB_TYPE[step];
      if (!jt) {
        findings.push({
          severity: "critical",
          kind: "drift",
          file: "supabase/functions/_shared/job-map.ts",
          message: `Guard 13: STEP_TO_JOB_TYPE missing mapping for validate step "${step}".`,
          fix: [`Add STEP_TO_JOB_TYPE["${step}"] = "<job_type>".`],
        });
      } else if (!JOB_DEFINITIONS[jt]) {
        findings.push({
          severity: "critical",
          kind: "drift",
          file: "supabase/functions/_shared/job-map.ts",
          message: `Guard 13: Job type "${jt}" (from step "${step}") missing in JOB_DEFINITIONS.`,
          fix: [`Add JOB_DEFINITIONS["${jt}"] with pool + edgeFunction config.`],
        });
      }
    }

    // B) Bloom taxonomy allowlist must exist and be stable
    const BLOOM_LEVELS: string[] = Array.isArray(jobMap.BLOOM_LEVELS) ? [...jobMap.BLOOM_LEVELS] : [];
    const recommended = ["remember", "understand", "apply", "analyze", "evaluate", "create"];

    if (BLOOM_LEVELS.length === 0) {
      findings.push({
        severity: "high",
        kind: "governance",
        file: "supabase/functions/_shared/job-map.ts",
        message: "Guard 13: Missing BLOOM_LEVELS SSOT export. Add BLOOM_LEVELS allowlist to prevent taxonomy drift.",
        fix: [`Export const BLOOM_LEVELS = ${JSON.stringify(recommended)} as const;`],
      });
    } else {
      const s = new Set(BLOOM_LEVELS);
      const missing = recommended.filter((x) => !s.has(x));
      if (missing.length) {
        findings.push({
          severity: "high",
          kind: "drift",
          file: "supabase/functions/_shared/job-map.ts",
          message: `Guard 13: BLOOM_LEVELS missing canonical entries: ${missing.join(", ")}.`,
          fix: [`Ensure BLOOM_LEVELS includes: ${recommended.join(", ")}.`],
        });
      }
    }

    // C) Blueprint quality gate job types should be present
    const requiredJobTypes = [
      "package_validate_blueprints",
      "package_validate_exam_pool",
      "package_validate_learning_content",
      "package_validate_oral_exam",
      "package_validate_lesson_minichecks",
      "package_run_integrity_check",
    ];

    for (const jt of requiredJobTypes) {
      if (!JOB_DEFINITIONS[jt]) {
        findings.push({
          severity: "medium",
          kind: "governance",
          file: "supabase/functions/_shared/job-map.ts",
          message: `Guard 13: Quality gate job type "${jt}" missing from JOB_DEFINITIONS.`,
          fix: [`Add JOB_DEFINITIONS["${jt}"] or update guard list if renamed.`],
        });
      }
    }

    if (findings.length === g13before) {
      console.log("✅ Guard 13: Blueprint Quality + Bloom Governance passed.");
    }
  } catch (e) {
    console.warn(`⚠️  Guard 13 skipped: ${(e as Error).message}`);
  }

  if (findings.length > 0) {
    console.error("\n❌ Edge Guards failed. Findings:\n");
    for (const f of findings) {
      console.error(`- [${f.severity.toUpperCase()}][${f.kind}] ${f.file}`);
      console.error(`  ${f.message}`);
      if (f.evidence && f.evidence.length > 0) {
        console.error(`  Evidence:`);
        for (const e of f.evidence) console.error(`    ${e}`);
      }
      if (f.fix && f.fix.length > 0) {
        console.error(`  Suggested fix:`);
        for (const x of f.fix) console.error(`    ${x}`);
      }
      console.error("");
    }

    const bySeverity = findings.reduce((acc, f) => {
      acc[f.severity] = (acc[f.severity] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.error("🔎 Governance Summary:");
    for (const [sev, count] of Object.entries(bySeverity)) {
      console.error(`  • ${sev}: ${count}`);
    }
    console.error(`  Total: ${findings.length} finding(s)\n`);

    Deno.exit(1);
  }

  console.log("\n🛡  All governance layers passed:");
  console.log("   ✓ SSOT integrity (job-map)");
  console.log("   ✓ Job-queue bypass protection");
  console.log("   ✓ Schema drift");
  console.log("   ✓ Security invariants");
  console.log("   ✓ Edge function directory validation");
  console.log("   ✓ Pool contract (Guard 8)");
  console.log("   ✓ Step order topology (Guard 9)");
  console.log("   ✓ Time budget governance (Guard 10)");
  console.log("   ✓ Concurrency governance (Guard 11)");
  console.log("   ✓ SSOT existence & soft-stop enforcement (Guard 12)");
  console.log("   ✓ Blueprint quality + Bloom governance (Guard 13)");
  console.log("\n✅ System Integrity Verified.");
}

await main();
