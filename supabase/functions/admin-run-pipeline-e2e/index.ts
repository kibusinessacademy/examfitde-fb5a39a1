// supabase/functions/admin-run-pipeline-e2e/index.ts
// Server-side E2E Validation Runbook — runs all 12 checks, returns structured verdict
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { validateAuth } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflightRequest, json } from "../_shared/cors.ts";

type CheckStatus = "pass" | "fail" | "warn" | "skip";

interface CheckResult {
  status: CheckStatus;
  data?: Record<string, unknown>;
  error?: string;
  duration_ms?: number;
}

interface E2EReport {
  verdict: "GO" | "GO_WITH_WARNINGS" | "NO_GO" | "ERROR";
  selected_package_id: string | null;
  p0_complete: boolean;
  p0_pass: number;
  p0_fail: number;
  soft_pass: number;
  soft_warn: number;
  go_for_phase_b: boolean;
  checks: Record<string, CheckResult>;
  summary: string;
  ran_at: string;
  duration_ms: number;
}

const P0_IDS = ["baseline", "dispatcher", "bundle_worker", "lesson_subjobs", "hybrid_completion", "artifact_truth"];
const SOFT_IDS = ["select_package", "monitor", "runner", "watchdog", "auto_heal", "legacy_audit"];

// Helper: run a check with timing + error handling
async function runCheck(
  id: string,
  fn: () => Promise<CheckResult>
): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const result = await fn();
    return { ...result, duration_ms: Date.now() - t0 };
  } catch (e) {
    return { status: "fail", error: String((e as Error).message ?? e), duration_ms: Date.now() - t0 };
  }
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  // Auth: require admin
  const auth = await validateAuth(req, true);
  if (auth.error || !auth.isAdmin) {
    return json(401, { error: auth.error || "Admin required" }, origin);
  }

  const body = await req.json().catch(() => ({}));
  const inputPackageId: string | null = body.package_id || null;
  const autoSelect: boolean = body.auto_select !== false;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  const t0 = Date.now();
  const checks: Record<string, CheckResult> = {};

  // ─── Check 1: Select Package ───
  let packageId = inputPackageId;
  checks.select_package = await runCheck("select_package", async () => {
    if (packageId) {
      return { status: "pass", data: { mode: "manual", package_id: packageId } };
    }
    if (!autoSelect) {
      return { status: "skip", data: { note: "No package_id provided and auto_select=false" } };
    }

    const { data: audit } = await sb.rpc("get_legacy_lesson_audit");
    const { data: pkgs } = await sb
      .from("course_packages")
      .select("id,title,status,build_progress,updated_at")
      .in("status", ["building", "queued"])
      .order("updated_at", { ascending: false })
      .limit(20);

    const candidates = (pkgs || []).map((p: any) => {
      const legacyInfo = (audit || []).find((a: any) => a.package_id === p.id);
      return {
        ...p,
        legacy_pct: legacyInfo?.legacy_pct ?? 0,
        legacy_count: legacyInfo?.lessons_without_competency ?? 0,
      };
    });

    const ranked = [...candidates].sort((a, b) => {
      const sa = (a.status === "building" ? 0 : 10) + (a.legacy_pct ?? 0) + (a.legacy_count ?? 0) * 0.5;
      const sb2 = (b.status === "building" ? 0 : 10) + (b.legacy_pct ?? 0) + (b.legacy_count ?? 0) * 0.5;
      return sa - sb2;
    });

    packageId = ranked[0]?.id ?? null;
    return {
      status: ranked.length > 0 ? "pass" : "warn",
      data: { candidates_count: ranked.length, selected: packageId, top3: ranked.slice(0, 3).map((c: any) => ({ id: c.id, title: c.title, status: c.status, legacy_pct: c.legacy_pct })) },
    };
  });

  if (!packageId) {
    return json(200, {
      verdict: "ERROR",
      selected_package_id: null,
      p0_complete: false, p0_pass: 0, p0_fail: 0,
      soft_pass: 0, soft_warn: 0,
      go_for_phase_b: false,
      checks,
      summary: "Kein passendes Paket gefunden",
      ran_at: new Date().toISOString(),
      duration_ms: Date.now() - t0,
    } satisfies E2EReport, origin);
  }

  // ─── Check 2: Baseline ───
  checks.baseline = await runCheck("baseline", async () => {
    const [bundleRes, stepRes, progressRes] = await Promise.all([
      sb.rpc("get_competency_bundle_progress", { p_package_id: packageId }),
      sb.from("package_steps").select("status,meta,attempts")
        .eq("package_id", packageId!).eq("step_key", "generate_learning_content").maybeSingle(),
      sb.rpc("get_learning_content_progress", { p_package_id: packageId }),
    ]);
    if (bundleRes.error) throw new Error(bundleRes.error.message);
    return {
      status: "pass",
      data: { bundle_progress: bundleRes.data, step_status: stepRes.data?.status, artifact_progress: progressRes.data },
    };
  });

  // ─── Check 3: Dispatcher ───
  checks.dispatcher = await runCheck("dispatcher", async () => {
    const { data: bundleJobs, error } = await sb
      .from("job_queue")
      .select("id,status,batch_cursor,idempotency_key,created_at")
      .eq("package_id", packageId!)
      .eq("job_type", "lesson_generate_competency_bundle")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);

    const competencyIds = (bundleJobs || []).map((j: any) => j.batch_cursor?.competency_id).filter(Boolean);
    const unique = new Set(competencyIds);
    const hasDupes = competencyIds.length !== unique.size;

    const { data: legacyJobs } = await sb
      .from("job_queue").select("id,status")
      .eq("package_id", packageId!).eq("job_type", "lesson_generate_content")
      .in("status", ["pending", "processing", "queued"]).limit(50);

    return {
      status: hasDupes ? "fail" : (bundleJobs?.length ? "pass" : "warn"),
      data: { bundle_jobs: bundleJobs?.length ?? 0, unique_competencies: unique.size, has_duplicates: hasDupes, legacy_active: legacyJobs?.length ?? 0 },
    };
  });

  // ─── Check 4: Bundle Worker ───
  checks.bundle_worker = await runCheck("bundle_worker", async () => {
    const { data: doneBundles } = await sb
      .from("job_queue").select("id,batch_cursor,payload")
      .eq("package_id", packageId!).eq("job_type", "lesson_generate_competency_bundle")
      .in("status", ["done", "completed"]).limit(5);

    const sampleCids = (doneBundles || [])
      .map((b: any) => b.batch_cursor?.competency_id || b.payload?.competency_id)
      .filter(Boolean).slice(0, 3);

    const samples = [];
    for (const cid of sampleCids) {
      const { data: lessonJobs } = await sb
        .from("job_queue").select("id,status,batch_cursor")
        .eq("package_id", packageId!).eq("job_type", "lesson_generate_content").limit(200);

      const matching = (lessonJobs || []).filter((j: any) => j.batch_cursor?.competency_id === cid);
      const terminalStatuses = ["done", "completed"];
      samples.push({
        competency_id: cid.slice(0, 8),
        lesson_subjobs: matching.length,
        done: matching.filter((j: any) => terminalStatuses.includes(j.status)).length,
        failed: matching.filter((j: any) => j.status === "failed").length,
        pending: matching.filter((j: any) => ["pending", "processing", "queued"].includes(j.status)).length,
      });
    }

    return {
      status: (doneBundles?.length ?? 0) > 0 ? "pass" : "warn",
      data: { done_bundles: doneBundles?.length ?? 0, samples },
    };
  });

  // ─── Check 5: Lesson Subjobs (SSOT: content.html) ───
  checks.lesson_subjobs = await runCheck("lesson_subjobs", async () => {
    const { data: doneJobs } = await sb
      .from("job_queue").select("id,payload")
      .eq("package_id", packageId!).eq("job_type", "lesson_generate_content")
      .eq("status", "done").limit(10);

    const lessonIds = (doneJobs || []).map((j: any) => j.payload?.lesson_id).filter(Boolean).slice(0, 5);
    const samples = [];

    for (const lid of lessonIds) {
      const { data: lesson } = await sb
        .from("lessons").select("id,title,competency_id,content,qc_status")
        .eq("id", lid).maybeSingle();
      if (!lesson) continue;

      const content = lesson.content as any;
      const html = content && typeof content === "object" ? (content.html || "") : "";
      const isPlaceholder = String(content?._placeholder) === "true";
      const isHollow = !html || html.length < 600 || isPlaceholder;
      const hasJsonFence = typeof html === "string" && html.includes("```json");

      samples.push({
        id: (lesson.id as string).slice(0, 8),
        html_length: html.length,
        is_hollow: isHollow,
        is_placeholder: isPlaceholder,
        has_json_fence: hasJsonFence,
        qc_status: lesson.qc_status,
      });
    }

    const issues = samples.filter((s) => s.is_hollow || s.has_json_fence);
    return {
      status: issues.length > 0 ? "fail" : samples.length > 0 ? "pass" : "warn",
      data: { total_done_jobs: doneJobs?.length ?? 0, samples_checked: samples.length, issues_count: issues.length, issues },
    };
  });

  // ─── Check 6: Monitor ───
  checks.monitor = await runCheck("monitor", async () => {
    const { data, error } = await sb.rpc("get_competency_bundle_progress", { p_package_id: packageId });
    if (error) throw new Error(error.message);
    const d = data as any;
    const consistent = d.bundles_done + d.bundles_failed + d.bundles_active <= d.bundles_total;
    return { status: consistent ? "pass" : "fail", data: { ...d, consistent } };
  });

  // ─── Check 7: Hybrid Completion ───
  checks.hybrid_completion = await runCheck("hybrid_completion", async () => {
    const { data, error } = await sb.rpc("check_fan_out_completion", {
      p_package_id: packageId, p_step_key: "generate_learning_content",
    });
    if (error) throw new Error(error.message);
    const d = data as any;
    return {
      status: d?.ok ? "pass" : d?.active_subjobs > 0 ? "warn" : "fail",
      data: d,
    };
  });

  // ─── Check 8: Runner ───
  checks.runner = await runCheck("runner", async () => {
    const { data: step } = await sb
      .from("package_steps").select("status,attempts,meta,last_error,finished_at")
      .eq("package_id", packageId!).eq("step_key", "generate_learning_content").maybeSingle();
    const isDone = step?.status === "done";
    const isLooping = (step?.attempts ?? 0) > 10;
    return {
      status: isDone ? "pass" : isLooping ? "fail" : "warn",
      data: { status: step?.status, attempts: step?.attempts, finished_at: step?.finished_at, is_looping: isLooping },
    };
  });

  // ─── Check 9: Watchdog ───
  checks.watchdog = await runCheck("watchdog", async () => {
    try {
      const { data: events } = await sb
        .from("pipeline_health_events").select("event_type,message,created_at")
        .eq("package_id", packageId!).order("created_at", { ascending: false }).limit(20);
      const suspiciousResets = (events || []).filter(
        (e: any) => e.event_type === "step_reset" || e.message?.includes("watchdog")
      );
      return {
        status: suspiciousResets.length > 3 ? "fail" : "pass",
        data: { total_events: events?.length ?? 0, suspicious_resets: suspiciousResets.length },
      };
    } catch {
      return { status: "warn", data: { note: "pipeline_health_events not available" } };
    }
  });

  // ─── Check 10: Auto-Heal ───
  checks.auto_heal = await runCheck("auto_heal", async () => {
    try {
      const { data: healLogs } = await sb
        .from("auto_heal_log").select("action_type,result_status,target_id,created_at")
        .eq("target_id", packageId!).order("created_at", { ascending: false }).limit(10);
      return { status: "pass", data: { heal_events: healLogs?.length ?? 0 } };
    } catch {
      return { status: "warn", data: { note: "auto_heal_log not available" } };
    }
  });

  // ─── Check 11: Artifact Truth ───
  checks.artifact_truth = await runCheck("artifact_truth", async () => {
    const { data, error } = await sb.rpc("get_learning_content_progress", { p_package_id: packageId });
    if (error) throw new Error(error.message);
    const d = data as any;
    const isGreen = d?.ok === true || (d?.real === d?.total && d?.total > 0);
    return { status: isGreen ? "pass" : "warn", data: d };
  });

  // ─── Check 12: Legacy Audit ───
  checks.legacy_audit = await runCheck("legacy_audit", async () => {
    const { data, error } = await sb.rpc("get_legacy_lesson_audit", { p_package_id: packageId });
    if (error) throw new Error(error.message);
    const row = (data || [])[0];
    return {
      status: row ? (row.legacy_pct > 20 ? "warn" : "pass") : "pass",
      data: row || { legacy_pct: 0, note: "No legacy found ✓" },
    };
  });

  // ─── Verdict ───
  const p0Statuses = P0_IDS.map((id) => checks[id]?.status);
  const p0Pass = p0Statuses.filter((s) => s === "pass").length;
  const p0Fail = p0Statuses.filter((s) => s === "fail").length;
  const p0Complete = p0Statuses.every((s) => s && s !== "skip");

  const softStatuses = SOFT_IDS.map((id) => checks[id]?.status);
  const softPass = softStatuses.filter((s) => s === "pass").length;
  const softWarn = softStatuses.filter((s) => s === "warn" || s === "fail").length;

  const verdict: E2EReport["verdict"] =
    !p0Complete ? "NO_GO"
    : p0Fail > 0 ? "NO_GO"
    : softWarn > 0 ? "GO_WITH_WARNINGS"
    : p0Pass >= P0_IDS.length ? "GO"
    : "NO_GO";

  const goForPhaseB = verdict === "GO" || verdict === "GO_WITH_WARNINGS";

  const summaryParts: string[] = [];
  if (p0Fail > 0) summaryParts.push(`${p0Fail} P0-Fail(s)`);
  if (softWarn > 0) summaryParts.push(`${softWarn} Soft-Warning(s)`);
  if (p0Pass === P0_IDS.length) summaryParts.push("All P0 checks passed");

  const report: E2EReport = {
    verdict,
    selected_package_id: packageId,
    p0_complete: p0Complete,
    p0_pass: p0Pass,
    p0_fail: p0Fail,
    soft_pass: softPass,
    soft_warn: softWarn,
    go_for_phase_b: goForPhaseB,
    checks,
    summary: summaryParts.join(" · ") || "Checks completed",
    ran_at: new Date().toISOString(),
    duration_ms: Date.now() - t0,
  };

  return json(200, report, origin);
});
