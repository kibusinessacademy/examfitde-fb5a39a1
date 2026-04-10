import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14.21.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[BILLING-PORTAL] ${step}`, details ? JSON.stringify(details) : "");
};

/**
 * create-billing-portal-session: Opens Stripe Customer Portal for B2B admins.
 * 
 * Body params:
 *   org_id: string
 *   return_url?: string
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");

  if (!stripeKey) {
    return new Response(JSON.stringify({ error: "STRIPE_SECRET_KEY not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey);
  const sb = createClient(supabaseUrl, serviceRoleKey);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await userClient.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { org_id, return_url } = body;

    if (!org_id) {
      return new Response(JSON.stringify({ error: "org_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify user is org owner/admin
    const { data: membership } = await sb
      .from('org_memberships')
      .select('role')
      .eq('org_id', org_id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return new Response(JSON.stringify({ error: "Not authorized for this organization" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find Stripe customer ID from org_licenses
    const { data: license } = await sb
      .from('org_licenses')
      .select('stripe_customer_id')
      .eq('org_id', org_id)
      .not('stripe_customer_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!license?.stripe_customer_id) {
      return new Response(JSON.stringify({ error: "No billing information found for this organization" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const origin = req.headers.get("origin") || "https://examfitde.lovable.app";
    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: license.stripe_customer_id,
      return_url: return_url || `${origin}/org/enterprise`,
    });

    logStep("Billing portal session created", { orgId: org_id, customerId: license.stripe_customer_id });

    return new Response(
      JSON.stringify({ url: portalSession.url }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logStep("ERROR", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
