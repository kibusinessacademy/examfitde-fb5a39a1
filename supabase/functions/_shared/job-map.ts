/**
 * SSOT: Pipeline StepKey → JobType mapping + Worker Pool routing + Edge Function dispatch.
 *
 * Both pipeline-runner, job-runner, content-runner and stuck-scan MUST import from here.
 * Adding a new step or job? Add it here — nowhere else.
 */

export type PipelineStepKey =
  | "scaffold_learning_course"
  | "generate_glossary"
  | "generate_learning_content"
  | "validate_learning_content"
  | "auto_seed_exam_blueprints"
  | "validate_blueprints"
  | "generate_exam_pool"
  | "validate_exam_pool"
  | "build_ai_tutor_index"
  | "validate_tutor_index"
  | "generate_oral_exam"
  | "validate_oral_exam"
  | "generate_lesson_minichecks"
  | "validate_lesson_minichecks"
  | "generate_handbook"
  | "validate_handbook"
  | "elite_harden"
  | "run_integrity_check"
  | "quality_council"
  | "auto_publish";

/** Maps step_key → job_type in job_queue */
export const STEP_TO_JOB_TYPE: Record<PipelineStepKey, string> = {
  scaffold_learning_course: "package_scaffold_learning_course",
  generate_glossary: "package_generate_glossary",
  generate_learning_content: "package_generate_learning_content",
  validate_learning_content: "package_validate_learning_content",
  auto_seed_exam_blueprints: "package_auto_seed_exam_blueprints",
  validate_blueprints: "package_validate_blueprints",
  generate_exam_pool: "package_generate_exam_pool",
  validate_exam_pool: "package_validate_exam_pool",
  build_ai_tutor_index: "package_build_ai_tutor_index",
  validate_tutor_index: "package_validate_tutor_index",
  generate_oral_exam: "package_generate_oral_exam",
  validate_oral_exam: "package_validate_oral_exam",
  generate_lesson_minichecks: "package_generate_lesson_minichecks",
  validate_lesson_minichecks: "package_validate_lesson_minichecks",
  generate_handbook: "package_generate_handbook",
  validate_handbook: "package_validate_handbook",
  elite_harden: "package_elite_harden",
  run_integrity_check: "package_run_integrity_check",
  quality_council: "package_quality_council",
  auto_publish: "package_auto_publish",
};

/**
 * Canonical step ordering — superset of all possible steps.
 * Steps not present in a package's DB rows are simply skipped.
 */
export const FULL_STEP_ORDER: PipelineStepKey[] = [
  "scaffold_learning_course",
  "generate_glossary",
  "generate_learning_content",
  "validate_learning_content",
  "auto_seed_exam_blueprints",
  "validate_blueprints",
  "generate_exam_pool",
  "validate_exam_pool",
  "build_ai_tutor_index",
  "validate_tutor_index",
  "generate_oral_exam",
  "validate_oral_exam",
  "generate_lesson_minichecks",
  "validate_lesson_minichecks",
  "generate_handbook",
  "validate_handbook",
  "elite_harden",
  "run_integrity_check",
  "quality_council",
  "auto_publish",
];

// ═══════════════════════════════════════════════════════════════
// Unified Job Definitions (SSOT for pool + edge function dispatch)
// ═══════════════════════════════════════════════════════════════

export type WorkerPool = "core" | "content";

export interface JobDefinition {
  pool: WorkerPool;
  /** Edge function name to dispatch to. Only needed for content-runner dispatched jobs. */
  edgeFunction?: string;
}

/**
 * SSOT job definition table.
 * Pool routing AND edge function dispatch in ONE place — no drift possible.
 */
export const JOB_DEFINITIONS: Record<string, JobDefinition> = {
  // ── content / heavy ─────────────────────────────────────────
  package_generate_learning_content: { pool: "content", edgeFunction: "package-generate-learning-content" },
  package_generate_handbook:         { pool: "content", edgeFunction: "package-generate-handbook" },
  package_generate_glossary:         { pool: "content", edgeFunction: "package-generate-glossary" },
  package_generate_oral_exam:        { pool: "content", edgeFunction: "package-generate-oral-exam" },
  package_generate_lesson_minichecks:{ pool: "content", edgeFunction: "package-generate-lesson-minichecks" },
  mass_enrich_competencies_v2:       { pool: "content", edgeFunction: "mass-enrich-competencies" },

  // ── core / orchestration + validation (explicit for clarity) ─
  pipeline_tick:                     { pool: "core" },
  stuck_scan:                        { pool: "core" },
  package_scaffold_learning_course:  { pool: "core" },
  package_validate_blueprints:       { pool: "core" },
  package_validate_exam_pool:        { pool: "core" },
  package_validate_learning_content: { pool: "core" },
  package_validate_oral_exam:        { pool: "core" },
  package_validate_tutor_index:      { pool: "core" },
  package_validate_lesson_minichecks:{ pool: "core" },
  package_validate_handbook:         { pool: "core" },
  package_auto_seed_exam_blueprints: { pool: "core" },
  package_generate_exam_pool:        { pool: "content", edgeFunction: "package-generate-exam-pool" },
  package_build_ai_tutor_index:      { pool: "core" },
  package_elite_harden:              { pool: "core" },
  package_run_integrity_check:       { pool: "core" },
  package_quality_council:           { pool: "core" },
  package_auto_publish:              { pool: "core" },
};

// ── Backward-compatible derived maps (used by existing code) ──

/** @deprecated Use JOB_DEFINITIONS instead. Kept for backward compat. */
export const JOB_POOLS: Record<string, WorkerPool> = Object.fromEntries(
  Object.entries(JOB_DEFINITIONS).map(([k, v]) => [k, v.pool])
);

/** Returns the correct worker pool for a given job type. Defaults to "core". */
export function poolForJobType(jobType: string): WorkerPool {
  return JOB_DEFINITIONS[jobType]?.pool ?? "core";
}

/** Returns the edge function name for a given job type, or null if not dispatched. */
export function edgeFunctionForJobType(jobType: string): string | null {
  return JOB_DEFINITIONS[jobType]?.edgeFunction ?? null;
}

/** Backoff heuristic for stale/failed job requeues */
export function inferBackoffSeconds(reason: string | number): number {
  if (typeof reason === "number") {
    // Called with attempt count — exponential backoff
    return Math.min(300, 30 * Math.pow(1.5, reason));
  }
  const r = (reason || "").toLowerCase();
  if (!r) return 30;
  if (r.includes("rate limit") || r.includes("429")) return 120;
  if (r.includes("timeout") || r.includes("504") || r.includes("deadline")) return 90;
  if (r.includes("unknown") || r.includes("edge") || r.includes("worker job failed")) return 60;
  // Job-type aware: heavy generators get longer cooldown
  if (r.includes("elite_harden") || r.includes("generate_exam") || r.includes("generate_learning")) return 60;
  if (r.includes("generate_") || r.includes("scaffold_")) return 45;
  return 30;
}

// ═══════════════════════════════════════════════════════════════
// Pipeline DAG — Explicit dependency graph for static validation
// ═══════════════════════════════════════════════════════════════

export interface PipelineNode {
  key: PipelineStepKey;
  dependsOn?: PipelineStepKey[];
  /** Artifacts this step produces when completed successfully */
  produces?: string[];
  /** Artifacts this step requires before it can run */
  requires?: string[];
  /** Scheduling weight: higher = more expensive. Used for predictive scheduling. */
  weight?: number;
  /** Downstream impact: how many steps are transitively unblocked by this step's artifact.
   *  Computed by computeArtifactImpact(). Used by Phase 6 predictive scheduling. */
  artifactImpact?: number;
}

/**
 * SSOT: Explicit pipeline DAG.
 * Used by CI guards + runner boot-time validation.
 * Adding a step? Add it here with correct dependencies.
 */
export const PIPELINE_GRAPH: PipelineNode[] = [
  { key: "scaffold_learning_course", produces: ["course_scaffold"], weight: 2 },
  { key: "generate_glossary", dependsOn: ["scaffold_learning_course"], requires: ["course_scaffold"], produces: ["glossary"], weight: 3 },
  { key: "generate_learning_content", dependsOn: ["scaffold_learning_course"], requires: ["course_scaffold"], produces: ["learning_content"], weight: 10 },
  { key: "validate_learning_content", dependsOn: ["generate_learning_content"], requires: ["learning_content"], produces: ["validated_learning_content"], weight: 3 },
  { key: "auto_seed_exam_blueprints", dependsOn: ["validate_learning_content"], requires: ["validated_learning_content"], produces: ["exam_blueprints"], weight: 6 },
  { key: "validate_blueprints", dependsOn: ["auto_seed_exam_blueprints"], requires: ["exam_blueprints"], produces: ["validated_blueprints"], weight: 2 },
  { key: "generate_exam_pool", dependsOn: ["validate_blueprints"], requires: ["validated_blueprints"], produces: ["exam_questions"], weight: 8 },
  { key: "validate_exam_pool", dependsOn: ["generate_exam_pool"], requires: ["exam_questions"], produces: ["validated_exam_pool"], weight: 3 },
  { key: "build_ai_tutor_index", dependsOn: ["validate_exam_pool"], requires: ["validated_exam_pool"], produces: ["tutor_index"], weight: 4 },
  { key: "validate_tutor_index", dependsOn: ["build_ai_tutor_index"], requires: ["tutor_index"], produces: ["validated_tutor_index"], weight: 2 },
  { key: "generate_oral_exam", dependsOn: ["validate_exam_pool"], requires: ["validated_exam_pool"], produces: ["oral_exam"], weight: 5 },
  { key: "validate_oral_exam", dependsOn: ["generate_oral_exam"], requires: ["oral_exam"], produces: ["validated_oral_exam"], weight: 2 },
  { key: "generate_lesson_minichecks", dependsOn: ["validate_learning_content"], requires: ["validated_learning_content"], produces: ["lesson_minichecks"], weight: 5 },
  { key: "validate_lesson_minichecks", dependsOn: ["generate_lesson_minichecks"], requires: ["lesson_minichecks"], produces: ["validated_minichecks"], weight: 2 },
  { key: "generate_handbook", dependsOn: ["validate_learning_content"], requires: ["validated_learning_content"], produces: ["handbook"], weight: 7 },
  { key: "validate_handbook", dependsOn: ["generate_handbook"], requires: ["handbook"], produces: ["validated_handbook"], weight: 2 },
  { key: "elite_harden", dependsOn: ["validate_exam_pool"], requires: ["validated_exam_pool"], produces: ["elite_ready"], weight: 6 },
  { key: "run_integrity_check", dependsOn: ["elite_harden"], requires: ["elite_ready"], produces: ["integrity_passed"], weight: 3 },
  { key: "quality_council", dependsOn: ["run_integrity_check"], requires: ["integrity_passed"], produces: ["council_approved"], weight: 4 },
  { key: "auto_publish", dependsOn: ["quality_council"], requires: ["council_approved"], produces: ["published"], weight: 1 },
];

/**
 * Compute artifact impact score: how many downstream steps are transitively
 * unblocked when this step completes. Higher = more critical to schedule first.
 * This powers Phase 6 — Predictive Scheduling.
 */
export function computeArtifactImpact(graph: PipelineNode[]): Map<string, number> {
  const impactMap = new Map<string, number>();

  // Build artifact → consumers mapping
  const artifactConsumers = new Map<string, Set<string>>();
  for (const node of graph) {
    for (const req of node.requires ?? []) {
      if (!artifactConsumers.has(req)) artifactConsumers.set(req, new Set());
      artifactConsumers.get(req)!.add(node.key);
    }
  }

  // For each node, count how many downstream steps are transitively dependent
  function countDownstream(key: string, visited: Set<string>): number {
    if (visited.has(key)) return 0;
    visited.add(key);
    const node = graph.find(n => n.key === key);
    if (!node?.produces) return 0;

    let count = 0;
    for (const artifact of node.produces) {
      const consumers = artifactConsumers.get(artifact);
      if (!consumers) continue;
      for (const consumerKey of consumers) {
        count += 1 + countDownstream(consumerKey, visited);
      }
    }
    return count;
  }

  for (const node of graph) {
    const downstream = countDownstream(node.key, new Set());
    impactMap.set(node.key, downstream);
    node.artifactImpact = downstream;
  }

  return impactMap;
}

// Compute impact scores at module load time (available for scheduling)
export const ARTIFACT_IMPACT = computeArtifactImpact(PIPELINE_GRAPH);

/**
 * Returns a scheduling priority bump for a job based on its artifact impact.
 * Higher impact producers get priority 5-15, validators/terminals get 0.
 * Used by Phase 6 predictive scheduling.
 */
export function getArtifactPriorityBump(stepKey: string): number {
  const impact = ARTIFACT_IMPACT.get(stepKey) ?? 0;
  if (impact >= 10) return 15; // critical producers (scaffold, generate_learning_content)
  if (impact >= 5) return 10;  // major producers (exam_pool, blueprints)
  if (impact >= 2) return 5;   // medium producers
  return 0;                     // terminals/validators
}

/**
 * Validates the pipeline DAG at boot/CI time.
 * Throws on: missing dependencies, cycles, unreachable nodes, orphaned validate_* steps.
 */
export function validatePipelineGraph(graph: PipelineNode[]): void {
  const keys = new Set(graph.map(n => n.key));
  const keyList = [...keys];

  // 1. Every dependency must exist in the graph
  for (const node of graph) {
    for (const dep of node.dependsOn ?? []) {
      if (!keys.has(dep)) {
        throw new Error(`PIPELINE_DAG_INVALID: "${node.key}" depends on missing step "${dep}"`);
      }
    }
  }

  // 2. Cycle detection (DFS)
  const visited = new Set<string>();
  const stack = new Set<string>();

  function dfs(nodeKey: string) {
    if (stack.has(nodeKey)) {
      throw new Error(`PIPELINE_DAG_CYCLE: cycle detected at "${nodeKey}"`);
    }
    if (visited.has(nodeKey)) return;
    visited.add(nodeKey);
    stack.add(nodeKey);
    const node = graph.find(n => n.key === nodeKey);
    for (const dep of node?.dependsOn ?? []) {
      dfs(dep);
    }
    stack.delete(nodeKey);
  }

  for (const k of keyList) dfs(k);

  // 3. Every FULL_STEP_ORDER key must be in DAG and vice versa
  for (const step of FULL_STEP_ORDER) {
    if (!keys.has(step)) {
      throw new Error(`PIPELINE_DAG_MISSING: FULL_STEP_ORDER contains "${step}" but DAG does not`);
    }
  }
  for (const k of keyList) {
    if (!FULL_STEP_ORDER.includes(k)) {
      throw new Error(`PIPELINE_DAG_ORPHAN: DAG contains "${k}" but FULL_STEP_ORDER does not`);
    }
  }

  // 4. validate_* must have a dependency (no standalone validators)
  for (const node of graph) {
    if (node.key.startsWith("validate_") && (!node.dependsOn || node.dependsOn.length === 0)) {
      throw new Error(`PIPELINE_DAG_INVALID: validator "${node.key}" has no dependencies`);
    }
  }

  // 5. Artifact integrity: every required artifact must have a producer
  const allProduced = new Set<string>();
  for (const node of graph) {
    for (const a of node.produces ?? []) allProduced.add(a);
  }
  for (const node of graph) {
    for (const a of node.requires ?? []) {
      if (!allProduced.has(a)) {
        throw new Error(`PIPELINE_DAG_ARTIFACT: "${node.key}" requires artifact "${a}" but no step produces it`);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Artifact Resolver — checks if a step's required artifacts exist
// ═══════════════════════════════════════════════════════════════

/** Find the pipeline node that produces a given artifact */
export function findProducer(artifact: string): PipelineNode | undefined {
  return PIPELINE_GRAPH.find(n => n.produces?.includes(artifact));
}

/** Find the pipeline node for a given step key */
export function findNode(stepKey: string): PipelineNode | undefined {
  return PIPELINE_GRAPH.find(n => n.key === stepKey);
}
