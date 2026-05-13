// Thin admin wrapper around exam-pool repair RPCs.
// Actions:
//   - dispatch_dryrun  → admin_dispatch_exam_pool_repair(limit, true,  package_id?)
//   - dispatch_live    → admin_dispatch_exam_pool_repair(limit, false, package_id?)
//   - reconcile_dryrun → admin_reconcile_stuck_validate_exam_pool(limit, true,  package_id?)
//   - reconcile_live   → admin_reconcile_stuck_validate_exam_pool(limit, false, package_id?)
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { validateAuth, unauthorizedResponse } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const pre = handleCorsPreflightRequest(req);
  if (pre) return pre;
  const cors = getCorsHeaders(req.headers.get("origin"));
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  const { user, error, isAdmin } = await validateAuth(req, true);
  if (error || !user || !isAdmin) return unauthorizedResponse(error || "admin required", req.headers.get("origin") || undefined);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const action = body.action as string;
  const p_limit = Number.isFinite(body.limit) ? body.limit : 10;
  const p_package_id = (body.package_id as string | null) ?? null;

  let rpc: string;
  let dry: boolean;
  switch (action) {
    case "dispatch_dryrun":  rpc = "admin_dispatch_exam_pool_repair";          dry = true;  break;
    case "dispatch_live":    rpc = "admin_dispatch_exam_pool_repair";          dry = false; break;
    case "reconcile_dryrun": rpc = "admin_reconcile_stuck_validate_exam_pool"; dry = true;  break;
    case "reconcile_live":   rpc = "admin_reconcile_stuck_validate_exam_pool"; dry = false; break;
    default: return json({ error: "unknown action" }, 400);
  }

  const { data, error: e } = await sb.rpc(rpc, { p_limit, p_dry_run: dry, p_package_id });
  if (e) return json({ error: e.message, rpc, p_limit, p_dry_run: dry, p_package_id }, 500);

  // Aggregation
  const agg: Record<string, number> = {};
  for (const r of (data ?? []) as any[]) {
    const k = `${r.action_taken}::${r.job_type ?? r.next_step ?? "-"}`;
    agg[k] = (agg[k] ?? 0) + 1;
  }
  return json({ rpc, p_limit, p_dry_run: dry, p_package_id, count: data?.length ?? 0, aggregation: agg, rows: data });
});
