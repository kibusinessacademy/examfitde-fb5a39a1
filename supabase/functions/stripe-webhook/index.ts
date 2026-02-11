import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCorsPreflightRequest } from "../_shared/cors.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[STRIPE-WEBHOOK] ${step}`, details ? JSON.stringify(details) : '');
};

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

    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      logStep("ERROR: Missing stripe-signature header");
      return new Response("Missing signature", { status: 400 });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logStep("ERROR: Signature verification failed", { error: message });
      return new Response(`Webhook signature verification failed: ${message}`, { status: 400 });
    }

    logStep("Event verified", { type: event.type, id: event.id });

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      logStep("Processing checkout.session.completed", {
        sessionId: session.id,
        paymentStatus: session.payment_status,
      });

      if (session.payment_status !== "paid") {
        logStep("Skipping unpaid session");
        return new Response(JSON.stringify({ received: true, skipped: "unpaid" }), { status: 200 });
      }

      const meta = session.metadata || {};
      const userId = meta.user_id;
      const productId = meta.product_id;
      const curriculumId = meta.curriculum_id;
      const quantity = parseInt(meta.quantity || "1");
      const unitPriceCents = parseInt(meta.unit_price_cents || "0");
      const buyerIsLicensee = meta.buyer_is_licensee !== 'false';

      if (!userId || !productId || !curriculumId) {
        logStep("ERROR: Missing required metadata", { userId, productId, curriculumId });
        return new Response("Missing metadata", { status: 400 });
      }

      // IDEMPOTENCY CHECK
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

      // Calculate expiration
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + (product.access_duration_days || 365));
      const totalPriceCents = quantity * unitPriceCents;

      // Extract billing info from metadata + Stripe customer_details
      const customerDetails = session.customer_details;
      const billingEmail = meta.billing_email || customerDetails?.email || '';
      const billingName = meta.billing_name || customerDetails?.name || '';
      const billingCompany = meta.billing_company || '';
      const billingVatId = meta.billing_vat_id || '';
      let billingAddress: Record<string, string> | null = null;
      if (meta.billing_address) {
        try { billingAddress = JSON.parse(meta.billing_address); } catch { /* ignore */ }
      }
      if (!billingAddress && customerDetails?.address) {
        billingAddress = customerDetails.address as unknown as Record<string, string>;
      }

      // Retrieve Stripe invoice info if available
      let stripeInvoiceId: string | null = null;
      let stripeInvoiceUrl: string | null = null;
      if (session.invoice) {
        try {
          const invoiceId = typeof session.invoice === 'string' ? session.invoice : session.invoice.id;
          const invoice = await stripe.invoices.retrieve(invoiceId);
          stripeInvoiceId = invoice.id;
          stripeInvoiceUrl = invoice.hosted_invoice_url || null;
        } catch (e) {
          logStep("WARN: Could not retrieve invoice", { error: String(e) });
        }
      }

      const stripeCustomerId = typeof session.customer === 'string'
        ? session.customer
        : session.customer?.id || null;

      // Create license package with billing info
      const { data: licensePackage, error: packageError } = await adminClient
        .from('license_packages')
        .insert({
          buyer_user_id: userId,
          product_id: productId,
          curriculum_id: curriculumId,
          quantity,
          price_paid_cents: totalPriceCents,
          stripe_checkout_session_id: session.id,
          stripe_payment_intent_id: typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id || null,
          expires_at: expiresAt.toISOString(),
          status: 'active',
          buyer_is_licensee: buyerIsLicensee,
          billing_email: billingEmail,
          billing_name: billingName,
          billing_company: billingCompany,
          billing_vat_id: billingVatId,
          billing_address: billingAddress,
          stripe_customer_id: stripeCustomerId,
          stripe_invoice_id: stripeInvoiceId,
          stripe_invoice_url: stripeInvoiceUrl,
          delivery_status: 'pending',
        })
        .select()
        .single();

      if (packageError || !licensePackage) {
        logStep("ERROR: Failed to create package", { error: packageError });
        return new Response("Failed to create license package", { status: 500 });
      }
      logStep("License package created", { packageId: licensePackage.id, buyerIsLicensee });

      // Create seats: assign first to buyer ONLY if buyer_is_licensee
      const seatsToCreate = [];
      for (let i = 0; i < quantity; i++) {
        const assignToBuyer = buyerIsLicensee && i === 0;
        seatsToCreate.push({
          package_id: licensePackage.id,
          assigned_user_id: assignToBuyer ? userId : null,
          invite_code: assignToBuyer ? null : generateInviteCode(),
          assigned_at: assignToBuyer ? new Date().toISOString() : null,
        });
      }

      const { data: seats, error: seatsError } = await adminClient
        .from('license_seats')
        .insert(seatsToCreate)
        .select();

      if (seatsError) {
        logStep("ERROR: Failed to create seats", { error: seatsError });
      } else {
        logStep("Seats created", { count: seats?.length });
      }

      // Create entitlement for buyer if they are a licensee
      if (buyerIsLicensee && seats) {
        const buyerSeat = seats.find(s => s.assigned_user_id === userId);
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
      }

      logStep("checkout.session.completed fully processed", {
        packageId: licensePackage.id,
        userId,
        curriculumId,
        buyerIsLicensee,
        unassignedSeats: seats?.filter(s => !s.assigned_user_id).length || 0,
      });
    }

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
