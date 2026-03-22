/**
 * artifact-verifier.ts — Materialization Guard SSOT
 *
 * INVARIANT: A pipeline job may only reach "completed" status if its
 * target artifact is provably materialized in the database.
 *
 * v4: All thresholds imported from artifact-thresholds.ts (central SSOT).
 *     No inline magic numbers — every min/floor comes from the shared module.
 */

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  resolveThreshold,
  formatThresholdFail,
  THRESHOLD_VERSION,
} from "./artifact-thresholds.ts";

type SB = ReturnType<typeof createClient>;

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  count?: number;
  threshold?: number;
  permanent?: boolean;
}

export interface VerifyAuditMeta {
  artifact_verified: boolean;
  artifact_verify_reason?: string;
  artifact_verify_count?: number;
  artifact_verify_threshold?: number;
  artifact_verify_at: string;
  artifact_verifier_version: number;
  threshold_version: number;
}

const VERIFIER_VERSION = 4;

// ── Shared helpers ──────────────────────────────────────────────

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

function requirePayloadId(job: any, key: "package_id" | "curriculum_id"): { id: string } | VerifyResult {
  const id = job.payload?.[key] || (key === "package_id" ? job.package_id : undefined);
  if (!id) return { ok: false, reason: `MISSING_${key.toUpperCase()}`, permanent: true };
  return { id };
}

async function resolvePackage(sb: SB, packageId: string) {
  const { data, error } = await sb
    .from("course_packages")
    .select("course_id, curriculum_id, meta")
    .eq("id", packageId)
    .single();
  return { pkg: data, error };
}

async function countLearningFields(sb: SB, curriculumId: string) {
  return safeCount(sb, "learning_fields", (q) => q.eq("curriculum_id", curriculumId));
}

async function countCompetencies(sb: SB, curriculumId: string) {
  const { data: lfs } = await sb
    .from("learning_fields")
    .select("id")
    .eq("curriculum_id", curriculumId);
  if (!lfs || lfs.length === 0) return { count: 0 };
  return safeCount(sb, "competencies", (q) => q.in("learning_field_id", lfs.map((lf: any) => lf.id)));
}

// ── Threshold-aware result builder ──────────────────────────────

function thresholdCheck(
  stepKey: string,
  artifact: string,
  actual: number,
  ctx: Record<string, number> = {},
): VerifyResult {
  const threshold = resolveThreshold(stepKey, artifact, ctx);
  if (actual >= threshold) {
    return { ok: true, count: actual, threshold };
  }
  return {
    ok: false,
    reason: formatThresholdFail(stepKey, artifact, actual, threshold),
    count: actual,
    threshold,
  };
}

// ── Verifier Registry ───────────────────────────────────────────

const VERIFIERS: Record<string, (sb: SB, job: any) => Promise<VerifyResult>> = {

  package_scaffold_learning_course: async (sb, job) => {
    const r = requirePayloadId(job, "package_id");
    if ("ok" in r) return r;

    const { pkg, error: pkgErr } = await resolvePackage(sb, r.id);
    if (pkgErr || !pkg) return { ok: false, reason: "PACKAGE_NOT_FOUND", permanent: true };

    const { count: moduleCount, error: modErr } = await safeCount(sb, "modules", (q) =>
      q.eq("course_id", pkg.course_id),
    );
    if (modErr) return { ok: false, reason: `QUERY_ERROR: ${modErr}` };

    const { count: lfCount } = await countLearningFields(sb, pkg.curriculum_id);
    const moduleResult = thresholdCheck("scaffold_learning_course", "modules", moduleCount, {
      learningFieldCount: lfCount,
    });
    if (!moduleResult.ok) return moduleResult;

    const { data: mods } = await sb.from("modules").select("id").eq("course_id", pkg.course_id);
    if (!mods || mods.length === 0) return { ok: false, reason: "ZERO_MODULES", count: 0, threshold: 1 };

    const { count: lessonCount, error: lErr } = await safeCount(sb, "lessons", (q) =>
      q.in("module_id", mods.map((m: any) => m.id)),
    );
    if (lErr) return { ok: false, reason: `QUERY_ERROR: ${lErr}` };

    const { count: compCount } = await countCompetencies(sb, pkg.curriculum_id);
    return thresholdCheck("scaffold_learning_course", "lessons", lessonCount, {
      competencyCount: compCount,
    });
  },

  package_generate_glossary: async (sb, job) => {
    const r = requirePayloadId(job, "curriculum_id");
    if ("ok" in r) return r;

    const { data: cur, error: curErr } = await sb
      .from("curricula").select("beruf_id").eq("id", r.id).single();
    if (curErr || !cur?.beruf_id) return { ok: false, reason: "NO_BERUF_ID", permanent: true };

    const { count, error } = await safeCount(sb, "profession_glossaries", (q) =>
      q.eq("beruf_id", cur.beruf_id),
    );
    if (error) return { ok: false, reason: `QUERY_ERROR: ${error}` };

    return thresholdCheck("generate_glossary", "glossary_entries", count);
  },

  package_generate_exam_pool: async (sb, job) => {
    const r = requirePayloadId(job, "curriculum_id");
    if ("ok" in r) return r;

    // Get exam_target from package meta for proportional threshold
    const pkgId = job.payload?.package_id || job.package_id;
    let examTarget = 1000;
    if (pkgId) {
      const { pkg } = await resolvePackage(sb, pkgId);
      const meta = (pkg?.meta ?? {}) as Record<string, unknown>;
      examTarget = Number(meta.exam_target) || 1000;
    }

    const { count, error } = await safeCount(sb, "exam_questions", (q) =>
      q.eq("curriculum_id", r.id).neq("status", "rejected"),
    );
    if (error) return { ok: false, reason: `QUERY_ERROR: ${error}` };

    return thresholdCheck("generate_exam_pool", "exam_questions", count, { examTarget });
  },

  package_auto_seed_exam_blueprints: async (sb, job) => {
    const r = requirePayloadId(job, "curriculum_id");
    if ("ok" in r) return r;

    const { count: bpCount, error } = await safeCount(sb, "question_blueprints", (q) =>
      q.eq("curriculum_id", r.id),
    );
    if (error) return { ok: false, reason: `QUERY_ERROR: ${error}` };

    const { count: lfCount } = await countLearningFields(sb, r.id);
    return thresholdCheck("auto_seed_exam_blueprints", "question_blueprints", bpCount, {
      learningFieldCount: lfCount,
    });
  },

  package_generate_handbook: async (sb, job) => {
    const r = requirePayloadId(job, "curriculum_id");
    if ("ok" in r) return r;

    const { data: chapters, error: chErr } = await sb
      .from("handbook_chapters").select("id").eq("curriculum_id", r.id);
    if (chErr) return { ok: false, reason: `QUERY_ERROR: ${chErr.message}` };
    if (!chapters || chapters.length === 0) return { ok: false, reason: "ZERO_HANDBOOK_CHAPTERS", count: 0, threshold: 1 };

    const { count, error } = await safeCount(sb, "handbook_sections", (q) =>
      q.in("chapter_id", chapters.map((c: any) => c.id)),
    );
    if (error) return { ok: false, reason: `QUERY_ERROR: ${error}` };

    return thresholdCheck("generate_handbook", "handbook_sections", count, {
      chapterCount: chapters.length,
    });
  },

  package_build_ai_tutor_index: async (sb, job) => {
    const r = requirePayloadId(job, "package_id");
    if ("ok" in r) return r;

    const { count, error } = await safeCount(sb, "ai_tutor_context_index", (q) =>
      q.eq("package_id", r.id),
    );
    if (error) return { ok: false, reason: `QUERY_ERROR: ${error}` };

    return thresholdCheck("build_ai_tutor_index", "ai_tutor_context_index", count);
  },

  package_generate_oral_exam: async (sb, job) => {
    const r = requirePayloadId(job, "curriculum_id");
    if ("ok" in r) return r;

    const { count, error } = await safeCount(sb, "oral_exam_blueprints", (q) =>
      q.eq("curriculum_id", r.id),
    );
    if (error) return { ok: false, reason: `QUERY_ERROR: ${error}` };

    return thresholdCheck("generate_oral_exam", "oral_exam_blueprints", count);
  },

  package_generate_lesson_minichecks: async (sb, job) => {
    const r = requirePayloadId(job, "curriculum_id");
    if ("ok" in r) return r;

    const { count, error } = await safeCount(sb, "minicheck_questions", (q) =>
      q.eq("curriculum_id", r.id),
    );
    if (error) return { ok: false, reason: `QUERY_ERROR: ${error}` };

    return thresholdCheck("generate_lesson_minichecks", "minicheck_questions", count);
  },

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

    if (data.integrity_report_version && !data.integrity_report) {
      return { ok: false, reason: "INTEGRITY_PERSISTENCE_DEFECT", permanent: true };
    }
    if (!data.integrity_report) return { ok: false, reason: "INTEGRITY_REPORT_MISSING" };
    if (!data.integrity_report_version) return { ok: false, reason: "INTEGRITY_VERSION_MISSING" };

    const report = typeof data.integrity_report === "object" ? data.integrity_report : null;
    if (!report) return { ok: false, reason: "INTEGRITY_REPORT_INVALID_TYPE" };

    const reportKeys = Object.keys(report as Record<string, unknown>);
    const minKeys = resolveThreshold("run_integrity_check", "integrity_report_keys");
    if (reportKeys.length < minKeys) {
      return {
        ok: false,
        reason: formatThresholdFail("run_integrity_check", "integrity_report_keys", reportKeys.length, minKeys),
        count: reportKeys.length,
        threshold: minKeys,
      };
    }

    // Freshness check
    const jobStarted = job.locked_at || job.started_at;
    if (jobStarted) {
      const reportGeneratedAt = (report as any)?.generated_at;
      if (reportGeneratedAt) {
        const reportTime = new Date(reportGeneratedAt).getTime();
        const jobTime = new Date(jobStarted).getTime();
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
 * FAIL-CLOSED: registered job types block on any verifier error.
 */
export async function verifyArtifact(sb: SB, job: any): Promise<VerifyResult> {
  const verifier = VERIFIERS[job.job_type];
  if (!verifier) return { ok: true };

  try {
    return await verifier(sb, job);
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    console.error(`[artifact-verifier] FAIL-CLOSED: Error verifying ${job.job_type}: ${msg}`);
    return { ok: false, reason: `VERIFIER_ERROR: ${msg.slice(0, 200)}`, permanent: false };
  }
}

export function buildVerifyAuditMeta(result: VerifyResult): VerifyAuditMeta {
  return {
    artifact_verified: result.ok,
    artifact_verify_reason: result.reason,
    artifact_verify_count: result.count,
    artifact_verify_threshold: result.threshold,
    artifact_verify_at: new Date().toISOString(),
    artifact_verifier_version: VERIFIER_VERSION,
    threshold_version: THRESHOLD_VERSION,
  };
}

export const VERIFIED_JOB_TYPES = Object.keys(VERIFIERS);
