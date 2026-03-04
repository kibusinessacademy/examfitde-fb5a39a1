import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

/**
 * pipeline-stall-guard — No-Write SLO enforcer
 *
 * Runs every ~10 minutes (via orchestrator or cron).
 * Detects "silent failures": packages that are building,
 * have completed jobs, but NO content_version writes within SLO window.
 *
 * Actions:
 *  1) Logs P0 health events (SSOT)
 *  2) Applies stall backoff to prevent hot loops
 *  3) If bulk stalls → triggers circuit breaker (disables tool mode)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    // ── Read settings ──
    const { data: settingsRow } = await sb
      .from("pipeline_settings")
      .select("value")
      .eq("key", "stall_guard")
      .maybeSingle();

    const cfg = (settingsRow?.value ?? {}) as Record<string, unknown>;
    const enabled = cfg.enabled !== false;
    const autoMitigate = cfg.auto_mitigate !== false;

    if (!enabled) {
      return json({ ok: true, action: "noop", reason: "stall_guard disabled" });
    }

    // ── Guard 1: No-Write Stall (SSOT view) ──
    const { data: stalled, error: sErr } = await sb
      .from("v_pipeline_stalled_packages" as string)
      .select("package_id,status,last_write,completed_jobs");

    if (sErr) throw sErr;

    const writeStallRows = (stalled ?? []) as Array<{
      package_id: string;
      status: string;
      last_write: string | null;
      completed_jobs: number | null;
    }>;

    // ── Guard 2: Placeholder-Drop Stall ──
    // Detect packages where placeholders haven't decreased despite recent job completions
    const { data: buildingPkgs } = await sb
      .from("course_packages")
      .select("id, course_id")
      .eq("status", "building");

    const placeholderStallRows: Array<{ package_id: string; placeholders: number; recent_jobs: number }> = [];

    for (const pkg of buildingPkgs ?? []) {
      // Count current placeholders
      const { count: phCount } = await sb
        .from("lessons")
        .select("id", { count: "exact", head: true })
        .eq("modules.course_id", pkg.course_id)
        .ilike("content", "%_placeholder%");

      // Check recent completed jobs (last 30min)
      const { count: recentJobs } = await sb
        .from("job_queue")
        .select("id", { count: "exact", head: true })
        .eq("package_id", pkg.id)
        .eq("status", "completed")
        .gte("completed_at", new Date(Date.now() - 30 * 60 * 1000).toISOString());

      // Check previous placeholder snapshot from step meta
      const { data: stepMeta } = await sb
        .from("package_steps")
        .select("meta")
        .eq("package_id", pkg.id)
        .eq("step_key", "generate_learning_content")
        .maybeSingle();

      const prevPh = Number((stepMeta?.meta as any)?.last_placeholder_count ?? -1);
      const currentPh = phCount ?? 0;
      const jobs = recentJobs ?? 0;

      // Stall = placeholders didn't drop AND jobs completed
      if (prevPh >= 0 && currentPh >= prevPh && jobs > 0 && currentPh > 0) {
        placeholderStallRows.push({ package_id: pkg.id, placeholders: currentPh, recent_jobs: jobs });
      }

      // Always update snapshot for next check
      if (stepMeta) {
        const meta = (stepMeta.meta ?? {}) as Record<string, unknown>;
        await sb.from("package_steps").update({
          meta: { ...meta, last_placeholder_count: currentPh, placeholder_checked_at: new Date().toISOString() },
        }).eq("package_id", pkg.id).eq("step_key", "generate_learning_content");
      }
    }

    const allStallRows = [
      ...writeStallRows.map(r => ({ ...r, stall_type: "no_writes" as const })),
      ...placeholderStallRows.map(r => ({
        package_id: r.package_id,
        status: "building",
        last_write: null as string | null,
        completed_jobs: r.recent_jobs,
        stall_type: "placeholder_stuck" as const,
        placeholders: r.placeholders,
      })),
    ];

    // Deduplicate by package_id
    const seen = new Set<string>();
    const rows = allStallRows.filter(r => {
      if (seen.has(r.package_id)) return false;
      seen.add(r.package_id);
      return true;
    });

    if (rows.length === 0) {
      console.log("[pipeline-stall-guard] ✅ No stalled packages");
      return json({ ok: true, stalled: 0, writeStalls: 0, placeholderStalls: 0 });
    }

    console.warn(`[pipeline-stall-guard] 🚨 ${rows.length} stalled package(s) detected (${writeStallRows.length} write-stalls, ${placeholderStallRows.length} placeholder-stalls)`);

    // ── Log P0 events (SSOT) ──
    for (const r of rows) {
      const kind = (r as any).stall_type === "placeholder_stuck" ? "placeholder_stuck" : "stalled_writes";
      await sb.rpc("log_pipeline_health_event" as string, {
        p_severity: "P0",
        p_kind: kind,
        p_package_id: r.package_id,
        p_step_key: "generate_learning_content",
        p_meta: {
          stall_type: (r as any).stall_type,
          status: r.status,
          last_write: r.last_write,
          completed_jobs_last_window: r.completed_jobs,
          placeholders: (r as any).placeholders ?? null,
          hint: kind === "placeholder_stuck"
            ? "placeholders not decreasing despite completed jobs"
            : "building + no content_version writes within SLO window while jobs complete",
        },
      });
    }

    // ── Admin notifications ──
    for (const r of rows) {
      const shortId = r.package_id.slice(0, 8);
      const stallType = (r as any).stall_type;
      await sb.from("admin_notifications").insert({
        title: stallType === "placeholder_stuck"
          ? `P0: Placeholder stuck – ${shortId}`
          : `P0: Stalled writes – ${shortId}`,
        body: stallType === "placeholder_stuck"
          ? `Package ${shortId}: ${(r as any).placeholders} placeholders unchanged despite ${r.completed_jobs} recent jobs. Possible dedup loop.`
          : `Package ${shortId} is building but has no content writes in ${cfg.stall_minutes ?? 60}min despite ${r.completed_jobs} completed jobs. Last write: ${r.last_write ?? "never"}.`,
        severity: "critical",
        category: "pipeline",
        entity_type: "package",
        entity_id: r.package_id,
        metadata: { kind: stallType, last_write: r.last_write, placeholders: (r as any).placeholders },
      });
    }

    let mitigationApplied = false;

    if (autoMitigate) {
      const pkgIds = rows.map((x) => x.package_id);

      // ── Backoff: increase stall_runs + set next_run_at ──
      const { data: steps } = await sb
        .from("package_steps")
        .select("package_id, meta")
        .in("package_id", pkgIds)
        .eq("step_key", "generate_learning_content");

      for (const st of steps ?? []) {
        const meta = (st.meta ?? {}) as Record<string, unknown>;
        const stallRuns = Number(meta.stall_runs ?? 0) + 1;
        // Escalating backoff: 30min, then 60min after 3 stalls
        const backoffMin = stallRuns >= 3 ? 60 : 30;
        const nextRun = new Date(Date.now() + backoffMin * 60 * 1000).toISOString();

        await sb
          .from("package_steps")
          .update({
            meta: {
              ...meta,
              stall_runs: stallRuns,
              next_run_at: nextRun,
              last_guard: "pipeline-stall-guard",
              last_guard_at: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
          })
          .eq("package_id", st.package_id)
          .eq("step_key", "generate_learning_content");
      }

      // ── Bulk stalls → circuit breaker (disable tool mode) ──
      if (rows.length >= 3) {
        await sb.rpc("set_pipeline_setting" as string, {
          p_key: "ai_tool_mode",
          p_value: {
            enabled: false,
            reason: "stall_guard_bulk_stalls",
            stalled_count: rows.length,
            updated_by: "pipeline-stall-guard",
            at: new Date().toISOString(),
          },
        });
        console.warn(`[pipeline-stall-guard] 🔴 Circuit breaker OPEN: ${rows.length} packages stalled → tool mode disabled`);
        mitigationApplied = true;
      }
    }

    console.log(`[pipeline-stall-guard] Done: ${rows.length} stalled, autoMitigate=${autoMitigate}, circuitBreaker=${mitigationApplied}`);
    return json({ ok: true, stalled: rows.length, autoMitigate, circuitBreaker: mitigationApplied });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[pipeline-stall-guard] ERROR: ${msg}`);
    return json({ ok: false, error: msg }, 500);
  }
});
