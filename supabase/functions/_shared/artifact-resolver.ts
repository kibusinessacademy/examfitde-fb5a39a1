/**
 * Artifact Resolver — Checks whether a pipeline step's required artifacts
 * actually exist in the database before allowing execution.
 *
 * This is the "intelligence layer" on top of the static DAG.
 * Steps declare what they need (requires[]), this module checks reality.
 *
 * IMPORTANT: This is additive — the existing PIPELINE_PREREQS guard in
 * job-runner still runs. This resolver adds artifact-level verification
 * for steps that declare `requires` in the PIPELINE_GRAPH.
 *
 * KEY: exam_questions has NO package_id column.
 * All exam lookups MUST go through curriculum_id (resolved via course_packages).
 */

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { findNode, findProducer, type PipelineNode } from "./job-map.ts";
import { getTrackArtifactOverride, ELITE_HARDEN_MIN_APPROVED } from "./track-prereqs.ts";
import { normalizeTrack } from "./track-normalize.ts";

export interface ArtifactCheckResult {
  ready: boolean;
  /** If not ready: which artifact is missing */
  missingArtifact?: string;
  /** If not ready: which step produces the missing artifact */
  producerStep?: string;
}

/**
 * Check if all required artifacts for a step exist.
 * Returns { ready: true } if all artifacts are satisfied,
 * or { ready: false, missingArtifact, producerStep } on first missing one.
 */
export async function checkArtifacts(
  sb: ReturnType<typeof createClient>,
  packageId: string,
  stepKey: string,
): Promise<ArtifactCheckResult> {
  const node = findNode(stepKey);
  if (!node?.requires?.length) return { ready: true };

  // ── Track-aware override ───────────────────────────────────────────
  // Resolve the package's track to determine which artifacts are actually needed.
  // EXAM_FIRST skips elite_harden → run_integrity_check must NOT require elite_ready.
  const { data: pkg } = await sb
    .from("course_packages")
    .select("track, curriculum_id")
    .eq("id", packageId)
    .maybeSingle();
  const track = normalizeTrack((pkg as any)?.track);

  // ── EXAM_FIRST elite_harden eligibility gate ──────────────────────
  // elite_harden is allowed for exam-centric tracks but only if >= 60 approved questions.
  // Below threshold → skip silently (not an error, just not eligible yet).
  if (stepKey === "elite_harden" && (track === "EXAM_FIRST" || track === "EXAM_FIRST_PLUS") && pkg?.curriculum_id) {
    const { count } = await sb
      .from("exam_questions")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", pkg.curriculum_id)
      .eq("status", "approved");
    if ((count ?? 0) < ELITE_HARDEN_MIN_APPROVED) {
      console.log(`[artifact-resolver] elite_harden skipped for ${track}: only ${count ?? 0} approved (need ${ELITE_HARDEN_MIN_APPROVED})`);
      return { ready: false, missingArtifact: "elite_harden_eligibility", producerStep: "generate_exam_pool" };
    }
    console.log(`[artifact-resolver] elite_harden ELIGIBLE for ${track}: ${count} approved >= ${ELITE_HARDEN_MIN_APPROVED}`);
  }

  // Check for a track-specific override; fall back to static PIPELINE_GRAPH.requires[]
  const trackOverride = getTrackArtifactOverride(stepKey, track);
  const effectiveRequires = trackOverride ?? node.requires;

  if (!effectiveRequires.length) {
    console.log(`[artifact-resolver] Step ${stepKey} has no required artifacts for track ${track} — ready`);
    return { ready: true };
  }

  for (const artifact of effectiveRequires) {
    const exists = await artifactExists(sb, packageId, artifact);
    if (!exists) {
      const producer = findProducer(artifact);
      return {
        ready: false,
        missingArtifact: artifact,
        producerStep: producer?.key,
      };
    }
  }

  return { ready: true };
}

/** Resolve curriculum_id for a package (cached per request via closure) */
async function getCurriculumId(
  sb: ReturnType<typeof createClient>,
  packageId: string,
): Promise<string | null> {
  const { data } = await sb
    .from("course_packages")
    .select("curriculum_id")
    .eq("id", packageId)
    .maybeSingle();
  return data?.curriculum_id ?? null;
}

/**
 * Check if a specific artifact exists for a package.
 *
 * Strategy: For most artifacts, we check if the producing step is "done"
 * in package_steps. For key artifacts (exam_questions, validated_exam_pool),
 * we also verify actual data exists — this catches cases where a step
 * marked "done" but data was lost or incomplete.
 *
 * CRITICAL: exam_questions has NO package_id column.
 * Must resolve via course_packages → curriculum_id.
 */
async function artifactExists(
  sb: ReturnType<typeof createClient>,
  packageId: string,
  artifact: string,
): Promise<boolean> {
  // Find which step produces this artifact
  const producer = findProducer(artifact);
  if (!producer) return false;

  // Primary check: is the producing step done?
  const { data: step } = await sb
    .from("package_steps")
    .select("status")
    .eq("package_id", packageId)
    .eq("step_key", producer.key)
    .maybeSingle();

  if (!step) return false;
  // "done" or "skipped" both count as fulfilled
  if (step.status !== "done" && step.status !== "skipped") return false;

  // Secondary data-integrity checks for critical artifacts
  switch (artifact) {
    case "exam_questions":
    case "validated_exam_pool": {
      // exam_questions has NO package_id — must resolve via curriculum_id
      const curriculumId = await getCurriculumId(sb, packageId);
      if (!curriculumId) {
        console.warn(`[artifact-resolver] No curriculum_id for package ${packageId.slice(0, 8)} — cannot verify artifact, returning not-ready`);
        return false; // surface the issue instead of silently trusting step status
      }

      // CRITICAL FIX: "exam_questions" artifact = questions EXIST (any status).
      // "validated_exam_pool" artifact = questions are QC-approved/tier1_passed.
      // Previously both used the approved filter, causing a deadlock when
      // generate_exam_pool creates draft questions and validate_exam_pool
      // (which is supposed to DO the validation) can't start because the
      // artifact check demands already-validated questions.
      let readyQuery = sb
        .from("exam_questions")
        .select("id", { count: "exact", head: true })
        .eq("curriculum_id", curriculumId);

      if (artifact === "validated_exam_pool") {
        // Only validated_exam_pool needs the strict QC filter — use SSOT constants
        readyQuery = readyQuery.or("status.eq.approved,qc_status.eq.approved,qc_status.eq.tier1_passed");
      }
      // For "exam_questions" artifact: count ALL questions (draft included)

      const { count: readyCount } = await readyQuery;

      // Dynamic threshold: if generator stored a target, respect it, but never
      // require more than actually generated in this package run (loop-capped safety).
      const { data: genStep } = await sb
        .from("package_steps")
        .select("meta")
        .eq("package_id", packageId)
        .eq("step_key", "generate_exam_pool")
        .maybeSingle();

      const meta = (genStep?.meta ?? {}) as Record<string, unknown>;
      const toNum = (v: unknown) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      };

      const generatedTotal = toNum(meta.total_questions);
      const declaredTarget = toNum(meta.ship_target) || toNum(meta.target) || toNum(meta.exam_target);
      const fallbackMin = Number(Deno.env.get("EXAM_POOL_MIN_READY") ?? "1");

      let requiredMin = declaredTarget > 0 ? declaredTarget : fallbackMin;
      if (generatedTotal > 0) requiredMin = Math.min(requiredMin, generatedTotal);
      requiredMin = Math.max(1, requiredMin);

      console.log(
        `[artifact-resolver] exam_ready=${readyCount ?? 0} required=${requiredMin} curriculum=${curriculumId.slice(0, 8)} (generated_total=${generatedTotal}, declared_target=${declaredTarget})`,
      );
      return (readyCount ?? 0) >= requiredMin;
    }


    case "handbook": {
      // Handbook integrity: step "done" is NOT enough — chapters must have actual content.
      // Semantics: count CHAPTERS that have ≥1 non-empty section (not raw section count).
      const currId = await getCurriculumId(sb, packageId);
      if (!currId) {
        console.warn(`[artifact-resolver] No curriculum_id for package ${packageId.slice(0, 8)} — handbook not verifiable`);
        return false;
      }

      // NOTE: Chapter count is the SSOT for handbook completeness, NOT learning_fields count.
      // A handbook may have fewer chapters than learning fields (multi-LF chapters).

      // Load all chapters
      const { data: chapters } = await sb
        .from("handbook_chapters")
        .select("id")
        .eq("curriculum_id", currId);

      if (!chapters?.length) {
        console.warn(`[artifact-resolver] handbook: 0 chapters for curriculum ${currId.slice(0, 8)}`);
        return false;
      }

      // Per-chapter check: does each chapter have ≥1 section with real content (>500 chars)?
      const chapterIds = chapters.map((c: any) => c.id);
      const { data: populatedSections } = await sb
        .from("handbook_sections")
        .select("chapter_id")
        .in("chapter_id", chapterIds)
        .gt("content_markdown", "");

      // Deduplicate: count distinct chapters that have content
      const coveredChapterIds = new Set(
        (populatedSections ?? []).map((s: any) => s.chapter_id)
      );
      const coveredChapters = coveredChapterIds.size;
      const totalChapters = chapters.length;

      // Completion gate: 100% of actual chapters must have content (hardened v8).
      // Every chapter needs ≥1 section with real content (>500 chars).
      const minCoverage = 1.0;
      const minChaptersNeeded = Math.max(1, Math.ceil(totalChapters * minCoverage));
      const ok = coveredChapters >= minChaptersNeeded;

      console.log(
        `[artifact-resolver] handbook: ${coveredChapters}/${totalChapters} chapters with content (need ${minChaptersNeeded}), curriculum=${currId.slice(0, 8)} → ${ok ? 'READY' : 'NOT READY'}`,
      );

      if (!ok) {
        console.warn(`[artifact-resolver] SSOT VIOLATION: generate_handbook=done but only ${coveredChapters}/${minChaptersNeeded} chapters populated.`);
      }

      return ok;
    }

    default:
      // For all other artifacts, step status "done" is sufficient
      return true;
  }
}
