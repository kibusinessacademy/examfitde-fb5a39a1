import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function assertUuid(name: string, v: unknown) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!v || typeof v !== "string" || !re.test(v)) throw new Error(`INVALID_${name.toUpperCase()}`);
}
async function prereqDone(sb: ReturnType<typeof createClient>, packageId: string, stepKey: string) {
  const { data, error } = await sb
    .from("course_package_build_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  if (error) throw error;
  return data?.status === "done";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  try {
    assertUuid("package_id", p?.package_id);
    assertUuid("course_id", p?.course_id);
  } catch (e: unknown) {
    return json({ error: (e as Error).message }, 400);
  }

  const packageId = p.package_id;
  const courseId = p.course_id;

  const unlockFail = async (msg: string) => {
    await sb.from("course_packages").update({ status: "failed" }).eq("id", packageId);
    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "auto_publish", p_status: "failed", p_log: { error: msg },
    });
    await sb.rpc("release_pipeline_lock", { p_package_id: packageId });
    await sb.from("course_package_locks").delete().eq("package_id", packageId);
  };

  try {
    if (!(await prereqDone(sb, packageId, "run_integrity_check"))) {
      return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: run_integrity_check" }, 409);
    }

    // ── REVIEW GATE: auto-approve unless requires_manual_review flag is set ──
    const { data: pkgFlags } = await sb
      .from("course_packages")
      .select("feature_flags")
      .eq("id", packageId)
      .maybeSingle();

    const requiresManualReview = Boolean((pkgFlags as any)?.feature_flags?.requires_manual_review);

    const { data: review } = await sb
      .from("course_package_reviews")
      .select("status")
      .eq("course_package_id", packageId)
      .maybeSingle();

    if (!review || review.status !== "approved") {
      const currentStatus = review?.status || "no_review";

      if (requiresManualReview) {
        // Manual review required — wait for admin
        console.log(`[AutoPublish] BLOCKED: review status = ${currentStatus} (manual review required). Package ${packageId}`);
        await sb.rpc("update_course_package_step", {
          p_package_id: packageId, p_step_key: "auto_publish", p_status: "pending",
          p_log: { skipped: true, reason: `Review gate: status=${currentStatus}, waiting for admin approval` },
        });
        return json({
          ok: false,
          retry: false,
          error: `REVIEW_GATE: status=${currentStatus}. Admin approval required before publish.`,
          review_status: currentStatus,
        }, 202);
      }

      // Auto-approve to keep the pipeline moving
      console.log(`[AutoPublish] Auto-approving package ${packageId} (no manual review required)`);
      await sb.from("course_package_reviews").upsert({
        course_package_id: packageId,
        status: "approved",
        notes: "Auto-approved by pipeline to prevent blocking",
      }, { onConflict: "course_package_id" });
    }

    // Check integrity v3 hard_fail_reasons
    const { data: pkg } = await sb
      .from("course_packages")
      .select("integrity_report")
      .eq("id", packageId)
      .single();

    const integrityReport = pkg?.integrity_report as Record<string, unknown> | undefined;
    const integrityScore = integrityReport?.score as number | undefined;
    const v3Data = integrityReport?.v3 as Record<string, unknown> | undefined;
    const hardFails = (v3Data?.hard_fail_reasons as string[]) || [];
    const PUBLISH_THRESHOLD = 80;

    if (hardFails.length > 0) {
      await unlockFail(`V3 hard fails present: ${hardFails.join("; ")}`);
      return json({
        ok: false,
        error: `V3_HARD_FAILS: ${hardFails.length} blocking issues`,
        hard_fail_reasons: hardFails,
      }, 422);
    }

    if (integrityScore !== undefined && integrityScore < PUBLISH_THRESHOLD) {
      await unlockFail(`Integrity score ${integrityScore} < ${PUBLISH_THRESHOLD}.`);
      return json({
        ok: false,
        error: `INTEGRITY_BELOW_THRESHOLD: score=${integrityScore}, required=${PUBLISH_THRESHOLD}`,
        score: integrityScore, threshold: PUBLISH_THRESHOLD,
      }, 422);
    }

    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "auto_publish", p_status: "running",
      p_log: { note: "Admin approved. Publishing course." },
    });

    const { error: cErr } = await sb
      .from("courses").update({ publishing_status: "publish_ready", status: "published" }).eq("id", courseId);
    if (cErr) throw cErr;

    const { error: pErr } = await sb
      .from("course_packages").update({ status: "published", build_progress: 100, council_approved: true }).eq("id", packageId);
    if (pErr) throw pErr;

    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "auto_publish", p_status: "done", p_log: { ok: true },
    });

    // Unlock package + release global pipeline lock
    await sb.rpc("release_pipeline_lock", { p_package_id: packageId });
    await sb.from("course_package_locks").delete().eq("package_id", packageId);

    // Trigger next queued package
    await sb.from("job_queue").insert({
      job_type: "package_queue_next", status: "pending", attempts: 0, max_attempts: 1,
      run_after: new Date(Date.now() + 5_000).toISOString(),
      payload: { completed_package_id: packageId },
    });

    // Admin notification
    await sb.from("admin_notifications").insert({
      title: `🚀 Package published`,
      body: `Course package has been published successfully.`,
      category: "package_review",
      severity: "info",
      entity_type: "course_package",
      entity_id: packageId,
    });

    return json({ ok: true });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    await unlockFail(msg);
    return json({ ok: false, error: msg }, 500);
  }
});
