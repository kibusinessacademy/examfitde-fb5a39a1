import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const payload = body.payload ?? body;

    const minutes = Number(payload.minutes ?? 60);
    const threshold = Number(payload.threshold ?? 0.35);

    const r = await sb.rpc("security_gate_check_and_raise", { p_minutes: minutes, p_threshold: threshold });
    if (r.error) throw r.error;

    // Also check seat misuse
    const misuse = await sb.rpc("detect_seat_misuse", { p_hours: 48, p_device_threshold: 6 });
    if (!misuse.error && misuse.data?.misuse) {
      await sb.rpc("upsert_qa_finding", {
        p_area: "errors",
        p_severity: "high",
        p_title: "Seat misuse detected (multi-device)",
        p_description: `Seat ${misuse.data.seat_id} used from ${misuse.data.distinct_devices} devices in 48h. Possible credential sharing.`,
        p_evidence: misuse.data,
        p_qa_run_id: null,
      });
    } else {
      await sb.rpc("resolve_qa_finding_if_exists", { p_area: "errors", p_title: "Seat misuse detected (multi-device)" });
    }

    return new Response(JSON.stringify({ ok: true, spike: r.data, seat_misuse: misuse.data ?? null }), { status: 200, headers });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers });
  }
});
