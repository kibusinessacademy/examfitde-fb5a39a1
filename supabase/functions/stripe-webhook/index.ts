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

    // ========== DEDUP CHECK ==========
    const { data: existingLedger } = await adminClient
      .from('ledger_entries')
      .select('id')
      .eq('stripe_event_id', event.id)
      .limit(1);

    if (existingLedger && existingLedger.length > 0) {
      logStep("Event already processed (dedup)", { eventId: event.id });
      return new Response(JSON.stringify({ received: true, dedup: true }), { status: 200 });
    }

    // ========== checkout.session.completed ==========
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

      // IDEMPOTENCY CHECK for license_packages
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

      // Extract billing info
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

      // Retrieve Stripe invoice info
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

      const stripePaymentIntentId = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id || null;

      // ===== Create license package =====
      const { data: licensePackage, error: packageError } = await adminClient
        .from('license_packages')
        .insert({
          buyer_user_id: userId,
          product_id: productId,
          curriculum_id: curriculumId,
          quantity,
          price_paid_cents: totalPriceCents,
          stripe_checkout_session_id: session.id,
          stripe_payment_intent_id: stripePaymentIntentId,
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
      logStep("License package created", { packageId: licensePackage.id });

      // ===== Create seats =====
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

      // Entitlement for buyer
      if (buyerIsLicensee && seats) {
        const buyerSeat = seats.find(s => s.assigned_user_id === userId);
        if (buyerSeat) {
          await adminClient.from('entitlements').insert({
            user_id: userId,
            seat_id: buyerSeat.id,
            curriculum_id: curriculumId,
            has_learning_course: product.includes_learning_course,
            has_exam_trainer: product.includes_exam_trainer,
            has_ai_tutor: product.includes_ai_tutor,
            has_oral_trainer: product.includes_oral_trainer,
            valid_until: expiresAt.toISOString(),
          });
          logStep("Entitlement created for buyer");
        }
      }

      // ===== LEDGER: Create order + order_items + payment + invoice + ledger_entries =====
      const taxRate = 19.00;
      const taxCents = Math.round(totalPriceCents - totalPriceCents / (1 + taxRate / 100));
      const netCents = totalPriceCents - taxCents;

      // 1) Order
      const { data: order, error: orderError } = await adminClient
        .from('orders')
        .insert({
          buyer_user_id: userId,
          license_package_id: licensePackage.id,
          billing_name: billingName,
          billing_company: billingCompany,
          billing_email: billingEmail,
          billing_address: billingAddress,
          billing_vat_id: billingVatId,
          currency: 'eur',
          country: billingAddress?.country || 'DE',
          tax_mode: 'gross',
          subtotal_cents: netCents,
          tax_cents: taxCents,
          total_cents: totalPriceCents,
          stripe_checkout_session_id: session.id,
          stripe_payment_intent_id: stripePaymentIntentId,
          status: 'paid',
        })
        .select()
        .single();

      if (orderError || !order) {
        logStep("ERROR: Failed to create order", { error: orderError });
      } else {
        logStep("Order created", { orderId: order.id });

        // 2) Order items
        await adminClient.from('order_items').insert({
          order_id: order.id,
          product_id: productId,
          description: `${product.name} (${quantity}x)`,
          quantity,
          unit_amount_net_cents: Math.round(unitPriceCents / (1 + taxRate / 100)),
          unit_amount_gross_cents: unitPriceCents,
          tax_rate: taxRate,
          tax_amount_cents: Math.round(unitPriceCents - unitPriceCents / (1 + taxRate / 100)) * quantity,
        });

        // 3) Payment
        let feeCents = 0;
        // Try to get Stripe fee from balance transaction
        if (stripePaymentIntentId) {
          try {
            const pi = await stripe.paymentIntents.retrieve(stripePaymentIntentId, {
              expand: ['latest_charge.balance_transaction'],
            });
            const charge = pi.latest_charge as Stripe.Charge;
            const bt = charge?.balance_transaction as Stripe.BalanceTransaction;
            feeCents = bt?.fee || 0;
          } catch (e) {
            logStep("WARN: Could not get fee", { error: String(e) });
          }
        }

        const { data: payment } = await adminClient
          .from('payments')
          .insert({
            order_id: order.id,
            stripe_payment_intent_id: stripePaymentIntentId,
            stripe_charge_id: null,
            amount_cents: totalPriceCents,
            fee_cents: feeCents,
            net_cents: totalPriceCents - feeCents,
            currency: 'eur',
            payment_status: 'succeeded',
            paid_at: new Date().toISOString(),
            stripe_event_id: event.id,
          })
          .select()
          .single();

        logStep("Payment recorded", { paymentId: payment?.id, feeCents });

        // 4) Invoice
        const { data: invoiceNumResult } = await adminClient.rpc('generate_invoice_number');
        const invoiceNumber = invoiceNumResult || `EF-${Date.now()}`;

        const { data: dbInvoice } = await adminClient
          .from('invoices')
          .insert({
            order_id: order.id,
            invoice_number: invoiceNumber,
            issue_date: new Date().toISOString().slice(0, 10),
            pdf_url: stripeInvoiceUrl,
            stripe_invoice_id: stripeInvoiceId,
            status: 'paid',
            total_net_cents: netCents,
            total_tax_cents: taxCents,
            total_gross_cents: totalPriceCents,
            tax_rate: taxRate,
          })
          .select()
          .single();

        logStep("Invoice created", { invoiceNumber });

        // 5) Ledger entries (SSOT)
        const ledgerEntries = [
          {
            event_type: 'sale',
            order_id: order.id,
            payment_id: payment?.id,
            invoice_id: dbInvoice?.id,
            account: 'revenue',
            amount_cents: totalPriceCents,
            currency: 'eur',
            tax_rate: taxRate,
            country: billingAddress?.country || 'DE',
            description: `Sale: ${product.name} x${quantity}`,
            stripe_event_id: event.id,
          },
          {
            event_type: 'sale',
            order_id: order.id,
            payment_id: payment?.id,
            invoice_id: dbInvoice?.id,
            account: 'tax_payable',
            amount_cents: taxCents,
            currency: 'eur',
            tax_rate: taxRate,
            country: billingAddress?.country || 'DE',
            description: `USt ${taxRate}%: ${product.name}`,
            stripe_event_id: event.id + '_tax',
          },
        ];

        if (feeCents > 0) {
          ledgerEntries.push({
            event_type: 'fee',
            order_id: order.id,
            payment_id: payment?.id,
            invoice_id: null as unknown as string,
            account: 'stripe_fees',
            amount_cents: -feeCents,
            currency: 'eur',
            tax_rate: 0,
            country: 'DE',
            description: `Stripe fee for PI ${stripePaymentIntentId}`,
            stripe_event_id: event.id + '_fee',
          });
        }

        await adminClient.from('ledger_entries').insert(ledgerEntries);
        logStep("Ledger entries written", { count: ledgerEntries.length });
      }

      logStep("checkout.session.completed fully processed", {
        packageId: licensePackage.id,
        orderId: order?.id,
      });
    }

    // ========== charge.refunded ==========
    if (event.type === "charge.refunded") {
      const charge = event.data.object as Stripe.Charge;
      const refundAmount = charge.amount_refunded;
      const paymentIntentId = typeof charge.payment_intent === 'string'
        ? charge.payment_intent : charge.payment_intent?.id;

      logStep("Processing charge.refunded", { chargeId: charge.id, refundAmount, paymentIntentId });

      // Find order via payment_intent
      const { data: existingPayment } = await adminClient
        .from('payments')
        .select('id, order_id, amount_cents')
        .eq('stripe_payment_intent_id', paymentIntentId)
        .maybeSingle();

      if (existingPayment) {
        const isFullRefund = refundAmount >= existingPayment.amount_cents;

        // Update payment status
        await adminClient.from('payments').update({
          payment_status: isFullRefund ? 'refunded' : 'partial_refund',
        }).eq('id', existingPayment.id);

        // Update order status
        await adminClient.from('orders').update({
          status: isFullRefund ? 'refunded' : 'partially_refunded',
        }).eq('id', existingPayment.order_id);

        // Calculate tax portion of refund
        const taxRate = 19.00;
        const refundTax = Math.round(refundAmount - refundAmount / (1 + taxRate / 100));

        // Write refund ledger entries (negative)
        await adminClient.from('ledger_entries').insert([
          {
            event_type: 'refund',
            order_id: existingPayment.order_id,
            payment_id: existingPayment.id,
            account: 'refunds',
            amount_cents: -refundAmount,
            currency: 'eur',
            tax_rate: taxRate,
            description: `Refund: ${charge.id}`,
            stripe_event_id: event.id,
          },
          {
            event_type: 'refund',
            order_id: existingPayment.order_id,
            payment_id: existingPayment.id,
            account: 'revenue',
            amount_cents: -refundAmount,
            currency: 'eur',
            tax_rate: taxRate,
            description: `Revenue reversal: ${charge.id}`,
            stripe_event_id: event.id + '_rev',
          },
          {
            event_type: 'refund',
            order_id: existingPayment.order_id,
            payment_id: existingPayment.id,
            account: 'tax_payable',
            amount_cents: -refundTax,
            currency: 'eur',
            tax_rate: taxRate,
            description: `Tax reversal: ${charge.id}`,
            stripe_event_id: event.id + '_tax',
          },
        ]);

        logStep("Refund ledger entries written", { refundAmount, isFullRefund });
      } else {
        logStep("WARN: No payment found for refund PI", { paymentIntentId });
      }
    }

    // ========== charge.dispute.created ==========
    if (event.type === "charge.dispute.created") {
      const dispute = event.data.object as Stripe.Dispute;
      const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
      const disputeAmount = dispute.amount;

      logStep("Processing charge.dispute.created", { disputeId: dispute.id, chargeId, disputeAmount });

      // Find order via charge → payment_intent
      if (chargeId) {
        try {
          const chargeObj = await stripe.charges.retrieve(chargeId);
          const piId = typeof chargeObj.payment_intent === 'string'
            ? chargeObj.payment_intent : chargeObj.payment_intent?.id;

          const { data: existingPayment } = await adminClient
            .from('payments')
            .select('id, order_id')
            .eq('stripe_payment_intent_id', piId)
            .maybeSingle();

          if (existingPayment) {
            await adminClient.from('orders').update({ status: 'disputed' }).eq('id', existingPayment.order_id);
            await adminClient.from('payments').update({ payment_status: 'chargeback' }).eq('id', existingPayment.id);

            await adminClient.from('ledger_entries').insert({
              event_type: 'chargeback',
              order_id: existingPayment.order_id,
              payment_id: existingPayment.id,
              account: 'revenue',
              amount_cents: -disputeAmount,
              currency: 'eur',
              description: `Dispute: ${dispute.id}`,
              stripe_event_id: event.id,
            });

            logStep("Dispute ledger entry written", { disputeAmount });
          }
        } catch (e) {
          logStep("WARN: Could not process dispute", { error: String(e) });
        }
      }
    }

    // ========== payment_intent.payment_failed ==========
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
