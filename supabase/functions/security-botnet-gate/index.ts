import { createClient } from "npm:@supabase/supabase-js@2.45.4";
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
    const p = body.payload ?? body;

    const ip = await sb.rpc("detect_ip_burst", {
      p_minutes: Number(p.ipMinutes ?? 15),
      p_user_threshold: Number(p.ipUsers ?? 8),
    });
    if (ip.error) throw ip.error;

    const dev = await sb.rpc("detect_device_burst", {
      p_minutes: Number(p.devMinutes ?? 60),
      p_user_threshold: Number(p.devUsers ?? 5),
    });
    if (dev.error) throw dev.error;

    const anyBurst = Boolean(ip.data?.burst) || Boolean(dev.data?.burst);

    if (anyBurst) {
      await sb.rpc("upsert_qa_finding", {
        p_area: "errors",
        p_severity: "high",
        p_title: "Bot-net burst detected",
        p_description: "Many distinct users share same IP/device hash within a short window. Possible automated abuse.",
        p_evidence: { ip: ip.data, device: dev.data },
        p_qa_run_id: null,
      });
    } else {
      await sb.rpc("resolve_qa_finding_if_exists", {
        p_area: "errors",
        p_title: "Bot-net burst detected",
      });
    }

    return new Response(JSON.stringify({ ok: true, ip: ip.data, device: dev.data, burst: anyBurst }), { status: 200, headers });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers });
  }
});
