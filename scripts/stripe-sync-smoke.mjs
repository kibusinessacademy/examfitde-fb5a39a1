#!/usr/bin/env node
/**
 * Stripe-Sync Smoke-Test
 *
 * Workflow:
 *   1. Picks a product (env STRIPE_SMOKE_PRODUCT_ID > first inactive w/o stripe_product_id)
 *   2. Snapshots prior stripe_sync_log row count
 *   3. Sets status='active', clears stripe_product_id  → DB-Trigger feuert pg_net
 *   4. Optional: ruft die Edge Function direkt (--invoke) — schneller Loop ohne pg_cron
 *   5. Pollt stripe_sync_log + products bis stripe_product_id gesetzt ist (oder TIMEOUT)
 *   6. Druckt JSON-Verdict, exit 0 = ok, 1 = fail
 *
 * Run:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... CRON_SECRET=... \
 *     node scripts/stripe-sync-smoke.mjs [--invoke] [--product <uuid>] [--timeout 60]
 *
 * Notes:
 *   - SERVICE_ROLE_KEY ist Lovable-Cloud-intern nicht abgreifbar. Diesen Smoke-Test
 *     außerhalb der Cloud (CI-Job mit hinterlegtem Secret oder externes Projekt) fahren.
 *   - --invoke ruft die Edge Function direkt mit x-sync-secret = CRON_SECRET auf
 *     (umgeht pg_net und ist deterministisch für Smoke).
 */

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = args[i + 1];
  return v && !v.startsWith("--") ? v : true;
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const PRODUCT_ID = opt("product", process.env.STRIPE_SMOKE_PRODUCT_ID);
const TIMEOUT_S = Number(opt("timeout", 60));
const FORCE_INVOKE = !!opt("invoke", false);

if (!SUPABASE_URL || !SERVICE_KEY || !CRON_SECRET) {
  console.error("Missing required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET");
  process.exit(2);
}

const hdrs = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function rest(path, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...hdrs, Prefer: "return=representation", ...(init.headers || {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`REST ${path} → ${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function pickProductId() {
  if (PRODUCT_ID) return PRODUCT_ID;
  const rows = await rest(
    `products?select=id,title&stripe_product_id=is.null&limit=1&order=created_at.desc`,
  );
  if (!rows?.length) throw new Error("No product without stripe_product_id available — pass --product <uuid>");
  return rows[0].id;
}

async function getLogCount(productId) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/stripe_sync_log?product_id=eq.${productId}&select=id`,
    { headers: { ...hdrs, Prefer: "count=exact" } },
  );
  const range = r.headers.get("content-range") ?? "0/0";
  return Number(range.split("/")[1] || 0);
}

async function invokeEdge(productId) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/stripe-sync-product`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-sync-secret": CRON_SECRET,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ product_id: productId }),
  });
  const text = await r.text();
  return { status: r.status, body: tryJson(text) };
}

function tryJson(t) { try { return JSON.parse(t); } catch { return t; } }

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const productId = await pickProductId();
  console.log(`▶ smoke product_id = ${productId}`);

  const before = await getLogCount(productId);
  console.log(`▶ stripe_sync_log rows before = ${before}`);

  // Activate + clear stripe_product_id → fires DB-Trigger
  await rest(`products?id=eq.${productId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "active", stripe_product_id: null }),
  });
  console.log("▶ product set status=active, stripe_product_id=null");

  if (FORCE_INVOKE) {
    const inv = await invokeEdge(productId);
    console.log("▶ direct edge invoke →", inv.status, JSON.stringify(inv.body));
  } else {
    console.log("▶ waiting for DB-Trigger → pg_net → edge function …");
  }

  const deadline = Date.now() + TIMEOUT_S * 1000;
  let synced = null;
  let lastLog = null;
  while (Date.now() < deadline) {
    const [prods, logs] = await Promise.all([
      rest(`products?id=eq.${productId}&select=id,title,status,stripe_product_id,stripe_synced_at`),
      rest(`stripe_sync_log?product_id=eq.${productId}&select=id,status,error_message,stripe_product_id,stripe_price_id,created_at&order=created_at.desc&limit=3`),
    ]);
    lastLog = logs;
    if (prods?.[0]?.stripe_product_id) {
      synced = prods[0];
      break;
    }
    await sleep(2000);
  }

  const after = await getLogCount(productId);
  const verdict = {
    product_id: productId,
    ok: !!synced,
    stripe_product_id: synced?.stripe_product_id ?? null,
    stripe_synced_at: synced?.stripe_synced_at ?? null,
    log_rows_before: before,
    log_rows_after: after,
    latest_logs: lastLog,
  };
  console.log("\n=== VERDICT ===");
  console.log(JSON.stringify(verdict, null, 2));
  process.exit(verdict.ok ? 0 : 1);
}

main().catch((e) => {
  console.error("✗ smoke failed:", e?.message || e);
  process.exit(1);
});
