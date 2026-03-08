import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { validateAuth } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflightRequest, json } from "../_shared/cors.ts";

type SummaryData = {
  items?: Record<string, number>;
  wave?: Record<string, unknown>;
};

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  const auth = await validateAuth(req, true);
  if (auth.error || !auth.isAdmin) {
    return json(401, { error: auth.error || "Admin required" }, origin);
  }

  const body = await req.json().catch(() => ({}));
  const action: string = body.action || "status";
  const waveId: string | null = body.wave_id || null;

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ═══════════════════════════════════════════════════════════════
  // ACTION: status
  // ═══════════════════════════════════════════════════════════════
  if (action === "status") {
    const { data: waves } = await sb
      .from("production_waves")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);

    const { count: buildingCount } = await sb
      .from("course_packages")
      .select("id", { count: "exact", head: true })
      .eq("status", "building");

    const { count: queuedCount } = await sb
      .from("course_packages")
      .select("id", { count: "exact", head: true })
      .eq("status", "queued");

    const { count: pendingJobs } = await sb
      .from("job_queue")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "queued", "processing"]);

    const { count: failedJobs1h } = await sb
      .from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("updated_at", new Date(Date.now() - 3600_000).toISOString());

    return json(200, {
      waves: (waves || []).map((w: any) => ({
        id: w.id,
        name: w.name,
        status: w.status,
        target: w.target_count,
        seeded: w.seeded_count,
        completed: w.completed_count,
        failed: w.failed_count,
        published: w.published_count,
        blocked: w.blocked_count,
        max_concurrent: w.max_concurrent,
        started_at: w.started_at,
        finished_at: w.finished_at,
      })),
      global_health: {
        packages_building: buildingCount ?? 0,
        packages_queued: queuedCount ?? 0,
        pending_jobs: pendingJobs ?? 0,
        failed_jobs_1h: failedJobs1h ?? 0,
      },
    }, origin);
  }

  if (!waveId) {
    return json(400, { error: "wave_id required for this action" }, origin);
  }

  const { data: wave, error: wErr } = await sb
    .from("production_waves")
    .select("*")
    .eq("id", waveId)
    .single();

  if (wErr || !wave) {
    return json(404, { error: "Wave not found" }, origin);
  }

  // ═══════════════════════════════════════════════════════════════
  // ACTION: activate
  // ═══════════════════════════════════════════════════════════════
  if (action === "activate") {
    if (wave.status !== "draft" && wave.status !== "paused") {
      return json(
        400,
        { error: `Cannot activate wave in status: ${wave.status}` },
        origin,
      );
    }

    const { data: pendingItems } = await sb
      .from("production_wave_items")
      .select("id, package_id")
      .eq("wave_id", waveId)
      .eq("status", "pending");

    let activated = 0;

    for (const item of pendingItems || []) {
      if (item.package_id) {
        await sb
          .from("course_packages")
          .update({ status: "queued", priority: 8 })
          .eq("id", item.package_id)
          .in("status", ["queued", "planning", "draft"]);
      }

      await sb
        .from("production_wave_items")
        .update({
          status: "queued",
          started_at: new Date().toISOString(),
        })
        .eq("id", item.id);

      activated++;
    }

    await sb
      .from("production_waves")
      .update({
        status: "active",
        started_at: wave.started_at || new Date().toISOString(),
      })
      .eq("id", waveId);

    return json(200, { ok: true, activated, wave_status: "active" }, origin);
  }

  // ═══════════════════════════════════════════════════════════════
  // ACTION: tick
  // ═══════════════════════════════════════════════════════════════
  if (action === "tick") {
    const { data: items } = await sb
      .from("production_wave_items")
      .select("id, package_id, status, curriculum_id")
      .eq("wave_id", waveId)
      .not("status", "in", "(published,blocked,skipped,quality_gate_passed,quality_gate_failed)");

    let synced = 0;
    let newCompleted = 0;
    let newFailed = 0;
    let newBlocked = 0;
    let newPublished = 0;

    for (const item of items || []) {
      if (!item.package_id) continue;

      const { data: pkg } = await sb
        .from("course_packages")
        .select("status, build_progress, published_at")
        .eq("id", item.package_id)
        .single();

      if (!pkg) continue;

      let newStatus: string | null = null;

      if (pkg.published_at || pkg.status === "published") {
        newStatus = "published";
        newPublished++;
      } else if (pkg.status === "building") {
        newStatus = "building";
      } else if (pkg.status === "failed") {
        const { data: steps } = await sb
          .from("package_steps")
          .select("step_key, status")
          .eq("package_id", item.package_id)
          .eq("status", "failed");

        const qualitySteps = (steps || []).filter((s: any) =>
          s.step_key?.startsWith("validate_") || s.step_key === "quality_gate"
        );

        if (qualitySteps.length > 0) {
          newStatus = "quality_gate_failed";
          newFailed++;
        } else {
          const { count: failedAttempts } = await sb
            .from("job_queue")
            .select("id", { count: "exact", head: true })
            .eq("package_id", item.package_id)
            .eq("status", "failed")
            .gte("attempts", 5);

          if ((failedAttempts ?? 0) > 3) {
            newStatus = "blocked";
            newBlocked++;
          } else {
            newStatus = "quality_gate_failed";
            newFailed++;
          }
        }
      } else if (pkg.status === "draft" && (pkg.build_progress ?? 0) >= 100) {
        newStatus = "quality_gate_passed";
        newCompleted++;
      } else if (pkg.status === "queued") {
        newStatus = "queued";
      }

      if (newStatus && newStatus !== item.status) {
        await sb
          .from("production_wave_items")
          .update({
            status: newStatus as any,
            ...(["published", "blocked", "quality_gate_passed", "quality_gate_failed"].includes(newStatus)
              ? { finished_at: new Date().toISOString() }
              : {}),
          })
          .eq("id", item.id);

        synced++;
      }
    }

    const { data: summary } = await sb.rpc("get_wave_summary", { p_wave_id: waveId });
    const s = (summary || {}) as SummaryData;
    const itemCounts = s.items || {};

    await sb
      .from("production_waves")
      .update({
        completed_count: (itemCounts.quality_gate_passed ?? 0) + (itemCounts.published ?? 0),
        failed_count: itemCounts.quality_gate_failed ?? 0,
        published_count: itemCounts.published ?? 0,
        blocked_count: itemCounts.blocked ?? 0,
      })
      .eq("id", waveId);

    const totalItems = Object.values(itemCounts).reduce(
      (a: number, b: unknown) => a + (Number(b) || 0),
      0,
    );

    const terminalItems =
      (itemCounts.published ?? 0) +
      (itemCounts.blocked ?? 0) +
      (itemCounts.quality_gate_passed ?? 0) +
      (itemCounts.quality_gate_failed ?? 0) +
      (itemCounts.skipped ?? 0);

    if (totalItems > 0 && terminalItems >= totalItems) {
      await sb
        .from("production_waves")
        .update({
          status: "completed",
          finished_at: new Date().toISOString(),
        })
        .eq("id", waveId);
    }

    return json(200, {
      ok: true,
      synced,
      new_completed: newCompleted,
      new_failed: newFailed,
      new_blocked: newBlocked,
      new_published: newPublished,
      summary: s,
    }, origin);
  }

  // ═══════════════════════════════════════════════════════════════
  // ACTION: pause
  // ═══════════════════════════════════════════════════════════════
  if (action === "pause") {
    await sb
      .from("production_waves")
      .update({ status: "paused" })
      .eq("id", waveId);

    return json(200, { ok: true, wave_status: "paused" }, origin);
  }

  // ═══════════════════════════════════════════════════════════════
  // ACTION: resume
  // ═══════════════════════════════════════════════════════════════
  if (action === "resume") {
    await sb
      .from("production_waves")
      .update({ status: "active" })
      .eq("id", waveId);

    return json(200, { ok: true, wave_status: "active" }, origin);
  }

  // ═══════════════════════════════════════════════════════════════
  // ACTION: finalize
  // ═══════════════════════════════════════════════════════════════
  if (action === "finalize") {
    const { data: allItems } = await sb
      .from("production_wave_items")
      .select(`
        *,
        curricula:curriculum_id(title)
      `)
      .eq("wave_id", waveId);

    const report: {
      wave_id: string;
      wave_name: string;
      total: number;
      by_status: Record<string, number>;
      items: Array<{
        curriculum: string;
        status: string;
        duration_min: number | null;
        quality_score: number | null;
        last_error: string | null;
      }>;
      finished_at: string;
    } = {
      wave_id: waveId,
      wave_name: wave.name,
      total: allItems?.length ?? 0,
      by_status: {},
      items: (allItems || []).map((i: any) => ({
        curriculum: i.curricula?.title ?? i.curriculum_id,
        status: i.status,
        duration_min:
          i.started_at && i.finished_at
            ? Math.round(
              (new Date(i.finished_at).getTime() - new Date(i.started_at).getTime()) /
                60000,
            )
            : null,
        quality_score: i.quality_score ?? null,
        last_error: i.last_error ?? null,
      })),
      finished_at: new Date().toISOString(),
    };

    for (const item of allItems || []) {
      report.by_status[item.status] = (report.by_status[item.status] || 0) + 1;
    }

    await sb
      .from("production_waves")
      .update({
        status: "completed",
        finished_at: new Date().toISOString(),
        meta: {
          ...((wave.meta as any) || {}),
          final_report: report,
        },
      })
      .eq("id", waveId);

    return json(200, { ok: true, report }, origin);
  }

  return json(400, { error: `Unknown action: ${action}` }, origin);
});
