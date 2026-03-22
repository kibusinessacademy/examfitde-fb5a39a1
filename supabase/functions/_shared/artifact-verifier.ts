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

/** Audit metadata written to job.meta on verification */
export interface VerifyAuditMeta {
  artifact_verified: boolean;
  artifact_verify_reason?: string;
  artifact_verify_count?: number;
  artifact_verify_at: string;
  artifact_verifier_version: number;
}

/** Current verifier contract version — bump on logic changes */
const VERIFIER_VERSION = 2;

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

/** Helper: extract packageId or curriculumId with permanent failure on missing */
function requirePayloadId(job: any, key: "package_id" | "curriculum_id"): { id: string } | VerifyResult {
  const id = job.payload?.[key] || (key === "package_id" ? job.package_id : undefined);
  if (!id) return { ok: false, reason: `MISSING_${key.toUpperCase()}`, permanent: true };
  return { id };
}

/**
 * Registry of artifact verifiers keyed by job_type.
 * Each verifier checks the REAL SSOT relation for artifact materialization.
 */
const VERIFIERS: Record<string, (sb: SB, job: any) => Promise<VerifyResult>> = {

  // ── Exam Pool: exam_questions by curriculum_id, non-rejected ──
  package_generate_exam_pool: async (sb, job) => {
    const r = requirePayloadId(job, "curriculum_id");
    if ("ok" in r) return r;

    const { count, error } = await safeCount(sb, "exam_questions", (q) =>
      q.eq("curriculum_id", r.id).neq("status", "rejected"),
    );
    if (error) return { ok: false, reason: `QUERY_ERROR: ${error}` };

    return count > 0
      ? { ok: true, count }
      : { ok: false, reason: "ZERO_EXAM_QUESTIONS", count: 0 };
  },

  // ── Blueprint Seeding: question_blueprints by curriculum_id ──
  // CRITICAL FIX (P0): Worker writes to `question_blueprints`, NOT `exam_blueprints`.
  // Previous code checked the wrong table, causing false ZERO_BLUEPRINTS for 295/311 packages.
  package_auto_seed_exam_blueprints: async (sb, job) => {
    const r = requirePayloadId(job, "curriculum_id");
    if ("ok" in r) return r;

    const { count, error } = await safeCount(sb, "question_blueprints", (q) =>
      q.eq("curriculum_id", r.id),
    );
    if (error) return { ok: false, reason: `QUERY_ERROR: ${error}` };

    return count > 0
      ? { ok: true, count }
      : { ok: false, reason: "ZERO_BLUEPRINTS", count: 0 };
  },

  // ── Handbook: handbook_sections via handbook_chapters.curriculum_id ──
  // SSOT chain: handbook_sections → chapter_id → handbook_chapters → curriculum_id
  package_generate_handbook: async (sb, job) => {
    const r = requirePayloadId(job, "curriculum_id");
    if ("ok" in r) return r;

    // First get chapter IDs for this curriculum
    const { data: chapters, error: chErr } = await sb
      .from("handbook_chapters")
      .select("id")
      .eq("curriculum_id", r.id);
    if (chErr) return { ok: false, reason: `QUERY_ERROR: ${chErr.message}` };
    if (!chapters || chapters.length === 0) return { ok: false, reason: "ZERO_HANDBOOK_CHAPTERS", count: 0 };

    const chapterIds = chapters.map((c: any) => c.id);
    const { count, error } = await safeCount(sb, "handbook_sections", (q) =>
      q.in("chapter_id", chapterIds),
    );
    if (error) return { ok: false, reason: `QUERY_ERROR: ${error}` };

    return count > 0
      ? { ok: true, count }
      : { ok: false, reason: "ZERO_HANDBOOK_SECTIONS", count: 0 };
  },

  // ── Tutor Index: ai_tutor_context_index by package_id ──
  package_build_ai_tutor_index: async (sb, job) => {
    const r = requirePayloadId(job, "package_id");
    if ("ok" in r) return r;

    const { count, error } = await safeCount(sb, "ai_tutor_context_index", (q) =>
      q.eq("package_id", r.id),
    );
    if (error) return { ok: false, reason: `QUERY_ERROR: ${error}` };

    return count > 0
      ? { ok: true, count }
      : { ok: false, reason: "ZERO_TUTOR_INDEX", count: 0 };
  },

  // ── Oral Exam: oral_exam_blueprints by curriculum_id ──
  // The pipeline artifact is oral_exam_blueprints (scenario + lead questions + rubric).
  // oral_exam_questions is a RUNTIME table populated during learner exam sessions,
  // NOT a pipeline artifact. Checking it here caused infinite fail loops.
  package_generate_oral_exam: async (sb, job) => {
    const r = requirePayloadId(job, "curriculum_id");
    if ("ok" in r) return r;

    const { count, error } = await safeCount(sb, "oral_exam_blueprints", (q) =>
      q.eq("curriculum_id", r.id),
    );
    if (error) return { ok: false, reason: `QUERY_ERROR: ${error}` };

    // Require minimum 10 blueprints (matches validate-oral-exam MIN_BLUEPRINTS)
    const MIN_BLUEPRINTS = 10;
    return count >= MIN_BLUEPRINTS
      ? { ok: true, count }
      : { ok: false, reason: `INSUFFICIENT_ORAL_BLUEPRINTS: ${count}/${MIN_BLUEPRINTS}`, count };
  },

  // ── MiniChecks: minicheck_questions by curriculum_id ──
  // SSOT table: minicheck_questions (has curriculum_id + lesson_id directly)
  package_generate_lesson_minichecks: async (sb, job) => {
    const r = requirePayloadId(job, "curriculum_id");
    if ("ok" in r) return r;

    const { count, error } = await safeCount(sb, "minicheck_questions", (q) =>
      q.eq("curriculum_id", r.id),
    );
    if (error) return { ok: false, reason: `QUERY_ERROR: ${error}` };

    return count > 0
      ? { ok: true, count }
      : { ok: false, reason: "ZERO_MINICHECKS", count: 0 };
  },

  // ── Integrity Check: report + version must be persisted and fresh ──
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

    // Freshness check: report must be generated after job started
    const jobStarted = job.locked_at || job.started_at;
    if (jobStarted && data.integrity_report) {
      const report = typeof data.integrity_report === "object" ? data.integrity_report : null;
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

/**
 * Build audit metadata for the job's meta field.
 * Call after verifyArtifact() and write into job.meta for forensic traceability.
 */
export function buildVerifyAuditMeta(result: VerifyResult): VerifyAuditMeta {
  return {
    artifact_verified: result.ok,
    artifact_verify_reason: result.reason,
    artifact_verify_count: result.count,
    artifact_verify_at: new Date().toISOString(),
    artifact_verifier_version: VERIFIER_VERSION,
  };
}

/** List of job types that have artifact verifiers registered */
export const VERIFIED_JOB_TYPES = Object.keys(VERIFIERS);
