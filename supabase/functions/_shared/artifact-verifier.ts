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
 * This module is called by job-runner and content-runner BEFORE writing
 * "completed" status. If verification fails, the job is forced to
 * "pending" (retry) or "failed" (terminal).
 */

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

type SB = ReturnType<typeof createClient>;

export interface VerifyResult {
  /** Whether the artifact exists in the DB */
  ok: boolean;
  /** Human-readable reason for failure */
  reason?: string;
  /** Measured count or metric */
  count?: number;
  /** Whether this is a permanent failure (no retry) */
  permanent?: boolean;
}

/** Helper: run a count query with explicit error handling */
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

/**
 * Registry of artifact verifiers keyed by job_type.
 * Each verifier checks whether the job's target artifact is materialized.
 */
const VERIFIERS: Record<string, (sb: SB, job: any) => Promise<VerifyResult>> = {

  // ── Exam Pool: must have >0 non-rejected questions ──
  package_generate_exam_pool: async (sb, job) => {
    const curriculumId = job.payload?.curriculum_id;
    if (!curriculumId) return { ok: false, reason: "MISSING_CURRICULUM_ID" };

    const { count, error } = await safeCount(sb, "exam_questions", (q) =>
      q.eq("curriculum_id", curriculumId).neq("status", "rejected"),
    );
    if (error) return { ok: false, reason: `QUERY_ERROR: ${error}` };

    return count > 0
      ? { ok: true, count }
      : { ok: false, reason: "ZERO_EXAM_QUESTIONS", count: 0 };
  },

  // ── Blueprint Seeding: must have >0 blueprints ──
  package_auto_seed_exam_blueprints: async (sb, job) => {
    const curriculumId = job.payload?.curriculum_id;
    if (!curriculumId) return { ok: false, reason: "MISSING_CURRICULUM_ID" };

    const { count, error } = await safeCount(sb, "exam_blueprints", (q) =>
      q.eq("curriculum_id", curriculumId),
    );
    if (error) return { ok: false, reason: `QUERY_ERROR: ${error}` };

    return count > 0
      ? { ok: true, count }
      : { ok: false, reason: "ZERO_BLUEPRINTS", count: 0 };
  },

  // ── Handbook: must have >0 handbook sections ──
  package_generate_handbook: async (sb, job) => {
    const packageId = job.payload?.package_id || job.package_id;
    if (!packageId) return { ok: false, reason: "MISSING_PACKAGE_ID" };

    const { count, error } = await safeCount(sb, "handbook_sections", (q) =>
      q.eq("package_id", packageId),
    );
    if (error) return { ok: false, reason: `QUERY_ERROR: ${error}` };

    return count > 0
      ? { ok: true, count }
      : { ok: false, reason: "ZERO_HANDBOOK_SECTIONS", count: 0 };
  },

  // ── Tutor Index: must have index record ──
  package_build_ai_tutor_index: async (sb, job) => {
    const packageId = job.payload?.package_id || job.package_id;
    if (!packageId) return { ok: false, reason: "MISSING_PACKAGE_ID" };

    const { count, error } = await safeCount(sb, "ai_tutor_context_index", (q) =>
      q.eq("package_id", packageId),
    );
    if (error) return { ok: false, reason: `QUERY_ERROR: ${error}` };

    return count > 0
      ? { ok: true, count }
      : { ok: false, reason: "ZERO_TUTOR_INDEX", count: 0 };
  },

  // ── Oral Exam: must have oral exam questions ──
  package_generate_oral_exam: async (sb, job) => {
    const packageId = job.payload?.package_id || job.package_id;
    if (!packageId) return { ok: false, reason: "MISSING_PACKAGE_ID" };

    const { count, error } = await safeCount(sb, "oral_exam_questions", (q) =>
      q.eq("package_id", packageId),
    );
    if (error) return { ok: false, reason: `QUERY_ERROR: ${error}` };

    return count > 0
      ? { ok: true, count }
      : { ok: false, reason: "ZERO_ORAL_EXAM_QUESTIONS", count: 0 };
  },

  // ── MiniChecks: must have >0 minichecks for package lessons ──
  package_generate_lesson_minichecks: async (sb, job) => {
    const packageId = job.payload?.package_id || job.package_id;
    if (!packageId) return { ok: false, reason: "MISSING_PACKAGE_ID" };

    const { count, error } = await safeCount(sb, "lesson_minichecks", (q) =>
      q.eq("package_id", packageId),
    );
    if (error) return { ok: false, reason: `QUERY_ERROR: ${error}` };

    return count > 0
      ? { ok: true, count }
      : { ok: false, reason: "ZERO_MINICHECKS", count: 0 };
  },

  // ── Integrity Check: report must be persisted AND fresh ──
  package_run_integrity_check: async (sb, job) => {
    const packageId = job.payload?.package_id || job.package_id;
    if (!packageId) return { ok: false, reason: "MISSING_PACKAGE_ID" };

    const { data, error } = await sb
      .from("course_packages")
      .select("integrity_report, integrity_report_version, updated_at")
      .eq("id", packageId)
      .single();

    if (error) return { ok: false, reason: `QUERY_ERROR: ${error.message}` };
    if (!data) return { ok: false, reason: "PACKAGE_NOT_FOUND" };

    // Version set but body missing = persistence defect (permanent)
    if (data.integrity_report_version && !data.integrity_report) {
      return { ok: false, reason: "INTEGRITY_PERSISTENCE_DEFECT", permanent: true };
    }

    // Report must exist
    if (!data.integrity_report) {
      return { ok: false, reason: "INTEGRITY_REPORT_MISSING" };
    }

    // Version must be set alongside report
    if (!data.integrity_report_version) {
      return { ok: false, reason: "INTEGRITY_VERSION_MISSING" };
    }

    return { ok: true };
  },
};

/**
 * Verify that a job's target artifact is materialized in the DB.
 *
 * FAIL-CLOSED: For registered job types, any verifier error blocks completion.
 * Only unregistered job types pass through (opt-in model).
 *
 * @returns VerifyResult — if ok=false, the caller MUST NOT mark the job completed.
 */
export async function verifyArtifact(sb: SB, job: any): Promise<VerifyResult> {
  const verifier = VERIFIERS[job.job_type];
  if (!verifier) return { ok: true }; // No verifier = opt-in, allow completion

  try {
    return await verifier(sb, job);
  } catch (err) {
    // FAIL-CLOSED: verifier crash blocks completion for registered types
    const msg = (err as Error)?.message ?? String(err);
    console.error(`[artifact-verifier] FAIL-CLOSED: Error verifying ${job.job_type}: ${msg}`);
    return {
      ok: false,
      reason: `VERIFIER_ERROR: ${msg.slice(0, 200)}`,
      permanent: false, // Allow retry — verifier may recover
    };
  }
}

/** List of job types that have artifact verifiers registered */
export const VERIFIED_JOB_TYPES = Object.keys(VERIFIERS);
