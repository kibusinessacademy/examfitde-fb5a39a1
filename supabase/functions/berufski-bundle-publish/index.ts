// Deno.serve is built-in
import Stripe from "npm:stripe@14.21.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest, json } from "../_shared/cors.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[WORK-BUNDLE-PUBLISH] ${step}`, details ? JSON.stringify(details) : '');
};

Deno.serve(async (req) => {
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

    const { bundleId } = await req.json();
    if (!bundleId) return json(400, { ok: false, error: "bundleId required" }, origin);

    const { data: bundle, error: bErr } = await adminClient
      .from('work_bundles')
      .select('*')
      .eq('id', bundleId)
      .single();

    if (bErr || !bundle) return json(404, { ok: false, error: "Bundle not found" }, origin);

    const { data: assets } = await adminClient
      .from('work_bundle_assets')
      .select('kind, storage_path')
      .eq('bundle_id', bundleId);

    const hasPdf = (assets ?? []).some((a: any) => a.kind === 'pdf');
    if (!hasPdf) {
      return json(400, { ok: false, error: "Publish Gate failed: Bundle PDF asset missing." }, origin);
    }

    const amountCents = bundle.price_cents;
    let stripeProductId = bundle.stripe_product_id;
    let stripePriceId = bundle.stripe_price_id;

    if (!stripeProductId) {
      const sp = await stripe.products.create({
        name: bundle.title,
        description: bundle.description || 'ExamFit@work Bundle',
        metadata: { scope: 'bundle', bundleId, brand: 'ExamFit@work' },
      });
      stripeProductId = sp.id;
    }

    if (!stripePriceId) {
      const pr = await stripe.prices.create({
        product: stripeProductId!,
        currency: 'eur',
        unit_amount: amountCents,
        metadata: { scope: 'bundle', bundleId },
      });
      stripePriceId = pr.id;
    }

    await adminClient.from('work_bundles').update({
      stripe_product_id: stripeProductId,
      stripe_price_id: stripePriceId,
      is_active: true,
    }).eq('id', bundleId);

    logStep("Bundle published", { bundleId, stripeProductId, stripePriceId });
    return json(200, { ok: true, stripeProductId, stripePriceId }, origin);

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return json(500, { ok: false, error: msg }, origin);
  }
});
