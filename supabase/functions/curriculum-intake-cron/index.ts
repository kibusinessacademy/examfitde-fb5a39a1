import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";

async function invoke(url: string, key: string, fn: string, body: unknown) {
  const res = await fetch(`${url}/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { step: fn, ok: res.ok, status: res.status, data };
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") return json(405, { error: "POST only" }, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const body = await req.json().catch(() => ({}));

  // ── Phase 1: Discover (must run first) ──
  const phase1: Promise<any>[] = [];
  if (body.discover !== false) {
    phase1.push(invoke(supabaseUrl, serviceKey, "curriculum-discover-sources", {})
      .then(r => ({ ...r, step: "discover" })));
  }
  const phase1Results = phase1.length > 0 ? await Promise.all(phase1) : [];

  // ── Phase 2: Download + Parse (parallel — independent workers) ──
  const phase2: Promise<any>[] = [];
  if (body.download !== false) {
    phase2.push(invoke(supabaseUrl, serviceKey, "curriculum-intake-worker", {
      job_type: "download", limit: 10,
    }).then(r => ({ ...r, step: "download" })));
  }
  if (body.parse !== false) {
    phase2.push(invoke(supabaseUrl, serviceKey, "curriculum-intake-worker", {
      job_type: "parse", limit: 10,
    }).then(r => ({ ...r, step: "parse" })));
  }
  const phase2Results = phase2.length > 0 ? await Promise.all(phase2) : [];

  // ── Phase 3: Promote (depends on parse) ──
  const phase3: Promise<any>[] = [];
  if (body.promote !== false) {
    phase3.push(invoke(supabaseUrl, serviceKey, "curriculum-promote-candidates", {
      limit: 20,
    }).then(r => ({ ...r, step: "promote" })));
  }
  const phase3Results = phase3.length > 0 ? await Promise.all(phase3) : [];

  const steps = [...phase1Results, ...phase2Results, ...phase3Results];

  return json(200, {
    ok: true,
    parallel: true,
    phases: 3,
    steps,
    ran_at: new Date().toISOString(),
  }, origin);
});
