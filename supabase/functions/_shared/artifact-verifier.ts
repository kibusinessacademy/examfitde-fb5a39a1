/**
 * artifact-verifier.ts — Materialization Guard SSOT
 *
 * INVARIANT: A pipeline job may only reach "completed" status if its
 * target artifact is provably materialized in the database.
 *
 * RULE: No verifier success, no completion.
 * - No verifier registered → opt-in, completion allowed
 * - Verifier returns ok=true → completion allowed
 * - Verifier returns ok=false → completion blocked
 * - Verifier throws error → completion blocked (FAIL-CLOSED)
 *
 * v3: Threshold-hardened — verifiers check proportional completeness,
 *     not just existence (>0). Each verifier documents its threshold logic.
 */

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

type SB = ReturnType<typeof createClient>;

export interface VerifyResult {
  /** Whether the artifact meets the threshold */
  ok: boolean;
  /** Human-readable reason for failure */
  reason?: string;
  /** Measured count or metric */
  count?: number;
  /** Minimum threshold that was required */
  threshold?: number;
  /** Whether this is a permanent failure (no retry) */
  permanent?: boolean;
}

/** Audit metadata written to job.meta on verification */
export interface VerifyAuditMeta {
  artifact_verified: boolean;
  artifact_verify_reason?: string;
  artifact_verify_count?: number;
  artifact_verify_threshold?: number;
  artifact_verify_at: string;
  artifact_verifier_version: number;
}

/** Current verifier contract version — bump on logic changes */
const VERIFIER_VERSION = 3;

// ── Shared helpers ──────────────────────────────────────────────

/** Run a count query with explicit error handling */
async function safeCount(
  sb: SB,
  table: string,
  filters: (q: any) => any,
): Promise<{ count: number; error?: string }> {
  const q = filters(sb.from(table).select("id", { count: "exact", head: true }));
  const { count, error } = await q;
  if (error) return { count: 0, error: error.message ?? String(error) };
  return { count: count ?? 0 };
}

/** Extract packageId or curriculumId with permanent failure on missing */
function requirePayloadId(job: any, key: "package_id" | "curriculum_id"): { id: string } | VerifyResult {
  const id = job.payload?.[key] || (key === "package_id" ? job.package_id : undefined);
  if (!id) return { ok: false, reason: `MISSING_${key.toUpperCase()}`, permanent: true };
  return { id };
}

/** Resolve package → course_id + curriculum_id */
async function resolvePackage(sb: SB, packageId: string) {
  const { data, error } = await sb
    .from("course_packages")
    .select("course_id, curriculum_id")
    .eq("id", packageId)
    .single();
  return { pkg: data, error };
}

/** Count learning_fields for a curriculum */
async function countLearningFields(sb: SB, curriculumId: string) {
  return safeCount(sb, "learning_fields", (q) => q.eq("curriculum_id", curriculumId));
}

/** Count competencies for a curriculum (via learning_fields) */
async function countCompetencies(sb: SB, curriculumId: string) {
  const { data: lfs } = await sb
    .from("learning_fields")
    .select("id")
    .eq("curriculum_id", curriculumId);
  if (!lfs || lfs.length === 0) return { count: 0 };
  const lfIds = lfs.map((lf: any) => lf.id);
  return safeCount(sb, "competencies", (q) => q.in("learning_field_id", lfIds));
}

// ── Threshold helpers ───────────────────────────────────────────

function thresholdResult(
  actual: number,
  threshold: number,
  okReason: string,
  failReason: string,
): VerifyResult {
  return actual >= threshold
    ? { ok: true, count: actual, threshold }
    : { ok: false, reason: `${failReason}: ${actual}/${threshold}`, count: actual, threshold };
}

// ── Verifier Registry ───────────────────────────────────────────

const VERIFIERS: Record<string, (sb: SB, job: any) => Promise<VerifyResult>> = {

  // ── Scaffold: modules ≥ learning_fields, lessons ≥ competencies ──
  // Threshold: proportional to curriculum structure
  package_scaffold_learning_course: async (sb, job) => {
    const r = requirePayloadId(job, "package_id");
    if ("ok" in r) return r;

    const { pkg, error: pkgErr } = await resolvePackage(sb, r.id);
    if (pkgErr || !pkg) return { ok: false, reason: "PACKAGE_NOT_FOUND", permanent: true };

    // Count modules
    const { count: moduleCount, error: modErr } = await safeCount(sb, "modules", (q) =>
      q.eq("course_id", pkg.course_id),
    );
    if (modErr) return { ok: false, reason: `QUERY_ERROR: ${modErr}` };

    // Threshold: at least 1 module per learning field (proportional)
    const { count: lfCount } = await countLearningFields(sb, pkg.curriculum_id);
    const minModules = Math.max(1, lfCount); // At least LF count, minimum 1
    if (moduleCount < minModules) {
      return { ok: false, reason: `INSUFFICIENT_MODULES: ${moduleCount}/${minModules}`, count: moduleCount, threshold: minModules };
    }

    // Count lessons via modules
    const { data: mods } = await sb
      .from("modules")
      .select("id")
      .eq("course_id", pkg.course_id);
    if (!mods || mods.length === 0) return { ok: false, reason: "ZERO_MODULES", count: 0, threshold: minModules };

    const modIds = mods.map((m: any) => m.id);
    const { count: lessonCount, error: lErr } = await safeCount(sb, "lessons", (q) =>
      q.in("module_id", modIds),
    );
    if (lErr) return { ok: false, reason: `QUERY_ERROR: ${lErr}` };

    // Threshold: at least 1 lesson per competency (5 per LF typically)
    const { count: compCount } = await countCompetencies(sb, pkg.curriculum_id);
    const minLessons = Math.max(5, compCount); // At least competency count, minimum 5
    return thresholdResult(lessonCount, minLessons, "SCAFFOLD_OK", "INSUFFICIENT_LESSONS");
  },

  // ── Glossary: profession_glossaries ≥ 10 ──
  // Threshold: a useful glossary needs at least 10 terms
  package_generate_glossary: async (sb, job) => {
    const r = requirePayloadId(job, "curriculum_id");
    if ("ok" in r) return r;

    const { data: cur, error: curErr } = await sb
      .from("curricula")
      .select("beruf_id")
      .eq("id", r.id)
      .single();
    if (curErr || !cur?.beruf_id) return { ok: false, reason: "NO_BERUF_ID", permanent: true };

    const { count, error } = await safeCount(sb, "profession_glossaries", (q) =>
      q.eq("beruf_id", cur.beruf_id),
    );
    if (error) return { ok: false, reason: `QUERY_ERROR: ${error}` };

    const MIN_GLOSSARY = 10;
    return thresholdResult(count, MIN_GLOSSARY, "GLOSSARY_OK", "INSUFFICIENT_GLOSSARY_ENTRIES");
  },

  // ── Exam Pool: exam_questions ≥ 10 non-rejected ──
  // Threshold: a viable exam pool needs at least 10 questions
  package_generate_exam_pool: async (sb, job) => {
    const r = requirePayloadId(job, "curriculum_id");
    if ("ok" in r) return r;

    const { count, error } = await safeCount(sb, "exam_questions", (q) =>
      q.eq("curriculum_id", r.id).neq("status", "rejected"),
    );
    if (error) return { ok: false, reason: `QUERY_ERROR: ${error}` };

    const MIN_EXAM_QUESTIONS = 10;
    return thresholdResult(count, MIN_EXAM_QUESTIONS, "EXAM_POOL_OK", "INSUFFICIENT_EXAM_QUESTIONS");
  },

  // ── Blueprint Seeding: question_blueprints ≥ 3 ──
  // CRITICAL FIX (P0): Worker writes to `question_blueprints`, NOT `exam_blueprints`.
  // Threshold: minimum 3 blueprints needed for meaningful coverage
  package_auto_seed_exam_blueprints: async (sb, job) => {
    const r = requirePayloadId(job, "curriculum_id");
    if ("ok" in r) return r;

    const { count, error } = await safeCount(sb, "question_blueprints", (q) =>
      q.eq("curriculum_id", r.id),
    );
    if (error) return { ok: false, reason: `QUERY_ERROR: ${error}` };

    const MIN_BLUEPRINTS = 3;
    return thresholdResult(count, MIN_BLUEPRINTS, "BLUEPRINTS_OK", "INSUFFICIENT_BLUEPRINTS");
  },

  // ── Handbook: sections ≥ chapters (at least 1 section per chapter) ──
  // Threshold: proportional — every chapter must have content
  package_generate_handbook: async (sb, job) => {
    const r = requirePayloadId(job, "curriculum_id");
    if ("ok" in r) return r;

    const { data: chapters, error: chErr } = await sb
      .from("handbook_chapters")
      .select("id")
      .eq("curriculum_id", r.id);
    if (chErr) return { ok: false, reason: `QUERY_ERROR: ${chErr.message}` };
    if (!chapters || chapters.length === 0) return { ok: false, reason: "ZERO_HANDBOOK_CHAPTERS", count: 0, threshold: 1 };

    const chapterIds = chapters.map((c: any) => c.id);
    const { count, error } = await safeCount(sb, "handbook_sections", (q) =>
      q.in("chapter_id", chapterIds),
    );
    if (error) return { ok: false, reason: `QUERY_ERROR: ${error}` };

    // Threshold: at least 1 section per chapter
    const minSections = chapters.length;
    return thresholdResult(count, minSections, "HANDBOOK_OK", "INSUFFICIENT_HANDBOOK_SECTIONS");
  },

  // ── Tutor Index: ai_tutor_context_index ≥ 1 ──
  // Threshold: exactly 1 index record per package (singleton artifact)
  package_build_ai_tutor_index: async (sb, job) => {
    const r = requirePayloadId(job, "package_id");
    if ("ok" in r) return r;

    const { count, error } = await safeCount(sb, "ai_tutor_context_index", (q) =>
      q.eq("package_id", r.id),
    );
    if (error) return { ok: false, reason: `QUERY_ERROR: ${error}` };

    return thresholdResult(count, 1, "TUTOR_INDEX_OK", "ZERO_TUTOR_INDEX");
  },

  // ── Oral Exam: oral_exam_blueprints ≥ 10 ──
  // Threshold: matches validate-oral-exam MIN_BLUEPRINTS
  package_generate_oral_exam: async (sb, job) => {
    const r = requirePayloadId(job, "curriculum_id");
    if ("ok" in r) return r;

    const { count, error } = await safeCount(sb, "oral_exam_blueprints", (q) =>
      q.eq("curriculum_id", r.id),
    );
    if (error) return { ok: false, reason: `QUERY_ERROR: ${error}` };

    const MIN_BLUEPRINTS = 10;
    return thresholdResult(count, MIN_BLUEPRINTS, "ORAL_EXAM_OK", "INSUFFICIENT_ORAL_BLUEPRINTS");
  },

  // ── MiniChecks: minicheck_questions ≥ 5 per curriculum ──
  // Threshold: at least 5 questions (minimum viable check coverage)
  package_generate_lesson_minichecks: async (sb, job) => {
    const r = requirePayloadId(job, "curriculum_id");
    if ("ok" in r) return r;

    const { count, error } = await safeCount(sb, "minicheck_questions", (q) =>
      q.eq("curriculum_id", r.id),
    );
    if (error) return { ok: false, reason: `QUERY_ERROR: ${error}` };

    const MIN_MINICHECKS = 5;
    return thresholdResult(count, MIN_MINICHECKS, "MINICHECKS_OK", "INSUFFICIENT_MINICHECKS");
  },

  // ── Integrity Check: report + version + freshness + non-empty ──
  // Threshold: report must exist, have version, be fresh, and contain sections
  package_run_integrity_check: async (sb, job) => {
    const r = requirePayloadId(job, "package_id");
    if ("ok" in r) return r;

    const { data, error } = await sb
      .from("course_packages")
      .select("integrity_report, integrity_report_version, updated_at")
      .eq("id", r.id)
      .single();

    if (error) return { ok: false, reason: `QUERY_ERROR: ${error.message}` };
    if (!data) return { ok: false, reason: "PACKAGE_NOT_FOUND", permanent: true };

    // Version set but body missing = persistence defect (permanent)
    if (data.integrity_report_version && !data.integrity_report) {
      return { ok: false, reason: "INTEGRITY_PERSISTENCE_DEFECT", permanent: true };
    }

    if (!data.integrity_report) {
      return { ok: false, reason: "INTEGRITY_REPORT_MISSING" };
    }

    if (!data.integrity_report_version) {
      return { ok: false, reason: "INTEGRITY_VERSION_MISSING" };
    }

    // Non-empty check: report must be a non-trivial object
    const report = typeof data.integrity_report === "object" ? data.integrity_report : null;
    if (!report) {
      return { ok: false, reason: "INTEGRITY_REPORT_INVALID_TYPE" };
    }
    const reportKeys = Object.keys(report as Record<string, unknown>);
    if (reportKeys.length < 2) {
      return { ok: false, reason: `INTEGRITY_REPORT_EMPTY: ${reportKeys.length} keys` };
    }

    // Freshness check: report must be generated after job started
    const jobStarted = job.locked_at || job.started_at;
    if (jobStarted) {
      const reportGeneratedAt = (report as any)?.generated_at;
      if (reportGeneratedAt) {
        const reportTime = new Date(reportGeneratedAt).getTime();
        const jobTime = new Date(jobStarted).getTime();
        // Allow 60s tolerance for clock skew
        if (reportTime < jobTime - 60_000) {
          return { ok: false, reason: "INTEGRITY_REPORT_STALE" };
        }
      }
    }

    return { ok: true };
  },
};

/**
 * Verify that a job's target artifact is materialized in the DB.
 *
 * FAIL-CLOSED: For registered job types, any verifier error blocks completion.
 * Only unregistered job types pass through (opt-in model).
 */
export async function verifyArtifact(sb: SB, job: any): Promise<VerifyResult> {
  const verifier = VERIFIERS[job.job_type];
  if (!verifier) return { ok: true };

  try {
    return await verifier(sb, job);
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    console.error(`[artifact-verifier] FAIL-CLOSED: Error verifying ${job.job_type}: ${msg}`);
    return {
      ok: false,
      reason: `VERIFIER_ERROR: ${msg.slice(0, 200)}`,
      permanent: false,
    };
  }
}

/**
 * Build audit metadata for the job's meta field.
 */
export function buildVerifyAuditMeta(result: VerifyResult): VerifyAuditMeta {
  return {
    artifact_verified: result.ok,
    artifact_verify_reason: result.reason,
    artifact_verify_count: result.count,
    artifact_verify_threshold: result.threshold,
    artifact_verify_at: new Date().toISOString(),
    artifact_verifier_version: VERIFIER_VERSION,
  };
}

/** List of job types that have artifact verifiers registered */
export const VERIFIED_JOB_TYPES = Object.keys(VERIFIERS);
