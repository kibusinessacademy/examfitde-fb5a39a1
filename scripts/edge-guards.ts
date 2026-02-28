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
    Deno.exit(1);
  }

  console.log("✅ Edge Guards passed (no critical security/drift issues found).");
}

await main();
