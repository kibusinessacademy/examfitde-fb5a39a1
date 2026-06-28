// SELLABLE.RECOVERY.CRON — Daily dry-run snapshot + escalation.
// Auth: x-cron-secret header (CRON_SECRET). Never executes lane actions — pure read + audit + alert.
// Escalation rules:
//   - remaining_blocker_count > 0
//   - delta_7d_blockers >= 0 (no improvement vs ~7d ago)
// Both write an `auto_heal_log` row with action_type='sellable_recovery_escalation'.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function snapshot(sb: any) {
  const { data: view } = await sb.from("v_public_sellable_courses")
    .select("is_sellable,lessons,lessons_ready,lessons_sellable,modules");
  const rows = view ?? [];
  const sellable = rows.filter((r: any) => r.is_sellable).length;
  const not = rows.filter((r: any) => !r.is_sellable);
  const lane_a_no_ready = not.filter((r: any) => r.lessons > 0 && r.lessons_ready === 0).length;
  const lane_a_other = not.filter((r: any) => r.lessons > 0 && r.lessons_ready > 0 && !r.lessons_sellable).length;
  const lane_b_empty = not.filter((r: any) => r.modules === 0 || r.lessons === 0).length;

  const { data: cands } = await sb.from("v_sellable_recovery_candidates").select("*");
  const lane_c1 = (cands ?? []).filter((c: any) => c.pkg_published === 0 && c.pkg_total > 0).length;
  const lane_c2 = (cands ?? []).filter((c: any) => c.pkg_total === 0).length;

  const remaining_blocker_count = lane_a_no_ready + lane_a_other + lane_b_empty + lane_c1 + lane_c2;
  return {
    view_rows: rows.length,
    sellable,
    lane_a_no_ready,
    lane_a_other,
    lane_b_empty,
    lane_c1,
    lane_c2,
    remaining_blocker_count,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== Deno.env.get("CRON_SECRET")) {
    return json({ error: "Unauthorized" }, 401);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const current = await snapshot(sb);

  // Find prior snapshot ~7d ago (oldest within 6-8d window).
  const since = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
  const until = new Date(Date.now() - 6 * 24 * 3600 * 1000).toISOString();
  const { data: prior } = await sb.from("auto_heal_log")
    .select("created_at,result_detail")
    .eq("action_type", "sellable_recovery_cron_run")
    .gte("created_at", since)
    .lte("created_at", until)
    .order("created_at", { ascending: true })
    .limit(1);

  let prior_snapshot: any = null;
  let delta_7d_blockers: number | null = null;
  if (prior && prior.length > 0) {
    try {
      prior_snapshot = JSON.parse(prior[0].result_detail).current;
      delta_7d_blockers = current.remaining_blocker_count - (prior_snapshot?.remaining_blocker_count ?? 0);
    } catch { /* ignore */ }
  }

  const escalate_reasons: string[] = [];
  if (current.remaining_blocker_count > 0) escalate_reasons.push("blockers_present");
  if (delta_7d_blockers !== null && delta_7d_blockers >= 0) escalate_reasons.push("no_improvement_7d");

  const detail = { current, prior_snapshot, delta_7d_blockers, escalate_reasons };

  await sb.from("auto_heal_log").insert({
    action_type: "sellable_recovery_cron_run",
    target_type: "sellable_recovery_batch",
    target_id: null,
    input_params: { dry_run: true },
    result_status: escalate_reasons.length > 0 ? "warning" : "ok",
    result_detail: JSON.stringify(detail),
    trigger_source: "sellable-recovery-cron",
  });

  if (escalate_reasons.length > 0) {
    await sb.from("auto_heal_log").insert({
      action_type: "sellable_recovery_escalation",
      target_type: "sellable_recovery_batch",
      target_id: null,
      input_params: { reasons: escalate_reasons },
      result_status: "alert",
      result_detail: JSON.stringify(detail),
      trigger_source: "sellable-recovery-cron",
    });
  }

  return json({ ok: true, escalated: escalate_reasons.length > 0, ...detail });
});
