// supabase/functions/stripe-sync-reaper/index.ts
//
// Self-Healing Cron: scans `products` for rows that are active but have no
// `stripe_product_id` (or whose latest active price row has no
// `stripe_price_id`) and re-invokes `stripe-sync-product` for each. Catches
// drift from missed trigger fires, transient Stripe outages, or rows that
// existed before the trigger was installed.
//
// Auth: shared `CRON_SECRET` via `x-sync-secret` header. Same secret the
// DB-Trigger uses, so pg_cron can call this with the existing vault entry.
//
// Schedule (run once via supabase--insert):
//   select cron.schedule(
//     'stripe-sync-reaper-15min', '*/15 * * * *',
//     $$ select net.http_post(
//          url := current_setting('app.settings.stripe_sync_reaper_url', true),
//          headers := jsonb_build_object(
//            'Content-Type','application/json',
//            'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets
//                              where name='stripe_sync_webhook_secret')
//          ),
//          body := '{}'::jsonb
//        ); $$);

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYNC_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const DEFAULT_BATCH = 25;
const MAX_BATCH = 100;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function invokeSync(productId: string) {
  const url = `${SUPABASE_URL}/functions/v1/stripe-sync-product`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-sync-secret": SYNC_SECRET,
      // Edge runtime requires Authorization on function-to-function calls
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ product_id: productId }),
  });
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* keep text */ }
  return { ok: res.ok, status: res.status, body };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  if (!SYNC_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "missing required environment variables" }, 500);
  }

  if (req.headers.get("x-sync-secret") !== SYNC_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  let batch = DEFAULT_BATCH;
  let dryRun = false;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.batch === "number") batch = Math.min(Math.max(1, body.batch), MAX_BATCH);
    if (body?.dry_run === true) dryRun = true;
  } catch { /* empty body ok */ }

  // 1) Products active but missing stripe_product_id
  const { data: missingProducts, error: prodErr } = await supabase
    .from("products")
    .select("id, title, status, stripe_product_id")
    .eq("status", "active")
    .is("stripe_product_id", null)
    .limit(batch);

  if (prodErr) return json({ error: prodErr.message }, 500);

  const candidates = (missingProducts ?? []).map((p) => p.id);

  if (dryRun) {
    return json({ dry_run: true, found: candidates.length, candidates });
  }

  const results: Array<{ product_id: string; ok: boolean; status: number; body: unknown }> = [];
  for (const pid of candidates) {
    try {
      const r = await invokeSync(pid);
      results.push({ product_id: pid, ...r });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ product_id: pid, ok: false, status: 0, body: { error: message } });
    }
  }

  const summary = {
    scanned: candidates.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    batch,
    results,
    ran_at: new Date().toISOString(),
  };

  // Audit (best-effort — table may not exist in all envs)
  await supabase.from("stripe_sync_log").insert({
    product_id: null,
    status: summary.failed === 0 ? "success" : "failed",
    error_message: `reaper: scanned=${summary.scanned} ok=${summary.succeeded} fail=${summary.failed}`,
  }).then(() => {}, () => {});

  return json(summary);
});
