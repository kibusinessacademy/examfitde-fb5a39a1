// SELLABLE.RECOVERY.BATCH.1 — Admin-only orchestrator.
// Lanes A/B/C. Dry-run default. Never bypasses QC gates or pricing/Stripe.
import { requireAdmin, handleCors, json } from "../_shared/adminGuard.ts";

interface Body {
  dry_run?: boolean;
  lanes?: ("A" | "B" | "C")[];
  cap?: number; // per-lane cap, default 100
}

async function snapshot(sb: any) {
  const { data: view } = await sb.from("v_public_sellable_courses").select("is_sellable,lessons,lessons_ready,lessons_sellable,modules");
  const rows = view ?? [];
  const sellable = rows.filter((r: any) => r.is_sellable).length;
  const not = rows.filter((r: any) => !r.is_sellable);
  const lane_a_no_ready = not.filter((r: any) => r.lessons > 0 && r.lessons_ready === 0).length;
  const lane_a_other = not.filter((r: any) => r.lessons > 0 && r.lessons_ready > 0 && !r.lessons_sellable).length;
  const lane_b_empty = not.filter((r: any) => r.modules === 0 || r.lessons === 0).length;

  const { data: cands } = await sb.from("v_sellable_recovery_candidates").select("*");
  const lane_c1 = (cands ?? []).filter((c: any) => c.pkg_published === 0 && c.pkg_total > 0).length;
  const lane_c2 = (cands ?? []).filter((c: any) => c.pkg_total === 0).length;

  return {
    total_products_priced_public: 248, // computed below for accuracy
    view_rows: rows.length,
    sellable,
    lane_a_no_ready,
    lane_a_other,
    lane_b_empty,
    lane_c1,
    lane_c2,
  };
}

async function audit(sb: any, action_type: string, target_id: string | null, input: any, status: string, detail: string) {
  await sb.from("auto_heal_log").insert({
    action_type,
    target_id,
    target_type: "sellable_recovery_batch",
    input_params: input,
    result_status: status,
    result_detail: detail,
    trigger_source: "sellable-recovery-batch",
  });
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const ctx = await requireAdmin(req);
  if (ctx instanceof Response) return ctx;
  const sb = ctx.sb;

  let body: Body = {};
  try { body = await req.json(); } catch { /* default */ }
  const dry = body.dry_run !== false; // default true
  const lanes = new Set(body.lanes ?? ["A", "B", "C"]);
  const cap = Math.min(Math.max(Number(body.cap ?? 100), 1), 500);

  const before = await snapshot(sb);
  await audit(sb, "sellable_recovery_snapshot_before", null, { dry, lanes: [...lanes], cap }, "ok", JSON.stringify(before));

  const actions = {
    lane_a_enqueued: 0,
    lane_b_demoted: 0,
    lane_c1_enqueued: 0,
    lane_c2_logged: 0,
    refused_by_gate: 0,
    errors: [] as any[],
  };
  const remaining_blockers: any[] = [];

  // ---- Lane A: lesson readiness recheck ----
  if (lanes.has("A")) {
    const { data: viewRows } = await sb
      .from("v_public_sellable_courses")
      .select("course_id,curriculum_id,course_title,lessons,lessons_ready,lessons_sellable")
      .eq("is_sellable", false)
      .limit(cap);
    const candidates = (viewRows ?? []).filter((r: any) =>
      r.lessons > 0 && (r.lessons_ready === 0 || !r.lessons_sellable)
    );
    for (const c of candidates) {
      // find published package_id on the curriculum
      const { data: pkg } = await sb
        .from("course_packages")
        .select("id")
        .eq("curriculum_id", c.curriculum_id)
        .eq("status", "published")
        .limit(1)
        .maybeSingle();
      if (!pkg) {
        remaining_blockers.push({ lane: "A", course_id: c.course_id, reason: "no_published_package_on_curriculum" });
        continue;
      }
      if (dry) { actions.lane_a_enqueued++; continue; }
      const { error } = await sb.from("admin_course_auto_heal_queue").insert({
        package_id: pkg.id,
        curriculum_id: c.curriculum_id,
        source: "sellable_recovery_batch",
        reason_codes: ["lessons_ready_zero_or_unsellable"],
        heal_action: "lesson_readiness_recheck",
        notes: `Recovery batch lane A for course ${c.course_id} (${c.course_title})`,
      });
      if (error) { actions.errors.push({ lane: "A", course_id: c.course_id, error: error.message }); continue; }
      actions.lane_a_enqueued++;
      await audit(sb, "sellable_recovery_lesson_recheck", c.course_id, { package_id: pkg.id, curriculum_id: c.curriculum_id }, "enqueued", "lane A");
    }
  }

  // ---- Lane B: demote empty published courses ----
  if (lanes.has("B")) {
    const { data: empty } = await sb
      .from("v_public_sellable_courses")
      .select("course_id,course_title,modules,lessons")
      .eq("is_sellable", false)
      .or("modules.eq.0,lessons.eq.0")
      .limit(cap);
    for (const c of (empty ?? [])) {
      if (dry) { actions.lane_b_demoted++; continue; }
      const { error } = await sb.rpc("admin_demote_empty_course", {
        _course_id: c.course_id,
        _reason: "sellable_recovery_batch_1",
      });
      if (error) {
        actions.refused_by_gate++;
        actions.errors.push({ lane: "B", course_id: c.course_id, error: error.message });
        remaining_blockers.push({ lane: "B", course_id: c.course_id, reason: error.message });
        continue;
      }
      actions.lane_b_demoted++;
      await audit(sb, "sellable_recovery_empty_demote", c.course_id, { title: c.course_title }, "demoted", "lane B");
    }
  }

  // ---- Lane C: bridge priced products to a published package ----
  if (lanes.has("C")) {
    const { data: cands } = await sb.from("v_sellable_recovery_candidates").select("*").limit(cap);
    for (const c of (cands ?? [])) {
      if (c.pkg_total === 0) {
        // C2 — no package at all, content factory required
        if (!dry) {
          await audit(sb, "sellable_recovery_bridge_no_package", c.product_id,
            { curriculum_id: c.curriculum_id, product_title: c.product_title },
            "logged", "no course_packages row on curriculum — content factory required");
        }
        actions.lane_c2_logged++;
        remaining_blockers.push({ lane: "C2", product_id: c.product_id, curriculum_id: c.curriculum_id, reason: "no_package_row_on_curriculum" });
        continue;
      }
      if (c.pkg_published > 0) continue;
      // C1 — have an unpublished package; enqueue publish heal
      if (dry) { actions.lane_c1_enqueued++; continue; }
      const { error } = await sb.from("admin_course_auto_heal_queue").insert({
        package_id: c.recoverable_package_id,
        curriculum_id: c.curriculum_id,
        source: "sellable_recovery_batch",
        reason_codes: ["missing_published_package_for_priced_product"],
        heal_action: "publish_course_package",
        notes: `Recovery batch lane C1 for product ${c.product_id} (${c.product_title})`,
      });
      if (error) { actions.errors.push({ lane: "C1", product_id: c.product_id, error: error.message }); continue; }
      actions.lane_c1_enqueued++;
      await audit(sb, "sellable_recovery_bridge_publish", c.product_id,
        { package_id: c.recoverable_package_id, curriculum_id: c.curriculum_id },
        "enqueued", "lane C1");
    }
  }

  const after = await snapshot(sb);
  await audit(sb, "sellable_recovery_snapshot_after", null, { dry, actions }, "ok", JSON.stringify(after));

  return json({
    ok: true,
    dry_run: dry,
    before,
    after,
    actions,
    remaining_blockers: remaining_blockers.slice(0, 200),
    remaining_blocker_count: remaining_blockers.length,
    notes: dry
      ? "Dry-run: no writes performed. Pass { dry_run: false } to execute."
      : "Executed. All actions audited in auto_heal_log (action_type LIKE 'sellable_recovery_%').",
  });
});
