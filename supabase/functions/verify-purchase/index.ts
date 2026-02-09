import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[VERIFY-PURCHASE] ${step}`, details ? JSON.stringify(details) : '');
};

// Generate invite code
function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const token = authHeader.replace("Bearer ", "");
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) {
      throw new Error("User not authenticated");
    }
    logStep("User authenticated", { userId: user.id });

    // Parse request
    const { session_id } = await req.json();
    if (!session_id) {
      throw new Error("Missing session_id");
    }
    logStep("Verifying session", { session_id });

    // Initialize Stripe
    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    // Retrieve checkout session
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['payment_intent'],
    });

    if (session.payment_status !== 'paid') {
      throw new Error("Payment not completed");
    }

    // Verify this session belongs to the user
    if (session.metadata?.user_id !== user.id) {
      throw new Error("Session does not belong to this user");
    }

    logStep("Session verified", { 
      paymentStatus: session.payment_status,
      metadata: session.metadata 
    });

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Status-only: prüfen, ob der Webhook bereits ein Package erzeugt hat
    const { data: existingPackage } = await adminClient
      .from('license_packages')
      .select('id')
      .eq('stripe_checkout_session_id', session_id)
      .maybeSingle();

    if (existingPackage) {
      logStep("Package exists", { packageId: existingPackage.id });

      const { data: seats } = await adminClient
        .from('license_seats')
        .select('id, invite_code, assigned_user_id')
        .eq('package_id', existingPackage.id);

      return new Response(
        JSON.stringify({
          success: true,
          paid: true,
          package_exists: true,
          package_id: existingPackage.id,
          seats: seats || [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Kein Package vorhanden → Webhook verarbeitet evtl. noch / fehlkonfiguriert
    return new Response(
      JSON.stringify({
        success: true,
        paid: true,
        package_exists: false,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
