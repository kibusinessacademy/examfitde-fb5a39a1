import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * schema-health – Drift detection edge function.
 *
 * Called by: CI pipeline, cron, admin dashboard, run-tests.
 * Returns full drift report from check_schema_drift() RPC,
 * persists any findings to schema_drift_log, and returns
 * { ok: false } if critical drifts exist.
 */
Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    // Auth via shared contract (internal-secret | service-role bearer | admin JWT).
    const { assertAdmin } = await import("../_shared/edgeAuthContract.ts");
    const authR = await assertAdmin(req, "schema-health");
    if (!authR.ok) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: authR.status, headers });
    }
    const body = await req.json().catch(() => ({}));

    // Run drift check
    const { data: drift, error } = await sb.rpc("check_schema_drift");
    if (error) throw error;

    const drifts = drift?.drifts ?? [];
    const criticalCount = drift?.critical_count ?? 0;

    // Persist drifts to log
    if (drifts.length > 0) {
      const logEntries = drifts.map((d: any) => ({
        check_source: body.source || "manual",
        drift_type: d.type,
        entity_name: d.entity,
        expected: typeof d.expected === "object" ? JSON.stringify(d.expected) : d.expected || null,
        actual: d.actual || null,
        is_critical: d.critical ?? false,
      }));

      await sb.from("schema_drift_log").insert(logEntries);
    }

    // Update all ledger entries
    await sb
      .from("schema_version_ledger")
      .update({
        last_verified_at: new Date().toISOString(),
        verified_ok: criticalCount === 0,
        updated_at: new Date().toISOString(),
      })
      .neq("function_name", "__never__"); // update all

    // If critical → create admin notification
    if (criticalCount > 0) {
      await sb.from("admin_notifications").insert({
        title: `🚨 Schema Drift: ${criticalCount} kritische Abweichungen`,
        body: `Drift-Check hat ${drifts.length} Abweichungen gefunden, davon ${criticalCount} kritisch. Details im Schema-Health-Dashboard.`,
        severity: "error",
        category: "system",
        entity_type: "schema_drift",
      });
    }

    return new Response(JSON.stringify({
      ok: criticalCount === 0,
      drift_count: drifts.length,
      critical_count: criticalCount,
      checked_at: drift?.checked_at,
      drifts,
    }), { status: criticalCount > 0 ? 422 : 200, headers });

  } catch (e) {
    console.error("[schema-health] error", e);
    return new Response(
      JSON.stringify({ ok: false, error: String((e as Error)?.message || e) }),
      { status: 500, headers }
    );
  }
});
