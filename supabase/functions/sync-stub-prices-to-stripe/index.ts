/**
 * sync-stub-prices-to-stripe
 *
 * Loopt durch alle aktiven product_prices ohne stripe_price_id, erzeugt für das
 * referenzierte products-Row ein Stripe-Product (oder nutzt vorhandene Stripe-ID)
 * und legt einen Stripe-Price an. Schreibt stripe_price_id zurück.
 *
 * Auth: admin only (has_role).
 *
 * Body: { dry_run?: boolean, limit?: number }
 */
import Stripe from "npm:stripe@14.21.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest, json } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not set");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Auth: either admin user OR internal shared secret (for batch/cron heal)
    const internalSecret = req.headers.get("x-internal-secret");
    const expectedInternal = Deno.env.get("EDGE_INTERNAL_SHARED_SECRET");
    const isInternal = expectedInternal && internalSecret === expectedInternal;
    if (!isInternal) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return json(401, { ok: false, error: "Unauthorized" }, origin);
      const token = authHeader.replace("Bearer ", "");
      const { data: userData } = await admin.auth.getUser(token);
      if (!userData?.user) return json(401, { ok: false, error: "Invalid token" }, origin);
      const { data: roleRow } = await admin.rpc("has_role", {
        _user_id: userData.user.id, _role: "admin",
      });
      if (!roleRow) return json(403, { ok: false, error: "Admin role required" }, origin);
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = Boolean(body.dry_run);
    const limit = Math.min(Number(body.limit ?? 500), 1000);

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    // Pull stub prices: active, no stripe_price_id, with product reference
    const { data: stubs, error: stubErr } = await admin
      .from("product_prices")
      .select("id, product_id, currency, amount_cents, billing_type, access_months, products!inner(id, title, slug)")
      .is("stripe_price_id", null)
      .eq("active", true)
      .limit(limit);
    if (stubErr) throw stubErr;

    let created_products = 0;
    let created_prices = 0;
    let updated = 0;
    let skipped = 0;
    const errors: any[] = [];

    for (const row of stubs ?? []) {
      const product: any = (row as any).products;
      try {
        if (dryRun) {
          skipped++;
          continue;
        }

        // 1. Stripe Product (idempotent via metadata.product_id)
        const search = await stripe.products.search({
          query: `metadata['product_id']:'${product.id}'`,
          limit: 1,
        });
        let stripeProductId = search.data[0]?.id;
        if (!stripeProductId) {
          const sp = await stripe.products.create({
            name: product.title ?? product.slug ?? `Product ${product.id}`,
            metadata: { product_id: product.id, slug: product.slug ?? "" },
          });
          stripeProductId = sp.id;
          created_products++;
        }

        // 2. Stripe Price
        const sPrice = await stripe.prices.create({
          product: stripeProductId,
          currency: (row.currency ?? "EUR").toLowerCase(),
          unit_amount: row.amount_cents,
          metadata: { product_price_id: row.id, access_months: String(row.access_months ?? 12) },
        });
        created_prices++;

        // 3. Write back
        const { error: updErr } = await admin
          .from("product_prices")
          .update({ stripe_price_id: sPrice.id, updated_at: new Date().toISOString() })
          .eq("id", row.id);
        if (updErr) throw updErr;
        updated++;
      } catch (e) {
        errors.push({ price_id: row.id, product_id: row.product_id, error: String(e) });
      }
    }

    await admin.from("auto_heal_log").insert({
      action_type: "sync_stub_prices_to_stripe",
      target_type: "system",
      result_status: errors.length === 0 ? "success" : "partial",
      result_detail: `processed=${stubs?.length ?? 0} updated=${updated} created_products=${created_products} created_prices=${created_prices} errors=${errors.length}`,
      metadata: { dry_run: dryRun, updated, created_products, created_prices, errors: errors.slice(0, 25) },
    });

    return json(200, {
      ok: true,
      dry_run: dryRun,
      processed: stubs?.length ?? 0,
      updated,
      created_products,
      created_prices,
      errors,
    }, origin);
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
