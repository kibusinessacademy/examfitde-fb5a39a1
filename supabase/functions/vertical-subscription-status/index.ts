// Liest live aus Stripe + DB die Subscription-Lage eines Users pro Branche.
// Synchronisiert active/canceled/past_due in vertical_subscriptions.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const log = (s: string, d?: unknown) =>
  console.log(`[VERTICAL-SUB-STATUS] ${s}${d ? " - " + JSON.stringify(d) : ""}`);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY missing");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Authorization header required");

    const supabaseAnon = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(token);
    if (userErr || !userData.user?.email) throw new Error("not authenticated");
    const user = userData.user;

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    if (customers.data.length === 0) {
      return new Response(JSON.stringify({ subscriptions: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }
    const customerId = customers.data[0].id;
    log("customer", { customerId });

    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 20,
    });

    const supabaseService = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const result: Array<{
      vertical_slug: string;
      tier: string;
      status: string;
      current_period_end: string | null;
      vorgang_limit: number;
    }> = [];

    for (const sub of subs.data) {
      const md = sub.metadata ?? {};
      const verticalSlug = md.vertical_slug;
      const tier = md.tier;
      if (!verticalSlug || !tier) continue;
      const limit = Number(md.monthly_vorgang_limit ?? 0) || 0;

      // upsert by stripe_subscription_id
      const statusNorm =
        sub.status === "active" || sub.status === "trialing"
          ? "active"
          : sub.status === "past_due"
          ? "past_due"
          : sub.status === "canceled" || sub.status === "incomplete_expired"
          ? "canceled"
          : sub.status === "unpaid"
          ? "past_due"
          : "pending";

      const periodEnd = sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null;
      const periodStart = sub.current_period_start
        ? new Date(sub.current_period_start * 1000).toISOString()
        : null;

      await supabaseService.from("vertical_subscriptions").upsert(
        {
          user_id: user.id,
          vertical_slug: verticalSlug,
          tier,
          status: statusNorm,
          stripe_customer_id: customerId,
          stripe_subscription_id: sub.id,
          stripe_price_id: sub.items.data[0]?.price.id ?? null,
          current_period_start: periodStart,
          current_period_end: periodEnd,
          monthly_vorgang_limit: limit > 0 ? limit : undefined,
        },
        { onConflict: "stripe_subscription_id" }
      );

      result.push({
        vertical_slug: verticalSlug,
        tier,
        status: statusNorm,
        current_period_end: periodEnd,
        vorgang_limit: limit,
      });
    }

    return new Response(JSON.stringify({ subscriptions: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("ERROR", { msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
