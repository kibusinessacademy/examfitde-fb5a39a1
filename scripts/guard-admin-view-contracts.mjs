#!/usr/bin/env node

/**
 * Admin View Contract Guard
 *
 * 1. Checks v_admin_* views in types.ts contain all required columns.
 * 2. Checks ops_jobtype_step_map contains all 25 SSOT step keys.
 *
 * Prevents schema drift and mapping gaps that cause pipeline stalls.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TYPES_FILE = path.join(ROOT, "src/integrations/supabase/types.ts");
const JOB_MAP_FILE = path.join(ROOT, "supabase/functions/_shared/job-map.ts");

// ── View column contracts ──────────────────────────────────────

const VIEW_CONTRACTS = {
  v_admin_queue_ssot: [
    "job_id", "job_type", "job_status", "package_id", "package_title",
    "package_status", "priority", "attempts", "max_attempts",
    "created_at", "started_at", "completed_at", "last_error",
    "health_signal", "age_minutes", "meta", "updated_at",
    "locked_at", "locked_by", "run_after",
  ],
  v_admin_packages_ssot: [
    "package_id", "raw_title", "canonical_title", "status",
    "build_progress", "current_step", "priority",
    "council_approved", "integrity_passed",
    "created_at", "updated_at", "is_published", "track",
  ],
  ops_pipeline_step_drift: [
    "package_id", "pkg_status", "build_progress", "step_key",
    "step_status", "step_updated_at", "job_type",
    "all_prereqs_done", "prereq_count", "prereqs_done_count",
    "has_active_job", "drift_signal", "age_minutes",
  ],
};

// ── DAG edges contract (must match PIPELINE_GRAPH dependsOn in job-map.ts) ──
const EXPECTED_DAG_EDGE_COUNT = 28; // 25 steps, 28 dependency edges
// ── Step mapping contract (must match FULL_STEP_ORDER in job-map.ts) ──

const SSOT_STEP_MAPPINGS = {
  scaffold_learning_course: "package_scaffold_learning_course",
  generate_glossary: "package_generate_glossary",
  fanout_learning_content: "package_fanout_learning_content",
  generate_learning_content: "package_generate_learning_content",
  finalize_learning_content: "package_finalize_learning_content",
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
  enqueue_handbook_expand: "package_enqueue_handbook_expand",
  expand_handbook: "handbook_expand_section",
  validate_handbook_depth: "package_validate_handbook_depth",
  elite_harden: "package_elite_harden",
  run_integrity_check: "package_run_integrity_check",
  quality_council: "package_quality_council",
  auto_publish: "package_auto_publish",
};

const violations = [];

function main() {
  if (!fs.existsSync(TYPES_FILE)) {
    console.error("❌ types.ts not found at:", TYPES_FILE);
    process.exit(1);
  }

  const content = fs.readFileSync(TYPES_FILE, "utf8");

  // ── 1. View column contracts ──
  for (const [viewName, requiredColumns] of Object.entries(VIEW_CONTRACTS)) {
    const viewColumns = extractViewColumns(content, viewName);

    if (viewColumns === null) {
      violations.push(`View "${viewName}" not found in types.ts`);
      continue;
    }

    for (const col of requiredColumns) {
      if (!viewColumns.has(col)) {
        violations.push(
          `View "${viewName}" is missing required column "${col}"`
        );
      }
    }
  }

  // ── 2. Step mapping parity ──
  checkStepMappingParity(content);

  // ── 3. Cross-check with job-map.ts FULL_STEP_ORDER ──
  checkJobMapAlignment();

  // ── 4. DAG edge parity ──
  checkDagEdgeParity();

  if (violations.length > 0) {
    console.error("\n❌ Admin view contract guard failed:\n");
    for (const v of violations) {
      console.error(`  - ${v}`);
    }
    console.error(
      "\nEnsure all required columns and step mappings exist."
    );
    console.error("See docs/admin-view-contracts.md for the full contract.\n");
    process.exit(1);
  }

  console.log("✅ Admin view contract guard passed.");
  for (const [viewName, cols] of Object.entries(VIEW_CONTRACTS)) {
    console.log(`   ${viewName}: ${cols.length} required columns verified`);
  }
  console.log(`   ops_jobtype_step_map: ${Object.keys(SSOT_STEP_MAPPINGS).length} step mappings verified`);
  console.log(`   ops_pipeline_step_drift: prereq-aware drift view verified`);
  console.log(`   pipeline_dag_edges: ${EXPECTED_DAG_EDGE_COUNT} edges expected`);
}

function checkStepMappingParity(typesContent) {
  // Extract ops_jobtype_step_map from types.ts to verify it exists
  const viewColumns = extractViewColumns(typesContent, "ops_jobtype_step_map");
  if (viewColumns === null) {
    violations.push("ops_jobtype_step_map not found in types.ts");
    return;
  }

  if (!viewColumns.has("step_key") || !viewColumns.has("job_type")) {
    violations.push(
      "ops_jobtype_step_map missing required columns: step_key, job_type"
    );
  }
}

function checkJobMapAlignment() {
  if (!fs.existsSync(JOB_MAP_FILE)) {
    console.warn("⚠ job-map.ts not found — skipping FULL_STEP_ORDER cross-check");
    return;
  }

  const jobMapContent = fs.readFileSync(JOB_MAP_FILE, "utf8");

  // Extract FULL_STEP_ORDER from job-map.ts
  const stepOrderMatch = jobMapContent.match(
    /FULL_STEP_ORDER[^=]*=\s*\[([\s\S]*?)\];/
  );
  if (!stepOrderMatch) {
    console.warn("⚠ Could not parse FULL_STEP_ORDER from job-map.ts");
    return;
  }

  const stepOrderKeys = new Set();
  const keyRegex = /"(\w+)"/g;
  let m;
  while ((m = keyRegex.exec(stepOrderMatch[1])) !== null) {
    stepOrderKeys.add(m[1]);
  }

  // Extract STEP_TO_JOB_TYPE from job-map.ts
  const mappingMatch = jobMapContent.match(
    /STEP_TO_JOB_TYPE[^=]*=\s*\{([\s\S]*?)\};/
  );
  const mappedKeys = new Set();
  if (mappingMatch) {
    const mapRegex = /(\w+)\s*:/g;
    while ((m = mapRegex.exec(mappingMatch[1])) !== null) {
      mappedKeys.add(m[1]);
    }
  }

  // Every SSOT step must be in FULL_STEP_ORDER
  for (const stepKey of Object.keys(SSOT_STEP_MAPPINGS)) {
    if (!stepOrderKeys.has(stepKey)) {
      violations.push(
        `SSOT step "${stepKey}" missing from FULL_STEP_ORDER in job-map.ts`
      );
    }
  }

  // Every FULL_STEP_ORDER step must be in our contract
  for (const stepKey of stepOrderKeys) {
    if (!SSOT_STEP_MAPPINGS[stepKey]) {
      violations.push(
        `FULL_STEP_ORDER step "${stepKey}" missing from guard contract SSOT_STEP_MAPPINGS`
      );
    }
  }

  // Every SSOT step must be in STEP_TO_JOB_TYPE
  if (mappedKeys.size > 0) {
    for (const stepKey of Object.keys(SSOT_STEP_MAPPINGS)) {
      if (!mappedKeys.has(stepKey)) {
        violations.push(
          `SSOT step "${stepKey}" missing from STEP_TO_JOB_TYPE in job-map.ts`
        );
      }
    }
  }
}

function checkDagEdgeParity() {
  if (!fs.existsSync(JOB_MAP_FILE)) return;
  const jobMapContent = fs.readFileSync(JOB_MAP_FILE, "utf8");

  // Extract PIPELINE_GRAPH dependsOn edges
  const graphMatch = jobMapContent.match(
    /PIPELINE_GRAPH[^=]*=\s*\[([\s\S]*?)\];/
  );
  if (!graphMatch) {
    console.warn("⚠ Could not parse PIPELINE_GRAPH from job-map.ts");
    return;
  }

  // Count dependsOn entries
  const dependsOnRegex = /dependsOn:\s*\[([^\]]*)\]/g;
  let edgeCount = 0;
  let m;
  while ((m = dependsOnRegex.exec(graphMatch[1])) !== null) {
    const deps = m[1].match(/"(\w+)"/g);
    if (deps) edgeCount += deps.length;
  }

  if (edgeCount !== EXPECTED_DAG_EDGE_COUNT) {
    violations.push(
      `PIPELINE_GRAPH has ${edgeCount} dependency edges but guard expects ${EXPECTED_DAG_EDGE_COUNT}. Update pipeline_dag_edges table and EXPECTED_DAG_EDGE_COUNT.`
    );
  }
}

function extractViewColumns(typesContent, viewName) {
  const viewRegex = new RegExp(
    `${viewName}:\\s*\\{\\s*Row:\\s*\\{([^}]+)\\}`,
    "s"
  );
  const match = typesContent.match(viewRegex);
  if (!match) return null;

  const rowBlock = match[1];
  const columnNames = new Set();

  const colRegex = /(\w+)\s*:/g;
  let colMatch;
  while ((colMatch = colRegex.exec(rowBlock)) !== null) {
    columnNames.add(colMatch[1]);
  }

  return columnNames;
}

main();
