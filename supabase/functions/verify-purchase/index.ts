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

    // Check if package already exists (idempotency)
    const { data: existingPackage } = await adminClient
      .from('license_packages')
      .select('id')
      .eq('stripe_checkout_session_id', session_id)
      .maybeSingle();

    if (existingPackage) {
      logStep("Package already exists", { packageId: existingPackage.id });
      
      // Return existing package info
      const { data: seats } = await adminClient
        .from('license_seats')
        .select('id, invite_code, assigned_user_id')
        .eq('package_id', existingPackage.id);

      return new Response(
        JSON.stringify({ 
          success: true, 
          package_id: existingPackage.id,
          seats: seats || [],
          already_processed: true
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Extract metadata
    const { product_id, curriculum_id, quantity, unit_price_cents } = session.metadata!;
    const quantityNum = parseInt(quantity);
    const unitPriceCents = parseInt(unit_price_cents);
    const totalPriceCents = quantityNum * unitPriceCents;

    // Get product info
    const { data: product, error: productError } = await adminClient
      .from('store_products')
      .select('*')
      .eq('id', product_id)
      .single();

    if (productError || !product) {
      throw new Error("Product not found");
    }

    // Calculate expiration date (12 months from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (product.access_duration_days || 365));

    // Create license package
    const { data: licensePackage, error: packageError } = await adminClient
      .from('license_packages')
      .insert({
        buyer_user_id: user.id,
        product_id: product_id,
        curriculum_id: curriculum_id,
        quantity: quantityNum,
        price_paid_cents: totalPriceCents,
        stripe_checkout_session_id: session_id,
        stripe_payment_intent_id: typeof session.payment_intent === 'string' 
          ? session.payment_intent 
          : session.payment_intent?.id,
        expires_at: expiresAt.toISOString(),
        status: 'active',
      })
      .select()
      .single();

    if (packageError || !licensePackage) {
      logStep("Failed to create package", { error: packageError });
      throw new Error("Failed to create license package");
    }
    logStep("License package created", { packageId: licensePackage.id });

    // Create seats
    const seatsToCreate = [];
    for (let i = 0; i < quantityNum; i++) {
      const isFirstSeat = i === 0;
      seatsToCreate.push({
        package_id: licensePackage.id,
        assigned_user_id: isFirstSeat ? user.id : null, // First seat goes to buyer
        invite_code: isFirstSeat ? null : generateInviteCode(),
        assigned_at: isFirstSeat ? new Date().toISOString() : null,
      });
    }

    const { data: seats, error: seatsError } = await adminClient
      .from('license_seats')
      .insert(seatsToCreate)
      .select();

    if (seatsError) {
      logStep("Failed to create seats", { error: seatsError });
      throw new Error("Failed to create license seats");
    }
    logStep("Seats created", { count: seats?.length });

    // Create entitlement for buyer (first seat)
    const buyerSeat = seats?.find(s => s.assigned_user_id === user.id);
    if (buyerSeat) {
      const { error: entitlementError } = await adminClient
        .from('entitlements')
        .insert({
          user_id: user.id,
          seat_id: buyerSeat.id,
          curriculum_id: curriculum_id,
          has_learning_course: product.includes_learning_course,
          has_exam_trainer: product.includes_exam_trainer,
          has_ai_tutor: product.includes_ai_tutor,
          has_oral_trainer: product.includes_oral_trainer,
          valid_until: expiresAt.toISOString(),
        });

      if (entitlementError) {
        logStep("Failed to create entitlement", { error: entitlementError });
      } else {
        logStep("Entitlement created for buyer");
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        package_id: licensePackage.id,
        seats: seats?.map(s => ({
          id: s.id,
          invite_code: s.invite_code,
          assigned_user_id: s.assigned_user_id,
        })) || [],
        expires_at: expiresAt.toISOString(),
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
