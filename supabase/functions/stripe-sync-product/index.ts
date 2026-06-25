// supabase/functions/stripe-sync-product/index.ts
//
// Triggered by DB-Trigger trg_stripe_sync_product via pg_net whenever a product
// is activated without a stripe_product_id. Creates Stripe Product + Price
// idempotently (Idempotency-Key = product_id / price_id), writes back to
// products/product_prices and logs every run into stripe_sync_log.
//
// Auth model:
//   - Webhook from pg_net: x-sync-secret header === CRON_SECRET (shared, via Vault).
//   - SUPABASE_SERVICE_ROLE_KEY is auto-injected into edge functions by the
//     Supabase runtime (not visible in the Lovable UI, but available at runtime).
//
// Manual one-off setup (see DEPLOY.md):
//   1) supabase secrets: STRIPE_SECRET_KEY, CRON_SECRET
//   2) SQL: select vault.create_secret('<CRON_SECRET>', 'stripe_sync_webhook_secret');
//   3) SQL: ALTER DATABASE postgres SET app.settings.stripe_sync_function_url =
//          'https://<PROJECT_REF>.supabase.co/functions/v1/stripe-sync-product';

import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@14";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SYNC_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function logSync(
  productId: string,
  status: "success" | "failed" | "skipped",
  fields: Partial<{
    error_message: string;
    stripe_product_id: string;
    stripe_price_id: string;
  }> = {},
) {
  await supabase.from("stripe_sync_log").insert({
    product_id: productId,
    status,
    ...fields,
  });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  if (!STRIPE_SECRET_KEY || !SYNC_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "missing required environment variables" }, 500);
  }

  const secret = req.headers.get("x-sync-secret");
  if (!secret || secret !== SYNC_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  let productId: string;
  try {
    const body = await req.json();
    productId = body.product_id;
    if (!productId || typeof productId !== "string") {
      throw new Error("product_id missing or invalid");
    }
  } catch {
    return json({ error: "invalid request body" }, 400);
  }

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id, title, slug, status, stripe_product_id")
    .eq("id", productId)
    .single();

  if (productError || !product) {
    await logSync(productId, "failed", { error_message: "product not found" });
    return json({ error: "product not found" }, 404);
  }

  if (product.stripe_product_id) {
    await logSync(productId, "skipped", {
      error_message: "already synced",
      stripe_product_id: product.stripe_product_id,
    });
    return json({ skipped: true, stripe_product_id: product.stripe_product_id });
  }

  const { data: price, error: priceError } = await supabase
    .from("product_prices")
    .select("id, amount_cents, currency, stripe_price_id")
    .eq("product_id", product.id)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (priceError || !price) {
    await logSync(productId, "failed", { error_message: "no active price row for product" });
    return json({ error: "no active price row" }, 422);
  }

  try {
    const stripeProduct = await stripe.products.create(
      {
        name: product.title,
        metadata: {
          source: "lovable-cloud",
          product_id: product.id,
          slug: product.slug ?? "",
        },
      },
      { idempotencyKey: `stripe-sync-product-${product.id}` },
    );

    const stripePrice = await stripe.prices.create(
      {
        product: stripeProduct.id,
        unit_amount: price.amount_cents,
        currency: price.currency,
        metadata: { product_id: product.id, price_id: price.id },
      },
      { idempotencyKey: `stripe-sync-price-${price.id}` },
    );

    await supabase
      .from("products")
      .update({
        stripe_product_id: stripeProduct.id,
        stripe_synced_at: new Date().toISOString(),
      })
      .eq("id", product.id);

    await supabase
      .from("product_prices")
      .update({
        stripe_price_id: stripePrice.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", price.id);

    await logSync(productId, "success", {
      stripe_product_id: stripeProduct.id,
      stripe_price_id: stripePrice.id,
    });

    return json({
      product_id: product.id,
      stripe_product_id: stripeProduct.id,
      stripe_price_id: stripePrice.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logSync(productId, "failed", { error_message: message });
    return json({ error: message }, 500);
  }
});
