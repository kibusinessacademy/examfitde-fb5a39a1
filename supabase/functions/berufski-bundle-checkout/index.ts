import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest, json } from "../_shared/cors.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[BERUFSKI-BUNDLE-CHECKOUT] ${step}`, details ? JSON.stringify(details) : '');
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
    const appBaseUrl = Deno.env.get("APP_BASE_URL") || "https://examfit.de";

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { bundleId, buyerEmail, couponCode, affiliateCode, landingPath } = await req.json();

    if (!bundleId || !buyerEmail) {
      return json(400, { ok: false, error: "bundleId and buyerEmail required" }, origin);
    }

    logStep("Bundle checkout request", { bundleId, buyerEmail });

    // Bundle must be published
    const { data: bundle, error: bErr } = await adminClient
      .from('berufski_bundles')
      .select('id, slug, title, is_active, stripe_price_id, stripe_product_id, price_cents')
      .eq('id', bundleId)
      .single();

    if (bErr || !bundle) return json(404, { ok: false, error: "Bundle not found" }, origin);
    if (!bundle.is_active) return json(400, { ok: false, error: "Bundle not active" }, origin);
    if (!bundle.stripe_price_id) return json(400, { ok: false, error: "No Stripe price (publish bundle first)" }, origin);

    // Coupon validation
    let discounts: Array<{ coupon: string }> | undefined = undefined;
    let appliedCouponCode: string | null = null;

    if (couponCode) {
      const { data: coupon } = await adminClient
        .from('berufski_coupons')
        .select('*')
        .eq('code', couponCode)
        .eq('active', true)
        .maybeSingle();

      const now = new Date();
      const valid = coupon &&
        (!coupon.starts_at || new Date(coupon.starts_at) <= now) &&
        (!coupon.ends_at || new Date(coupon.ends_at) >= now) &&
        (!coupon.max_redemptions || coupon.redeemed_count < coupon.max_redemptions);

      if (valid) {
        let stripeCouponId = coupon.stripe_coupon_id;
        if (!stripeCouponId) {
          const created = coupon.type === 'percent'
            ? await stripe.coupons.create({ percent_off: Number(coupon.value), duration: 'once' })
            : await stripe.coupons.create({ amount_off: Math.round(Number(coupon.value) * 100), currency: 'eur', duration: 'once' });
          stripeCouponId = created.id;
          await adminClient.from('berufski_coupons').update({ stripe_coupon_id: stripeCouponId }).eq('id', coupon.id);
        }
        discounts = [{ coupon: stripeCouponId }];
        appliedCouponCode = coupon.code;
      }
    }

    // Affiliate tracking
    if (affiliateCode) {
      await adminClient.from('berufski_affiliate_clicks').insert({
        affiliate_code: affiliateCode,
        landing_path: landingPath || `/berufski/bundles/${bundle.slug}`,
        referrer: req.headers.get('referer') || null,
      }).catch(() => null);
    }

    const successUrl = `${appBaseUrl}/work/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${appBaseUrl}${landingPath || `/work/bundles/${bundle.slug}`}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: buyerEmail,
      line_items: [{ price: bundle.stripe_price_id, quantity: 1 }],
      discounts,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        scope: 'bundle',
        bundleId: bundle.id,
        couponCode: appliedCouponCode || '',
        affiliateCode: affiliateCode || '',
        brand: 'ExamFit@work',
      },
    });

    logStep("Checkout session created", { sessionId: session.id });
    return json(200, { ok: true, url: session.url }, origin);

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return json(500, { ok: false, error: msg }, origin);
  }
});
