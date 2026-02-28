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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { findNode, findProducer, type PipelineNode } from "./job-map.ts";

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

  for (const artifact of node.requires) {
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
      const { count } = await sb
        .from("exam_questions")
        .select("*", { count: "exact", head: true })
        .eq("curriculum_id", curriculumId)
        .eq("status", "approved");
      const MIN_EXAM_QUESTIONS = Number(Deno.env.get("EXAM_POOL_MIN_APPROVED") ?? "850");
      console.log(`[artifact-resolver] exam_questions count=${count} min=${MIN_EXAM_QUESTIONS} curriculum=${curriculumId.slice(0,8)}`);
      return (count ?? 0) >= MIN_EXAM_QUESTIONS;
    }

    default:
      // For all other artifacts, step status "done" is sufficient
      return true;
  }
}
