// Deno.serve is built-in
import Stripe from "npm:stripe@14.21.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest, json } from "../_shared/cors.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[WORK-CORPORATE-CHECKOUT] ${step}`, details ? JSON.stringify(details) : '');
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
    const appBaseUrl = Deno.env.get("APP_BASE_URL") || "https://berufos.com";

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { buyerEmail, orgName, plan, scope, scopeId } = await req.json();

    if (!buyerEmail || !orgName || !plan || !scope || !scopeId) {
      return json(400, { ok: false, error: "Missing required fields" }, origin);
    }

    logStep("Corporate checkout", { orgName, plan, scope, scopeId });

    const { data: cc } = await adminClient
      .from('work_corporate_commerce')
      .select('*')
      .eq('plan', plan)
      .single();

    if (!cc?.stripe_price_id) {
      return json(400, { ok: false, error: "Corporate plan not synced to Stripe (admin: sync first)" }, origin);
    }

    if (scope === 'product') {
      const { data: prod } = await adminClient
        .from('work_produkte')
        .select('id, status')
        .eq('id', scopeId)
        .maybeSingle();
      if (!prod || prod.status !== 'published') {
        return json(400, { ok: false, error: "Product not found or not published" }, origin);
      }
    } else if (scope === 'bundle') {
      const { data: b } = await adminClient
        .from('work_bundles')
        .select('id, is_active')
        .eq('id', scopeId)
        .maybeSingle();
      if (!b || !b.is_active) {
        return json(400, { ok: false, error: "Bundle not found or not active" }, origin);
      }
    } else {
      return json(400, { ok: false, error: "Invalid scope" }, origin);
    }

    const successUrl = `${appBaseUrl}/work/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${appBaseUrl}/work/corporate`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: buyerEmail,
      line_items: [{ price: cc.stripe_price_id, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        scope: 'corporate',
        plan,
        orgName,
        buyerEmail,
        licenseScope: scope,
        licenseScopeId: scopeId,
        brand: 'ExamFit@work',
      },
    });

    logStep("Corporate checkout session created", { sessionId: session.id });
    return json(200, { ok: true, url: session.url }, origin);

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return json(500, { ok: false, error: msg }, origin);
  }
});
