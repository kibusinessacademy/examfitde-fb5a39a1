import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest, json } from "../_shared/cors.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[BERUFSKI-PUBLISH-GATE] ${step}`, details ? JSON.stringify(details) : '');
};

function tierAmount(tier: string): number {
  return tier === '9' ? 900 : tier === '19' ? 1900 : 2900;
}

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get('origin');

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not set");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Auth check (admin only)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(401, { ok: false, error: "Unauthorized" }, origin);

    const token = authHeader.replace('Bearer ', '');
    const { data: userData } = await adminClient.auth.getUser(token);
    if (!userData?.user) return json(401, { ok: false, error: "Invalid token" }, origin);

    // Check admin role
    const { data: profile } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', userData.user.id)
      .single();

    if (profile?.role !== 'admin') {
      return json(403, { ok: false, error: "Admin access required" }, origin);
    }

    const { productId } = await req.json();
    if (!productId) return json(400, { ok: false, error: "productId required" }, origin);

    logStep("Publish gate started", { productId });

    // Load product
    const { data: prod, error: prodErr } = await adminClient
      .from('berufski_produkte')
      .select('id, tier, titel, status, content_json, beruf_id, stripe_price_id, stripe_product_id')
      .eq('id', productId)
      .single();

    if (prodErr || !prod) return json(404, { ok: false, error: "Product not found" }, origin);

    // Must have content
    if (!prod.content_json) {
      return json(400, { ok: false, error: "Publish Gate failed: No content generated yet." }, origin);
    }

    // Gate: Require PDF exports (screen + print)
    const { data: exports } = await adminClient
      .from('berufski_pdf_exports')
      .select('mode')
      .eq('product_id', productId);

    const modes = new Set((exports || []).map((x: any) => x.mode));
    if (!modes.has('screen') || !modes.has('print')) {
      return json(400, {
        ok: false,
        error: "Publish Gate failed: PDF exports missing (need screen + print).",
        missing: { screen: !modes.has('screen'), print: !modes.has('print') },
      }, origin);
    }

    // Get beruf for metadata
    const { data: beruf } = await adminClient
      .from('berufski_berufe')
      .select('name, slug')
      .eq('id', prod.beruf_id)
      .single();

    const amount = tierAmount(prod.tier);
    let stripeProductId = prod.stripe_product_id;
    let stripePriceId = prod.stripe_price_id;

    // Create Stripe product if missing
    if (!stripeProductId) {
      const sp = await stripe.products.create({
        name: prod.titel,
        description: `ExamFit@work Produkt für ${beruf?.name || 'Beruf'} (Tier ${prod.tier}€).`,
        metadata: { productId, beruf: beruf?.name || '', tier: prod.tier, brand: 'ExamFit@work' },
      });
      stripeProductId = sp.id;
      logStep("Stripe product created", { stripeProductId });
    }

    // Create Stripe price if missing
    if (!stripePriceId) {
      const pr = await stripe.prices.create({
        product: stripeProductId,
        currency: 'eur',
        unit_amount: amount,
        metadata: { productId, tier: prod.tier },
      });
      stripePriceId = pr.id;
      logStep("Stripe price created", { stripePriceId });
    }

    // Update product with Stripe IDs + published status
    await adminClient.from('berufski_produkte').update({
      status: 'published',
      published_at: new Date().toISOString(),
      stripe_product_id: stripeProductId,
      stripe_price_id: stripePriceId,
      amount_cents: amount,
    }).eq('id', productId);

    logStep("Product published", { productId, stripeProductId, stripePriceId });

    return json(200, { ok: true, stripeProductId, stripePriceId, amount }, origin);

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return json(500, { ok: false, error: msg }, origin);
  }
});
