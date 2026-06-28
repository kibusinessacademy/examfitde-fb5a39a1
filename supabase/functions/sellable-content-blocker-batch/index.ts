// SELLABLE.CONTENT.BLOCKER.BATCH.1
// Orchestrates the existing sellable-recovery lanes (A/B/C) end-to-end with
// before/after verification and writes an outcome ledger row.
// Auth: admin JWT OR x-cron-secret header.
// Never mutates publish/approval/pricing directly — only enqueues via
// admin_course_auto_heal_queue (Lanes A/C) or calls admin_demote_empty_course (Lane B).
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleCors, json, requireAdmin } from "../_shared/adminGuard.ts";

interface Body {
  dry_run?: boolean;
  lanes?: ("A" | "B" | "C")[];
  cap?: number;
  trigger_source?: string;
}

async function snapshot(sb: any) {
  const { data: view } = await sb
    .from("v_public_sellable_courses")
    .select("is_sellable,lessons,lessons_ready,lessons_sellable,modules");
  const rows = view ?? [];
  const sellable = rows.filter((r: any) => r.is_sellable).length;
  const not = rows.filter((r: any) => !r.is_sellable);
  const lane_a_no_ready = not.filter((r: any) => r.lessons > 0 && r.lessons_ready === 0).length;
  const lane_a_other = not.filter(
    (r: any) => r.lessons > 0 && r.lessons_ready > 0 && !r.lessons_sellable,
  ).length;
  const lane_b_empty = not.filter((r: any) => r.modules === 0 || r.lessons === 0).length;

  const { data: cands } = await sb.from("v_sellable_recovery_candidates").select("*");
  const lane_c1 = (cands ?? []).filter((c: any) => c.pkg_published === 0 && c.pkg_total > 0).length;
  const lane_c2 = (cands ?? []).filter((c: any) => c.pkg_total === 0).length;

  const remaining = lane_a_no_ready + lane_a_other + lane_b_empty + lane_c1 + lane_c2;
  return {
    view_rows: rows.length,
    sellable,
    lane_a_no_ready,
    lane_a_other,
    lane_b_empty,
    lane_c1,
    lane_c2,
    remaining_blocker_count: remaining,
  };
}

async function audit(
  sb: any,
  action_type: string,
  target_id: string | null,
  input: any,
  status: string,
  detail: string,
) {
  await sb.from("auto_heal_log").insert({
    action_type,
    target_id,
    target_type: "sellable_content_blocker_batch",
    input_params: input,
    result_status: status,
    result_detail: detail,
    trigger_source: "sellable-content-blocker-batch",
  });
}

async function runLanes(sb: any, dry: boolean, lanes: Set<string>, cap: number) {
  const actions = {
    lane_a_enqueued: 0,
    lane_b_demoted: 0,
    lane_c1_enqueued: 0,
    lane_c2_logged: 0,
    refused_by_gate: 0,
    errors: [] as any[],
  };
  const remaining_blockers: any[] = [];

  if (lanes.has("A")) {
    const { data: rows } = await sb
      .from("v_public_sellable_courses")
      .select("course_id,curriculum_id,course_title,lessons,lessons_ready,lessons_sellable")
      .eq("is_sellable", false)
      .limit(cap);
    const candidates = (rows ?? []).filter(
      (r: any) => r.lessons > 0 && (r.lessons_ready === 0 || !r.lessons_sellable),
    );
    for (const c of candidates) {
      const { data: pkg } = await sb
        .from("course_packages")
        .select("id")
        .eq("curriculum_id", c.curriculum_id)
        .eq("status", "published")
        .limit(1)
        .maybeSingle();
      if (!pkg) {
        remaining_blockers.push({
          lane: "A",
          course_id: c.course_id,
          reason: "no_published_package_on_curriculum",
        });
        continue;
      }
      if (dry) {
        actions.lane_a_enqueued++;
        continue;
      }
      const { error } = await sb.from("admin_course_auto_heal_queue").insert({
        package_id: pkg.id,
        curriculum_id: c.curriculum_id,
        source: "sellable_content_blocker_batch",
        reason_codes: ["lessons_ready_zero_or_unsellable"],
        heal_action: "lesson_readiness_recheck",
        notes: `Blocker batch lane A · ${c.course_title}`,
      });
      if (error) {
        actions.errors.push({ lane: "A", course_id: c.course_id, error: error.message });
        continue;
      }
      actions.lane_a_enqueued++;
      await audit(
        sb,
        "content_blocker_lesson_recheck",
        c.course_id,
        { package_id: pkg.id, curriculum_id: c.curriculum_id },
        "enqueued",
        "lane A",
      );
    }
  }

  if (lanes.has("B")) {
    const { data: empty } = await sb
      .from("v_public_sellable_courses")
      .select("course_id,course_title,modules,lessons")
      .eq("is_sellable", false)
      .or("modules.eq.0,lessons.eq.0")
      .limit(cap);
    for (const c of empty ?? []) {
      if (dry) {
        actions.lane_b_demoted++;
        continue;
      }
      const { error } = await sb.rpc("admin_demote_empty_course", {
        _course_id: c.course_id,
        _reason: "sellable_content_blocker_batch_1",
      });
      if (error) {
        actions.refused_by_gate++;
        actions.errors.push({ lane: "B", course_id: c.course_id, error: error.message });
        remaining_blockers.push({ lane: "B", course_id: c.course_id, reason: error.message });
        continue;
      }
      actions.lane_b_demoted++;
      await audit(
        sb,
        "content_blocker_empty_demote",
        c.course_id,
        { title: c.course_title },
        "demoted",
        "lane B",
      );
    }
  }

  if (lanes.has("C")) {
    const { data: cands } = await sb.from("v_sellable_recovery_candidates").select("*").limit(cap);
    for (const c of cands ?? []) {
      if (c.pkg_total === 0) {
        if (!dry) {
          await audit(
            sb,
            "content_blocker_bridge_no_package",
            c.product_id,
            { curriculum_id: c.curriculum_id, product_title: c.product_title },
            "logged",
            "no course_packages row on curriculum — content factory required",
          );
        }
        actions.lane_c2_logged++;
        remaining_blockers.push({
          lane: "C2",
          product_id: c.product_id,
          curriculum_id: c.curriculum_id,
          reason: "no_package_row_on_curriculum",
        });
        continue;
      }
      if (c.pkg_published > 0) continue;
      if (dry) {
        actions.lane_c1_enqueued++;
        continue;
      }
      const { error } = await sb.from("admin_course_auto_heal_queue").insert({
        package_id: c.recoverable_package_id,
        curriculum_id: c.curriculum_id,
        source: "sellable_content_blocker_batch",
        reason_codes: ["missing_published_package_for_priced_product"],
        heal_action: "publish_course_package",
        notes: `Blocker batch lane C1 · ${c.product_title}`,
      });
      if (error) {
        actions.errors.push({ lane: "C1", product_id: c.product_id, error: error.message });
        continue;
      }
      actions.lane_c1_enqueued++;
      await audit(
        sb,
        "content_blocker_bridge_publish",
        c.product_id,
        { package_id: c.recoverable_package_id, curriculum_id: c.curriculum_id },
        "enqueued",
        "lane C1",
      );
    }
  }

  return { actions, remaining_blockers };
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  // Auth: admin JWT OR x-cron-secret
  const cronSecret = req.headers.get("x-cron-secret");
  let sb: any;
  let triggerDefault = "manual";
  if (cronSecret && cronSecret === Deno.env.get("CRON_SECRET")) {
    sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    triggerDefault = "cron";
  } else {
    const ctx = await requireAdmin(req);
    if (ctx instanceof Response) return ctx;
    sb = ctx.sb;
  }

  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    /* default */
  }
  const dry = body.dry_run !== false;
  const lanes = new Set(body.lanes ?? ["A", "B", "C"]);
  const cap = Math.min(Math.max(Number(body.cap ?? 100), 1), 500);
  const trigger_source = body.trigger_source ?? triggerDefault;

  // Insert run row
  const before = await snapshot(sb);
  const { data: runRow, error: runErr } = await sb
    .from("sellable_content_blocker_runs")
    .insert({
      trigger_source,
      dry_run: dry,
      lanes: [...lanes],
      cap,
      before_snapshot: before,
      status: "running",
    })
    .select("id")
    .single();
  if (runErr) {
    return json({ error: "ledger_insert_failed", detail: runErr.message }, 500);
  }
  const runId = runRow.id as string;

  try {
    const { actions, remaining_blockers } = await runLanes(sb, dry, lanes, cap);
    const after = await snapshot(sb);
    const delta_sellable = after.sellable - before.sellable;
    const delta_blockers = after.remaining_blocker_count - before.remaining_blocker_count;

    await sb
      .from("sellable_content_blocker_runs")
      .update({
        finished_at: new Date().toISOString(),
        after_snapshot: after,
        actions,
        delta_sellable,
        delta_blockers,
        remaining_blocker_count: after.remaining_blocker_count,
        status: "ok",
      })
      .eq("id", runId);

    return json({
      ok: true,
      run_id: runId,
      dry_run: dry,
      before,
      after,
      actions,
      delta_sellable,
      delta_blockers,
      remaining_blocker_count: after.remaining_blocker_count,
      remaining_blockers: remaining_blockers.slice(0, 200),
      notes: dry
        ? "Dry-run: no writes performed. Pass { dry_run: false } to execute."
        : "Executed. All actions audited in auto_heal_log (action_type LIKE 'content_blocker_%').",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb
      .from("sellable_content_blocker_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: "error",
        error: msg,
      })
      .eq("id", runId);
    return json({ ok: false, error: msg, run_id: runId }, 500);
  }
});
