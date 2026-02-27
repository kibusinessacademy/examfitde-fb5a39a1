import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EDGE_INTERNAL_SHARED_SECRET =
  Deno.env.get("EDGE_INTERNAL_SHARED_SECRET") || "";

function assertInternal(req: Request) {
  const hdr = req.headers.get("x-internal-secret") || "";
  if (!EDGE_INTERNAL_SHARED_SECRET || hdr !== EDGE_INTERNAL_SHARED_SECRET) {
    throw new Error("unauthorized");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ ok: false, error: "method_not_allowed" }, 405);
    }

    assertInternal(req);

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const mode = body?.mode ?? "check"; // check | remediate | both

    const out: Record<string, unknown> = { ok: true };

    if (mode === "check" || mode === "both") {
      const { data, error } = await sb.rpc("ops_run_integrity_checks");
      if (error) throw error;
      out.check = data;
    }

    if (mode === "remediate" || mode === "both") {
      const { data: expired, error: e1 } = await sb.rpc(
        "ops_expire_orphan_leases",
      );
      if (e1) throw e1;
      const { data: canceled, error: e2 } = await sb.rpc(
        "ops_cancel_pending_non_building_jobs",
      );
      if (e2) throw e2;
      out.remediate = {
        expired_orphan_leases: expired,
        canceled_pending_non_building: canceled,
      };
    }

    return json(out, 200);
  } catch (e: unknown) {
    const msg =
      typeof (e as Error)?.message === "string"
        ? (e as Error).message
        : "unknown_error";
    const status = msg === "unauthorized" ? 401 : 500;
    return json({ ok: false, error: msg }, status);
  }
});
