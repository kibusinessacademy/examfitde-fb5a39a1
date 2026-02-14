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

  const packageId = p.package_id as string;
  const courseId = p.course_id as string;

  if (!(await prereqDone(sb, packageId, "run_integrity_check"))) {
    return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: run_integrity_check" }, 409);
  }

  // Quality gate (if available)
  const { data: pkgQ } = await sb
    .from("course_packages")
    .select("quality_report, integrity_report, feature_flags")
    .eq("id", packageId)
    .maybeSingle();

  const qualityReport = (pkgQ as any)?.quality_report;
  if (qualityReport && qualityReport.status === "failed") {
    await sb.from("admin_notifications").insert({
      title: "⚠️ Quality Gate failed",
      body: `Package blocked. quality_score=${qualityReport.score ?? "?"}`,
      category: "quality",
      severity: "warning",
      entity_type: "course_package",
      entity_id: packageId,
    }).catch(() => {});
    return json({ ok: false, retry: false, error: "QUALITY_GATE_FAILED", quality: qualityReport }, 422);
  }

  // Review gate (auto-approve unless flag requires manual review)
  const requiresManualReview = Boolean((pkgQ as any)?.feature_flags?.requires_manual_review);

  const { data: review } = await sb
    .from("course_package_reviews")
    .select("status")
    .eq("course_package_id", packageId)
    .maybeSingle();

  if (!review || review.status !== "approved") {
    const currentStatus = review?.status || "no_review";
    if (requiresManualReview) {
      return json({
        ok: false,
        retry: false,
        error: `REVIEW_GATE: status=${currentStatus}. Admin approval required.`,
        review_status: currentStatus,
      }, 202);
    }

    await sb.from("course_package_reviews").upsert({
      course_package_id: packageId,
      status: "approved",
      notes: "Auto-approved by pipeline to prevent blocking",
    }, { onConflict: "course_package_id" }).catch(() => {});
  }

  // Integrity hard-fail gate
  const integrityReport = (pkgQ as any)?.integrity_report;
  const hardFails = integrityReport?.v3?.hard_fail_reasons || [];
  if (Array.isArray(hardFails) && hardFails.length > 0) {
    return json({ ok: false, retry: false, error: "V3_HARD_FAILS", hard_fail_reasons: hardFails }, 422);
  }

  // Publish
  const { error: cErr } = await sb
    .from("courses")
    .update({ publishing_status: "publish_ready", status: "published" })
    .eq("id", courseId);
  if (cErr) throw cErr;

  const { error: pErr } = await sb
    .from("course_packages")
    .update({ status: "published", build_progress: 100, council_approved: true })
    .eq("id", packageId);
  if (pErr) throw pErr;

  await sb.from("admin_notifications").insert({
    title: "🚀 Package published",
    body: "Course package has been published successfully.",
    category: "package_review",
    severity: "info",
    entity_type: "course_package",
    entity_id: packageId,
  }).catch(() => {});

  return json({ ok: true });
});
