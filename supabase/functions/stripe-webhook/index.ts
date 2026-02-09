import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[STRIPE-WEBHOOK] ${step}`, details ? JSON.stringify(details) : '');
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
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  // Webhooks don't need CORS - they come from Stripe servers directly
  // But we handle OPTIONS above for consistency


  try {
    logStep("Webhook received");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not set");
    if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET not set");

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Get the raw body and signature
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      logStep("ERROR: Missing stripe-signature header");
      return new Response("Missing signature", { status: 400 });
    }

    // Verify webhook signature
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logStep("ERROR: Signature verification failed", { error: message });
      return new Response(`Webhook signature verification failed: ${message}`, { status: 400 });
    }

    logStep("Event verified", { type: event.type, id: event.id });

    // Handle checkout.session.completed
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      
      logStep("Processing checkout.session.completed", { 
        sessionId: session.id,
        paymentStatus: session.payment_status,
        metadata: session.metadata
      });

      // Only process paid sessions
      if (session.payment_status !== "paid") {
        logStep("Skipping unpaid session");
        return new Response(JSON.stringify({ received: true, skipped: "unpaid" }), { status: 200 });
      }

      const userId = session.metadata?.user_id;
      const productId = session.metadata?.product_id;
      const curriculumId = session.metadata?.curriculum_id;
      const quantity = parseInt(session.metadata?.quantity || "1");
      const unitPriceCents = parseInt(session.metadata?.unit_price_cents || "0");

      if (!userId || !productId || !curriculumId) {
        logStep("ERROR: Missing required metadata", { userId, productId, curriculumId });
        return new Response("Missing metadata", { status: 400 });
      }

      // IDEMPOTENCY CHECK: Skip if already processed
      const { data: existingPackage } = await adminClient
        .from('license_packages')
        .select('id')
        .eq('stripe_checkout_session_id', session.id)
        .maybeSingle();

      if (existingPackage) {
        logStep("Package already exists - idempotent skip", { packageId: existingPackage.id });
        return new Response(JSON.stringify({ received: true, already_processed: true }), { status: 200 });
      }

      // Get product info
      const { data: product, error: productError } = await adminClient
        .from('store_products')
        .select('*')
        .eq('id', productId)
        .single();

      if (productError || !product) {
        logStep("ERROR: Product not found", { productId, error: productError });
        return new Response("Product not found", { status: 400 });
      }

      // Calculate expiration date
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + (product.access_duration_days || 365));

      const totalPriceCents = quantity * unitPriceCents;

      // Create license package
      const { data: licensePackage, error: packageError } = await adminClient
        .from('license_packages')
        .insert({
          buyer_user_id: userId,
          product_id: productId,
          curriculum_id: curriculumId,
          quantity: quantity,
          price_paid_cents: totalPriceCents,
          stripe_checkout_session_id: session.id,
          stripe_payment_intent_id: typeof session.payment_intent === 'string' 
            ? session.payment_intent 
            : session.payment_intent?.id || null,
          expires_at: expiresAt.toISOString(),
          status: 'active',
        })
        .select()
        .single();

      if (packageError || !licensePackage) {
        logStep("ERROR: Failed to create package", { error: packageError });
        return new Response("Failed to create license package", { status: 500 });
      }
      logStep("License package created", { packageId: licensePackage.id });

      // Create seats
      const seatsToCreate = [];
      for (let i = 0; i < quantity; i++) {
        const isFirstSeat = i === 0;
        seatsToCreate.push({
          package_id: licensePackage.id,
          assigned_user_id: isFirstSeat ? userId : null,
          invite_code: isFirstSeat ? null : generateInviteCode(),
          assigned_at: isFirstSeat ? new Date().toISOString() : null,
        });
      }

      const { data: seats, error: seatsError } = await adminClient
        .from('license_seats')
        .insert(seatsToCreate)
        .select();

      if (seatsError) {
        logStep("ERROR: Failed to create seats", { error: seatsError });
        // Don't fail the webhook - package was created
      } else {
        logStep("Seats created", { count: seats?.length });
      }

      // Create entitlement for buyer (first seat)
      const buyerSeat = seats?.find(s => s.assigned_user_id === userId);
      if (buyerSeat) {
        const { error: entitlementError } = await adminClient
          .from('entitlements')
          .insert({
            user_id: userId,
            seat_id: buyerSeat.id,
            curriculum_id: curriculumId,
            has_learning_course: product.includes_learning_course,
            has_exam_trainer: product.includes_exam_trainer,
            has_ai_tutor: product.includes_ai_tutor,
            has_oral_trainer: product.includes_oral_trainer,
            valid_until: expiresAt.toISOString(),
          });

        if (entitlementError) {
          logStep("ERROR: Failed to create entitlement", { error: entitlementError });
        } else {
          logStep("Entitlement created for buyer");
        }
      }

      logStep("checkout.session.completed fully processed", { 
        packageId: licensePackage.id,
        userId,
        curriculumId
      });
    }

    // Handle payment_intent.payment_failed (optional - for monitoring)
    if (event.type === "payment_intent.payment_failed") {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      logStep("Payment failed", { 
        paymentIntentId: paymentIntent.id,
        error: paymentIntent.last_payment_error?.message
      });
    }

    return new Response(JSON.stringify({ received: true }), { 
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR: Unhandled exception", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
