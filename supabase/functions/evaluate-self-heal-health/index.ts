// SELF.HEAL.OS.1 — Admin-only self-heal projector (read-only).
import { requireAdmin, handleCors, json } from "../_shared/adminGuard.ts";
import { project, type HealLogRow, type HealthSummaryRow, type PolicyRow } from "../_shared/selfHealHealth/index.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const ctx = await requireAdmin(req);
  if (ctx instanceof Response) return ctx;
  const sb = ctx.sb;

  const sinceIso = new Date(Date.now() - 7 * 86400_000).toISOString();

  const [healsRes, summaryRes, policyRes] = await Promise.all([
    sb.from("auto_heal_log")
      .select("action_type,trigger_source,result_status,duration_ms,created_at,followup_verdict,followup_score_before,followup_score_after")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(5000),
    sb.from("ops_health_summary").select("*").maybeSingle(),
    sb.from("auto_heal_policies")
      .select("is_active,incident_mode,incident_activated_at,incident_activated_by,cooldowns,requires_approval")
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  if (healsRes.error) return json({ error: "heals_failed", detail: healsRes.error.message }, 500);

  const projection = project({
    heals: (healsRes.data ?? []) as HealLogRow[],
    summary: (summaryRes.data ?? null) as HealthSummaryRow | null,
    policy: (policyRes.data ?? null) as PolicyRow | null,
    now_iso: new Date().toISOString(),
  });

  return json({ ok: true, projection });
});
