// Deno.serve is built-in
import Stripe from "npm:stripe@14.21.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest, json } from "../_shared/cors.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[WORK-CORPORATE-SYNC] ${step}`, details ? JSON.stringify(details) : '');
};

const PLAN_DEFAULTS: Record<string, number> = {
  team_10: 9900,
  company_100: 29900,
  site: 79900,
};

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

    const plans = ['team_10', 'company_100', 'site'] as const;
    const results: Record<string, any> = {};

    for (const plan of plans) {
      const { data: cc } = await adminClient
        .from('work_corporate_commerce')
        .select('*')
        .eq('plan', plan)
        .single();

      const amount = cc?.amount_cents || PLAN_DEFAULTS[plan];
      let stripeProductId = cc?.stripe_product_id || null;
      let stripePriceId = cc?.stripe_price_id || null;

      if (!stripeProductId) {
        const sp = await stripe.products.create({
          name: `ExamFit@work Corporate Lizenz — ${plan}`,
          description: `Corporate Lizenz Plan ${plan} (jährlich)`,
          metadata: { scope: 'corporate', plan, brand: 'ExamFit@work' },
        });
        stripeProductId = sp.id;
      }

      if (!stripePriceId) {
        const pr = await stripe.prices.create({
          product: stripeProductId,
          currency: 'eur',
          unit_amount: amount,
          metadata: { scope: 'corporate', plan },
        });
        stripePriceId = pr.id;
      }

      await adminClient.from('work_corporate_commerce').update({
        stripe_product_id: stripeProductId,
        stripe_price_id: stripePriceId,
        amount_cents: amount,
        updated_at: new Date().toISOString(),
      }).eq('plan', plan);

      results[plan] = { stripeProductId, stripePriceId, amount };
      logStep(`Plan ${plan} synced`, { stripeProductId, stripePriceId });
    }

    return json(200, { ok: true, plans: results }, origin);

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return json(500, { ok: false, error: msg }, origin);
  }
});
