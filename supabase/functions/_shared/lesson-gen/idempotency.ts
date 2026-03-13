/**
 * lesson-gen/idempotency.ts — Deduplication and force-regen logic
 */

import { canonicalStepKey } from "../step-keys.ts";

/**
 * Check if a content_version already exists for this lesson+step.
 */
export async function existingVersion(sb: any, lessonId: string, step: string) {
  const canonKey = canonicalStepKey(step);
  const isMini = step === "mini_check" || step === "step_5_minicheck" || canonKey === "step_5_minicheck";

  const { data } = await sb
    .from("content_versions")
    .select("id, content_json")
    .eq("lesson_id", lessonId)
    .eq("step_key", canonKey)
    .eq("entity_type", isMini ? "minicheck" : "lesson_step")
    .neq("status", "rejected")
    .limit(1)
    .maybeSingle();

  return data;
}

/**
 * Check idempotency and handle force-regen for tier1_failed lessons.
 * Returns { skip: true, response } if should skip, or { skip: false } to proceed.
 */
export async function checkIdempotency(
  sb: any,
  lessonId: string,
  stepKey: string,
  stepKeyRaw: string,
  json: (body: unknown, status?: number) => Response,
): Promise<{ skip: boolean; response?: Response }> {
  const { data: lessonQc } = await sb
    .from("lessons")
    .select("qc_status")
    .eq("id", lessonId)
    .maybeSingle();

  const forceRegen = lessonQc?.qc_status === "tier1_failed";

  if (forceRegen) {
    const { data: staleVersions } = await sb
      .from("content_versions")
      .select("id")
      .eq("lesson_id", lessonId)
      .eq("step_key", canonicalStepKey(stepKeyRaw))
      .neq("status", "rejected");

    if (staleVersions && staleVersions.length > 0) {
      const vIds = staleVersions.map((v: any) => v.id);
      await sb.from("content_versions")
        .update({ status: "rejected", updated_at: new Date().toISOString() })
        .in("id", vIds);
      console.log(`[worker] FORCE_REGEN: Rejected ${vIds.length} stale versions for tier1_failed lesson ${lessonId.slice(0, 8)}`);
    }
    return { skip: false };
  }

  const existing = await existingVersion(sb, lessonId, stepKey);
  if (existing) {
    return {
      skip: true,
      response: json({ ok: true, skipped: true, reason: "already_generated", versionId: existing.id }),
    };
  }

  return { skip: false };
}
