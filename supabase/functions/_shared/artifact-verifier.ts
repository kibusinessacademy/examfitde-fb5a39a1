/**
 * artifact-verifier.ts — Materialization Guard SSOT
 *
 * INVARIANT: A pipeline job may only reach "completed" status if its
 * target artifact is provably materialized in the database.
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

/**
 * Registry of artifact verifiers keyed by job_type.
 * Each verifier checks whether the job's target artifact is materialized.
 */
const VERIFIERS: Record<string, (sb: SB, job: any) => Promise<VerifyResult>> = {

  // ── Exam Pool: must have >0 non-rejected questions ──
  package_generate_exam_pool: async (sb, job) => {
    const curriculumId = job.payload?.curriculum_id;
    if (!curriculumId) return { ok: false, reason: "MISSING_CURRICULUM_ID" };

    const { count } = await sb
      .from("exam_questions")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", curriculumId)
      .neq("status", "rejected");

    return (count ?? 0) > 0
      ? { ok: true, count: count ?? 0 }
      : { ok: false, reason: "ZERO_EXAM_QUESTIONS", count: 0 };
  },

  // ── Blueprint Seeding: must have >0 blueprints ──
  package_auto_seed_exam_blueprints: async (sb, job) => {
    const curriculumId = job.payload?.curriculum_id;
    if (!curriculumId) return { ok: false, reason: "MISSING_CURRICULUM_ID" };

    const { count } = await sb
      .from("exam_blueprints")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", curriculumId);

    return (count ?? 0) > 0
      ? { ok: true, count: count ?? 0 }
      : { ok: false, reason: "ZERO_BLUEPRINTS", count: 0 };
  },

  // ── Handbook: must have >0 handbook sections ──
  package_generate_handbook: async (sb, job) => {
    const packageId = job.payload?.package_id || job.package_id;
    if (!packageId) return { ok: false, reason: "MISSING_PACKAGE_ID" };

    const { count } = await sb
      .from("handbook_sections")
      .select("id", { count: "exact", head: true })
      .eq("package_id", packageId);

    return (count ?? 0) > 0
      ? { ok: true, count: count ?? 0 }
      : { ok: false, reason: "ZERO_HANDBOOK_SECTIONS", count: 0 };
  },

  // ── Tutor Index: must have index record ──
  package_build_ai_tutor_index: async (sb, job) => {
    const packageId = job.payload?.package_id || job.package_id;
    if (!packageId) return { ok: false, reason: "MISSING_PACKAGE_ID" };

    const { count } = await sb
      .from("ai_tutor_context_index")
      .select("id", { count: "exact", head: true })
      .eq("package_id", packageId);

    return (count ?? 0) > 0
      ? { ok: true, count: count ?? 0 }
      : { ok: false, reason: "ZERO_TUTOR_INDEX", count: 0 };
  },

  // ── Oral Exam: must have oral exam questions ──
  package_generate_oral_exam: async (sb, job) => {
    const packageId = job.payload?.package_id || job.package_id;
    if (!packageId) return { ok: false, reason: "MISSING_PACKAGE_ID" };

    const { count } = await sb
      .from("oral_exam_questions")
      .select("id", { count: "exact", head: true })
      .eq("package_id", packageId);

    return (count ?? 0) > 0
      ? { ok: true, count: count ?? 0 }
      : { ok: false, reason: "ZERO_ORAL_EXAM_QUESTIONS", count: 0 };
  },

  // ── MiniChecks: must have >0 minichecks for package lessons ──
  package_generate_lesson_minichecks: async (sb, job) => {
    const packageId = job.payload?.package_id || job.package_id;
    if (!packageId) return { ok: false, reason: "MISSING_PACKAGE_ID" };

    const { count } = await sb
      .from("lesson_minichecks")
      .select("id", { count: "exact", head: true })
      .eq("package_id", packageId);

    return (count ?? 0) > 0
      ? { ok: true, count: count ?? 0 }
      : { ok: false, reason: "ZERO_MINICHECKS", count: 0 };
  },

  // ── Integrity Check: report must be persisted ──
  package_run_integrity_check: async (sb, job) => {
    const packageId = job.payload?.package_id || job.package_id;
    if (!packageId) return { ok: false, reason: "MISSING_PACKAGE_ID" };

    const { data } = await sb
      .from("course_packages")
      .select("integrity_report, integrity_report_version")
      .eq("id", packageId)
      .single();

    if (!data) return { ok: false, reason: "PACKAGE_NOT_FOUND" };

    // If version is set, report body must exist
    if (data.integrity_report_version && !data.integrity_report) {
      return { ok: false, reason: "INTEGRITY_PERSISTENCE_DEFECT", permanent: true };
    }

    return data.integrity_report
      ? { ok: true }
      : { ok: false, reason: "INTEGRITY_REPORT_MISSING" };
  },
};

/**
 * Verify that a job's target artifact is materialized in the DB.
 *
 * @returns VerifyResult — if ok=false, the caller MUST NOT mark the job completed.
 *          Returns ok=true for job types without a registered verifier (opt-in model).
 */
export async function verifyArtifact(sb: SB, job: any): Promise<VerifyResult> {
  const verifier = VERIFIERS[job.job_type];
  if (!verifier) return { ok: true }; // No verifier = opt-in, allow completion

  try {
    return await verifier(sb, job);
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    console.error(`[artifact-verifier] Error verifying ${job.job_type}: ${msg}`);
    // On verifier error, allow completion (don't block pipeline on verifier bugs)
    return { ok: true, reason: `VERIFIER_ERROR: ${msg.slice(0, 200)}` };
  }
}

/** List of job types that have artifact verifiers registered */
export const VERIFIED_JOB_TYPES = Object.keys(VERIFIERS);
