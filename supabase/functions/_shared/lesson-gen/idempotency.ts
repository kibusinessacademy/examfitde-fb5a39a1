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
    // Hollow-CV guard: if the stored CV itself is shallow/empty, do NOT skip —
    // the previous run produced a stub. Force regeneration.
    const cvJson = existing.content_json;
    const cvHollow =
      !cvJson ||
      (typeof cvJson === "object" && Object.keys(cvJson).length < 3) ||
      (() => {
        try {
          const t = typeof cvJson === "string" ? cvJson : JSON.stringify(cvJson);
          return t.length < 400 || /Inhalt wird generiert/i.test(t);
        } catch { return false; }
      })();

    if (cvHollow) {
      console.warn(
        `[worker] HOLLOW_CV_DETECTED: lesson=${lessonId.slice(0, 8)} step=${stepKey} — rejecting stub CV and regenerating`,
      );
      try {
        await sb.from("content_versions")
          .update({ status: "rejected", updated_at: new Date().toISOString() })
          .eq("id", existing.id);
      } catch { /* best-effort */ }
      return { skip: false };
    }

    // Self-heal: if approved CV exists but lesson still has placeholder, writeback now
    let writebackOk = true;
    let stillPlaceholderAfterHeal = false;
    try {
      const { data: lessonRow } = await sb
        .from("lessons")
        .select("content")
        .eq("id", lessonId)
        .maybeSingle();

      const content = lessonRow?.content;
      const isStillPlaceholder =
        !content ||
        content?._placeholder === true ||
        content?._regenerating === true ||
        (typeof content === "object" && Object.keys(content).length < 3);

      if (isStillPlaceholder && existing.content_json) {
        console.log(
          `[worker] SELF_HEAL_WRITEBACK: lesson=${lessonId.slice(0, 8)} step=${stepKey} — approved CV exists but lesson still placeholder, repairing`,
        );
        const { error: rpcErr } = await sb.rpc("pipeline_write_lesson_content", {
          p_lesson_id: lessonId,
          p_content: existing.content_json,
        });
        if (rpcErr) {
          writebackOk = false;
          console.warn(`[worker] SELF_HEAL_WRITEBACK_RPC_ERR: ${rpcErr.message?.slice(0, 120)}`);
        } else {
          // Verify the writeback actually replaced the placeholder
          const { data: verifyRow } = await sb
            .from("lessons")
            .select("content")
            .eq("id", lessonId)
            .maybeSingle();
          const vContent = verifyRow?.content;
          stillPlaceholderAfterHeal =
            !vContent ||
            vContent?._placeholder === true ||
            vContent?._regenerating === true ||
            (typeof vContent === "object" && Object.keys(vContent).length < 3);
        }
      }
    } catch (healErr) {
      writebackOk = false;
      console.warn(
        `[worker] SELF_HEAL_WRITEBACK_FAIL: ${(healErr as Error)?.message?.slice(0, 100)}`,
      );
    }

    // If writeback failed or lesson is still placeholder → do not skip, regenerate
    if (!writebackOk || stillPlaceholderAfterHeal) {
      console.warn(
        `[worker] WRITEBACK_INSUFFICIENT: lesson=${lessonId.slice(0, 8)} step=${stepKey} writeback_ok=${writebackOk} still_placeholder=${stillPlaceholderAfterHeal} — forcing regeneration`,
      );
      return { skip: false };
    }

    return {
      skip: true,
      response: json({ ok: true, skipped: true, reason: "already_generated", versionId: existing.id }),
    };
  }

  return { skip: false };
}
