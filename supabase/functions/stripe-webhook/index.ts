// Deno.serve is built-in
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handleCorsPreflightRequest } from "../_shared/cors.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  // Structured single-line JSON for easy log filtering (handler branch, event type, db effects)
  const payload = { tag: 'stripe-webhook', step, ts: new Date().toISOString(), ...(details || {}) };
  console.log(JSON.stringify(payload));
};

/**
 * Stripe-Event-Payload-Redaktion (PII / Payment-Daten maskieren) bevor in
 * stripe_event_log gespeichert wird. SSOT für „kein Klartext im Audit".
 *
 * Maskiert rekursiv: email, name, address-Felder, phone, ip_address,
 * card-Details (number/last4/fingerprint), banking-Felder.
 * Behält strukturelle Felder (id, status, amount, currency, metadata.keys)
 * für Debugging.
 */
const PII_KEYS = new Set([
  'email', 'customer_email', 'receipt_email', 'name', 'customer_name',
  'phone', 'phone_number', 'ip_address', 'client_ip',
  'line1', 'line2', 'address_line1', 'address_line2',
  'address_zip', 'postal_code', 'city', 'address_city', 'state', 'address_state',
  'number', 'last4', 'fingerprint', 'iin', 'bank_name',
  'routing_number', 'account_number', 'sort_code', 'iban', 'bic',
  'tax_id', 'tax_id_value', 'vat_number',
]);
function maskString(v: unknown): string {
  if (typeof v !== 'string' || v.length === 0) return '***';
  if (v.length <= 2) return '**';
  return v[0] + '***' + v[v.length - 1];
}
function redactStripeEventPayload(input: any, depth = 0): any {
  if (depth > 12 || input === null || input === undefined) return input;
  if (Array.isArray(input)) return input.map((x) => redactStripeEventPayload(x, depth + 1));
  if (typeof input !== 'object') return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (PII_KEYS.has(k)) {
      out[k] = v === null ? null : (typeof v === 'object' ? '[redacted-object]' : maskString(v));
    } else {
      out[k] = redactStripeEventPayload(v, depth + 1);
    }
  }
  return out;
}


function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * SSOT funnel-event emitter for stripe-webhook.
 * - kanonischer event_type 'checkout_complete' (NICHT 'checkout_completed')
 * - resolves package_id + persona aus product_id (über curriculum_id)
 * - schreibt package_id/persona/source_page als first-class metadata-Keys,
 *   damit v_funnel_integrity_check tracking_completeness korrekt zählt.
 *
 * Idempotent durch session_id im metadata + upstream stripe_event_log.
 */
async function emitCheckoutCompleteEvent(
  adminClient: any,
  args: {
    user_id?: string | null;
    contact_id?: string | null;
    curriculum_id?: string | null;
    product_id?: string | null;
    session_id: string;
    flow: string;
    extra?: Record<string, unknown>;
  },
) {
  let packageId: string | null = null;
  let persona: string | null = null;
  let curriculumId = args.curriculum_id ?? null;

  try {
    if (args.product_id && !curriculumId) {
      const { data: prod } = await adminClient
        .from('products')
        .select('curriculum_id')
        .eq('id', args.product_id)
        .maybeSingle();
      curriculumId = prod?.curriculum_id ?? null;
    }
    if (curriculumId) {
      const { data: pkg } = await adminClient
        .from('course_packages')
        .select('id, persona_profile')
        .eq('curriculum_id', curriculumId)
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      packageId = pkg?.id ?? null;
      persona = pkg?.persona_profile
        ? String(pkg.persona_profile).toLowerCase().split('_')[0]
        : null;
    }
  } catch (resolveErr) {
    console.warn('[stripe-webhook] package_id resolve failed', resolveErr);
  }

  await adminClient.from('conversion_events').insert({
    user_id: args.user_id ?? null,
    contact_id: args.contact_id ?? null,
    curriculum_id: curriculumId,
    event_type: 'checkout_complete',
    metadata: {
      ...(args.extra ?? {}),
      product_id: args.product_id ?? null,
      package_id: packageId,
      persona,
      source_page: '/checkout/success',
      stripe_session_id: args.session_id,
      session_id: args.session_id,
      flow: args.flow,
    },
  });
}

/**
 * SSOT: Emits a failed/cancelled checkout funnel event so /admin/observatory
 * can see exactly where revenue is lost. Best-effort — never throws.
 */
async function emitCheckoutFailureEvent(
  adminClient: any,
  args: {
    event_type: 'checkout_cancelled' | 'payment_failed';
    session?: Stripe.Checkout.Session | null;
    payment_intent?: Stripe.PaymentIntent | null;
    failure_reason?: string | null;
    failure_code?: string | null;
  },
) {
  try {
    const meta = (args.session?.metadata ?? args.payment_intent?.metadata ?? {}) as Record<string, string>;
    let packageId: string | null = meta.package_id || meta.packageId || null;
    let persona: string | null = (meta.persona || meta.persona_type || null) as string | null;
    let productId: string | null = meta.product_id || meta.productId || null;
    let curriculumId: string | null = meta.curriculum_id || meta.curriculumId || null;
    const orderId: string | null = meta.order_id || meta.orderId || null;

    // Resolve package_id from product_id → curriculum → published package (best effort)
    if (!packageId && productId) {
      const { data: prod } = await adminClient
        .from('products')
        .select('curriculum_id')
        .eq('id', productId)
        .maybeSingle();
      curriculumId = curriculumId ?? prod?.curriculum_id ?? null;
    }
    if (!packageId && curriculumId) {
      const { data: pkg } = await adminClient
        .from('course_packages')
        .select('id, persona_profile')
        .eq('curriculum_id', curriculumId)
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      packageId = pkg?.id ?? null;
      if (!persona && pkg?.persona_profile) {
        persona = String(pkg.persona_profile).toLowerCase().split('_')[0];
      }
    }

    const sessionId = args.session?.id ?? null;
    const piId = args.payment_intent?.id
      ?? (typeof args.session?.payment_intent === 'string' ? args.session.payment_intent : args.session?.payment_intent?.id)
      ?? null;

    await adminClient.from('conversion_events').insert({
      user_id: null,
      contact_id: null,
      curriculum_id: curriculumId,
      event_type: args.event_type,
      page_path: '/checkout/failure',
      metadata: {
        source_page: '/checkout/failure',
        package_id: packageId,
        persona,
        product_id: productId,
        order_id: orderId,
        stripe_session_id: sessionId,
        stripe_payment_intent_id: piId,
        failure_reason: args.failure_reason ?? null,
        failure_code: args.failure_code ?? null,
        amount_total: args.session?.amount_total ?? args.payment_intent?.amount ?? null,
        currency: args.session?.currency ?? args.payment_intent?.currency ?? null,
      },
    });
  } catch (e) {
    console.warn('[stripe-webhook] emitCheckoutFailureEvent failed', e);
  }
}

/**
 * SSOT B2C order writer — replaces direct entitlement inserts.
 * Inserts orders (status='paid') + order_items. The DB trigger
 * trg_orders_paid_grant fires process_order_paid_fulfillment which
 * creates: invoice + invoice_items + payment + ledger_entries +
 * learner_course_grant + entitlement (Loop C bridge).
 *
 * Idempotent via UNIQUE on stripe_checkout_session_id.
 * Stripe fee + PDF URL are passed through orders columns.
 */
async function ensureB2cOrderForSession(
  adminClient: any,
  stripe: Stripe,
  args: {
    session: Stripe.Checkout.Session;
    user_id: string;
    product_id: string;
    description: string;
    quantity?: number;
  },
): Promise<{ orderId: string | null; created: boolean }> {
  const session = args.session;
  const quantity = args.quantity ?? 1;

  // idempotency layer 1: existing order by session id
  const { data: existingBySession } = await adminClient
    .from('orders')
    .select('id')
    .eq('stripe_checkout_session_id', session.id)
    .maybeSingle();
  if (existingBySession?.id) {
    return { orderId: existingBySession.id, created: false };
  }

  // idempotency layer 2: existing order by payment_intent (covers retries / flows without stable session id)
  const piEarly =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? null;
  if (piEarly) {
    const { data: existingByPI } = await adminClient
      .from('orders')
      .select('id')
      .eq('stripe_payment_intent_id', piEarly)
      .maybeSingle();
    if (existingByPI?.id) {
      return { orderId: existingByPI.id, created: false };
    }
  }

  const totalCents = session.amount_total ?? 0;
  const taxRate = 19.0;
  const subtotalCents = Math.round(totalCents / (1 + taxRate / 100));
  const taxCents = totalCents - subtotalCents;
  const unitGross = quantity > 0 ? Math.round(totalCents / quantity) : totalCents;
  const unitNet = quantity > 0 ? Math.round(subtotalCents / quantity) : subtotalCents;
  const unitTax = unitGross - unitNet;

  // Stripe fee + invoice metadata
  let feeCents = 0;
  let stripeInvoiceId: string | null = null;
  let stripeInvoicePdfUrl: string | null = null;
  const stripePaymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? null;
  const stripeCustomerId =
    typeof session.customer === 'string'
      ? session.customer
      : session.customer?.id ?? null;

  if (stripePaymentIntentId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(stripePaymentIntentId, {
        expand: ['latest_charge.balance_transaction'],
      });
      const charge = pi.latest_charge as Stripe.Charge | undefined;
      const bt = charge?.balance_transaction as Stripe.BalanceTransaction | undefined;
      feeCents = bt?.fee ?? 0;
    } catch (e) {
      console.warn('[ensureB2cOrderForSession] fee fetch failed', String(e));
    }
  }
  if (session.invoice) {
    try {
      const invId =
        typeof session.invoice === 'string' ? session.invoice : session.invoice.id;
      const inv = await stripe.invoices.retrieve(invId);
      stripeInvoiceId = inv.id;
      stripeInvoicePdfUrl = inv.invoice_pdf || inv.hosted_invoice_url || null;
    } catch (e) {
      console.warn('[ensureB2cOrderForSession] invoice fetch failed', String(e));
    }
  }

  const billing = session.customer_details;
  const billingAddress = (billing?.address as unknown as Record<string, string> | null) ?? null;

  // INSERT order with status='pending' first to avoid trigger firing before order_items exist
  const { data: order, error: orderErr } = await adminClient
    .from('orders')
    .insert({
      buyer_user_id: args.user_id,
      billing_email: billing?.email ?? null,
      billing_name: billing?.name ?? null,
      billing_address: billingAddress,
      currency: (session.currency || 'eur').toLowerCase(),
      country: billingAddress?.country ?? 'DE',
      tax_mode: 'gross',
      subtotal_cents: subtotalCents,
      tax_cents: taxCents,
      total_cents: totalCents,
      status: 'pending',
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: stripePaymentIntentId,
      stripe_fee_cents: feeCents,
      stripe_invoice_id: stripeInvoiceId,
      stripe_invoice_pdf_url: stripeInvoicePdfUrl,
      stripe_customer_id: stripeCustomerId,
    })
    .select('id')
    .single();
  if (orderErr || !order) {
    console.error('[ensureB2cOrderForSession] order insert failed', orderErr);
    return { orderId: null, created: false };
  }

  await adminClient.from('order_items').insert({
    order_id: order.id,
    product_id: args.product_id,
    description: args.description,
    quantity,
    unit_amount_net_cents: unitNet,
    unit_amount_gross_cents: unitGross,
    tax_rate: taxRate,
    tax_amount_cents: unitTax * quantity,
  });

  // flip status to 'paid' → triggers process_order_paid_fulfillment
  await adminClient.from('orders').update({ status: 'paid' }).eq('id', order.id);
  return { orderId: order.id, created: true };
}


Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  // Hoisted for status-tracking from the outer catch block
  let _trackedEventId: string | null = null;

  try {
    logStep("Webhook received");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    const webhookTestSecret = Deno.env.get("STRIPE_WEBHOOK_TEST_SECRET"); // optional, only set in non-prod for smoke
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
    let signatureSource: 'live' | 'test' = 'live';
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
    } catch (errLive) {
      // If a test secret is configured (smoke/staging only), try it as fallback
      if (webhookTestSecret) {
        try {
          event = await stripe.webhooks.constructEventAsync(body, signature, webhookTestSecret);
          signatureSource = 'test';
          logStep("Signature verified via TEST secret", { hint: "smoke/staging only" });
        } catch (errTest) {
          const message = errTest instanceof Error ? errTest.message : "Unknown error";
          logStep("ERROR: Signature verification failed (live + test)", { error: message });
          return new Response(`Webhook signature verification failed: ${message}`, { status: 400 });
        }
      } else {
        const message = errLive instanceof Error ? errLive.message : "Unknown error";
        logStep("ERROR: Signature verification failed", { error: message });
        return new Response(`Webhook signature verification failed: ${message}`, { status: 400 });
      }
    }

    logStep("Event verified", { event_type: event.type, event_id: event.id, livemode: event.livemode, signature_source: signatureSource });

    // ========== IDEMPOTENCY (early dedup, before any DB side-effects) ==========
    // 1) stripe_event_log already terminal? → 200 dedup, do not reset to 'received'
    const { data: existingLog } = await adminClient
      .from("stripe_event_log")
      .select("process_status")
      .eq("stripe_event_id", event.id)
      .maybeSingle();
    if (existingLog && ['ok', 'error', 'skipped'].includes(existingLog.process_status)) {
      logStep("Event already finalized (dedup via stripe_event_log)", { eventId: event.id, prior_status: existingLog.process_status });
      return new Response(JSON.stringify({ received: true, dedup: true, prior_status: existingLog.process_status }), { status: 200 });
    }

    // 2) Council 8: Log raw Stripe event for finance reconciliation — PII-redacted payload
    try {
      const redactedPayload = redactStripeEventPayload(event);
      await adminClient.from("stripe_event_log").upsert({
        stripe_event_id: event.id,
        event_type: event.type,
        livemode: event.livemode ?? false,
        payload: redactedPayload,
        process_status: 'received',
      }, { onConflict: "stripe_event_id" });
      _trackedEventId = event.id;
      logStep("Stripe event logged to stripe_event_log (redacted)");
    } catch (e: any) {
      logStep("WARN: Could not log to stripe_event_log", { error: String(e) });
    }

    // 3) Legacy dedup on ledger_entries (handler-level)
    const { data: existingLedger } = await adminClient
      .from('ledger_entries')
      .select('id')
      .eq('stripe_event_id', event.id)
      .limit(1);

    if (existingLedger && existingLedger.length > 0) {
      logStep("Event already processed (dedup via ledger_entries)", { eventId: event.id });
      return new Response(JSON.stringify({ received: true, dedup: true }), { status: 200 });
    }


    // ========== checkout.session.completed (ExamFit Store) ==========
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

      // ── Route: ExamFit@work purchases are handled below ──
      const _brandLower = String(meta.brand || '').toLowerCase();
      const _isWorkBrand = _brandLower.includes('examfit@work') || _brandLower.includes('examfitwork') || _brandLower === 'berufski';
      if (_isWorkBrand) {
        logStep("ExamFit@work brand detected — skipping ExamFit handler, will process below");
      } else if (meta.checkout_source === 'create-b2b-checkout' && meta.flow === 'b2b_subscription') {
        // ── B2B Subscription checkout fulfillment ──
        try {
          const userId = meta.user_id;
          const category = meta.category;
          const seats = parseInt(meta.seats || '0');
          const orgName = meta.org_name || 'Organisation';
          const subscriptionId = (session as any).subscription?.toString?.() || (session as any).subscription;

          if (!userId || !category || !seats) {
            logStep("SKIP b2b_subscription fulfillment (missing metadata)", { meta });
          } else {
            // Resolve or create org
            let orgId = meta.org_id || null;

            if (!orgId) {
              const { data: existingMembership } = await adminClient
                .from('org_memberships')
                .select('org_id')
                .eq('user_id', userId)
                .eq('role', 'owner')
                .eq('status', 'active')
                .limit(1)
                .maybeSingle();

              if (existingMembership) {
                orgId = existingMembership.org_id;
              } else {
                const { data: newOrg } = await adminClient
                  .from('organizations')
                  .insert({ name: orgName, org_type: 'company' })
                  .select('id')
                  .single();
                if (newOrg) {
                  orgId = newOrg.id;
                  await adminClient.from('org_memberships').insert({
                    org_id: orgId,
                    user_id: userId,
                    role: 'owner',
                    status: 'active',
                  }); // idempotent via unique constraint
                  logStep("Organization created for B2B sub", { orgId, orgName });
                }
              }
            }

            if (orgId && subscriptionId) {
              // Idempotency check
              const { data: existingLic } = await adminClient
                .from('org_licenses')
                .select('id')
                .eq('stripe_subscription_id', subscriptionId)
                .maybeSingle();

              if (existingLic) {
                logStep("B2B license already exists (idempotent)", { id: existingLic.id });
              } else {
                // Retrieve subscription details from Stripe
                const stripeKey2 = Deno.env.get("STRIPE_SECRET_KEY")!;
                const stripe2 = new Stripe(stripeKey2, { apiVersion: "2023-10-16" });
                const sub = await stripe2.subscriptions.retrieve(subscriptionId);

                const periodEnd = sub.current_period_end
                  ? new Date(sub.current_period_end * 1000).toISOString()
                  : null;
                const periodStart = sub.current_period_start
                  ? new Date(sub.current_period_start * 1000).toISOString()
                  : null;

                const { data: newLicense } = await adminClient
                  .from('org_licenses')
                  .insert({
                    org_id: orgId,
                    product_id: '00000000-0000-0000-0000-000000000000', // placeholder, category is the key
                    seat_count: seats,
                    total_seats: seats,
                    seats_used: 0,
                    starts_at: new Date().toISOString(),
                    status: 'active',
                    category,
                    stripe_subscription_id: subscriptionId,
                    stripe_customer_id: (session as any).customer?.toString?.() || null,
                    stripe_price_id: sub.items?.data?.[0]?.price?.id ?? null,
                    current_period_start: periodStart,
                    current_period_end: periodEnd,
                    cancel_at_period_end: sub.cancel_at_period_end ?? false,
                  })
                  .select('id')
                  .single();

                if (newLicense) {
                  logStep("B2B subscription license created", { licenseId: newLicense.id, category, seats });

                  // Auto-assign first seat to buyer
                  await adminClient.rpc('assign_org_license_seat', {
                    p_license_id: newLicense.id,
                    p_user_id: userId,
                    p_assigned_by: userId,
                  });
                  logStep("Buyer auto-assigned first seat");
                }
              }
            }

            // Track conversion (SSOT — kanonisch checkout_complete + package_id)
            await emitCheckoutCompleteEvent(adminClient, {
              user_id: userId,
              session_id: session.id,
              flow: 'b2b_subscription',
              extra: {
                category,
                seats,
                subscription_id: subscriptionId,
                amount_total: session.amount_total,
              },
            });
          }
        } catch (b2bSubErr) {
          logStep("ERROR: B2B subscription fulfillment failed", { error: String(b2bSubErr) });
        }
      } else if (meta.checkout_source === 'create-payment') {
        // ── B2C/B2B Product-Checkout fulfillment (SSOT via orders → trigger) ──
        try {
          const userId = meta.user_id;
          const rawProductId = meta.product_id;
          const flow = meta.flow; // 'paywall_variant' | 'pricing_plan'

          if (!userId || !rawProductId) {
            logStep("SKIP create-payment fulfillment (missing user_id/product_id)", { meta });
          } else {
            // ── product_id Resolver+Validator (Loop C v2 Bug 1 Schutz) ──
            // Validiert gegen products-Tabelle. Falls meta.product_id nicht in
            // products existiert, versuchen via meta.curriculum_id zu resolven.
            let productId: string | null = null;
            let productTitle: string | null = null;

            const { data: byId } = await adminClient
              .from('products')
              .select('id, title')
              .eq('id', rawProductId)
              .maybeSingle();
            if (byId?.id) {
              productId = byId.id;
              productTitle = byId.title ?? null;
            } else if (meta.curriculum_id) {
              const { data: byCurr } = await adminClient
                .from('products')
                .select('id, title')
                .eq('curriculum_id', meta.curriculum_id)
                .in('status', ['active', 'published'])
                .order('updated_at', { ascending: false })
                .limit(1)
                .maybeSingle();
              if (byCurr?.id) {
                productId = byCurr.id;
                productTitle = byCurr.title ?? null;
                logStep("product_id resolved via curriculum_id", { rawProductId, resolvedProductId: productId });
              }
            }

            if (!productId) {
              logStep("ERROR: product_id konnte nicht in products-Tabelle resolved werden", {
                rawProductId,
                curriculumId: meta.curriculum_id,
              });
              return new Response(JSON.stringify({ received: true, error: "unknown_product_id" }), { status: 200 });
            }

            const audienceType = (meta.audience_type || 'b2c').toLowerCase();
            const seatCount = parseInt(meta.seat_count || '1');
            const isB2cFlow =
              flow === 'paywall_variant' ||
              (flow === 'pricing_plan' && (audienceType === 'b2c' || seatCount <= 1));

            if (isB2cFlow) {
              // ── B2C SSOT: Order anlegen → Trigger erzeugt invoice/payment/ledger/grant/entitlement ──
              logStep("Fulfilling B2C purchase via SSOT order pipeline", {
                userId,
                productId,
                flow,
                audienceType,
              });

              const { orderId, created } = await ensureB2cOrderForSession(adminClient, stripe, {
                session,
                user_id: userId,
                product_id: productId,
                description: productTitle ?? `Produkt ${productId}`,
                quantity: 1,
              });

              if (!orderId) {
                logStep("ERROR: ensureB2cOrderForSession lieferte keine orderId");
              } else {
                logStep(created ? "B2C order created (SSOT)" : "B2C order existed (idempotent)", { orderId });
              }

              // Experiment-Conversion bleibt hier (nicht über Trigger)
              if (meta.experiment_key && meta.variant_key) {
                try {
                  await adminClient.rpc('record_experiment_conversion' as any, {
                    p_user_id: userId,
                    p_experiment_key: meta.experiment_key,
                    p_variant_key: meta.variant_key,
                    p_conversion_value_cents: parseInt(meta.price_cents || session.amount_total?.toString() || '0'),
                  });
                  logStep("Experiment conversion recorded");
                } catch (convErr) {
                  logStep("WARN: Could not record experiment conversion", { error: String(convErr) });
                }
              }

              await emitCheckoutCompleteEvent(adminClient, {
                user_id: userId,
                product_id: productId,
                session_id: session.id,
                flow: flow === 'paywall_variant' ? 'paywall_variant' : 'pricing_plan_b2c',
                extra: {
                  order_id: orderId,
                  experiment_key: meta.experiment_key ?? null,
                  variant_key: meta.variant_key ?? null,
                  plan_key: meta.plan_key ?? null,
                  amount_total: session.amount_total,
                },
              });

            } else if (flow === 'pricing_plan') {
              // ── B2B pricing_plan: weiterhin org_license-Pfad (Sprint-2-Refactor) ──
              const durationDays = parseInt(meta.duration_days || '365');
              const validUntil = new Date();
              validUntil.setDate(validUntil.getDate() + durationDays);
              logStep("Fulfilling B2B pricing_plan purchase (legacy org_license pfad)", {
                userId,
                productId,
                planKey: meta.plan_key,
              });
              // Idempotency: check existing license for this session
              const { data: existingLic } = await adminClient
                .from('org_licenses')
                .select('id')
                .eq('source_ref', session.id)
                .maybeSingle();

              if (existingLic) {
                logStep("Org license already exists (idempotent)", { id: existingLic.id });
              } else {
                let orgId: string | null = null;
                const orgName = meta.org_name || 'Organisation';

                const { data: existingMembership } = await adminClient
                  .from('org_memberships')
                  .select('org_id')
                  .eq('user_id', userId)
                  .eq('role', 'owner')
                  .eq('status', 'active')
                  .limit(1)
                  .maybeSingle();

                if (existingMembership) {
                  orgId = existingMembership.org_id;
                  logStep("Using existing org", { orgId });
                } else {
                  const { data: newOrg } = await adminClient
                    .from('organizations')
                    .insert({ name: orgName, org_type: 'company' })
                    .select('id')
                    .single();
                  if (newOrg) {
                    orgId = newOrg.id;
                    await adminClient.from('org_memberships').insert({
                      org_id: orgId,
                      user_id: userId,
                      role: 'owner',
                      status: 'active',
                    });
                    logStep("Organization created", { orgId, orgName });
                  }
                }

                if (orgId) {
                  const { data: newLicense } = await adminClient
                    .from('org_licenses')
                    .insert({
                      org_id: orgId,
                      product_id: productId,
                      seat_count: seatCount,
                      seats_used: 0,
                      starts_at: new Date().toISOString(),
                      ends_at: validUntil.toISOString(),
                      status: 'active',
                      source_type: 'stripe',
                      source_ref: session.id,
                    })
                    .select('id')
                    .single();

                  if (newLicense) {
                    logStep("Org license created", { licenseId: newLicense.id, seatCount });
                    await adminClient.from('org_license_seats').insert({
                      license_id: newLicense.id,
                      user_id: userId,
                      claimed_at: new Date().toISOString(),
                    });
                    logStep("Buyer auto-assigned first seat");
                  }
                }
              }

              await emitCheckoutCompleteEvent(adminClient, {
                user_id: userId,
                product_id: productId,
                session_id: session.id,
                flow,
                extra: {
                  plan_key: meta.plan_key,
                  seat_count: meta.seat_count,
                  audience_type: meta.audience_type,
                  amount_total: session.amount_total,
                },
              });
            } // end else if (flow === 'pricing_plan')

            // ── PARTNER COMMISSION: resolve attribution & create commission ──
            try {
              const amountTotalCents = session.amount_total || 0;
              const grossEur = amountTotalCents / 100;
              const netEur = grossEur; // TODO: subtract VAT if needed

              const { data: attrRows } = await adminClient.rpc('fn_resolve_partner_attribution', {
                _user_id: userId,
                _visitor_id: null,
                _org_id: (flow === 'pricing_plan' && meta.audience_type === 'b2b') ? null : null,
                _consume: false,
              });

              if (attrRows && attrRows.length > 0) {
                const attr = attrRows[0];
                logStep("Partner attribution resolved", {
                  attribution_id: attr.attribution_id,
                  partner_id: attr.partner_id,
                  partner_type: attr.partner_type,
                  commission_mode: attr.commission_mode,
                  commission_rate: attr.commission_rate,
                });

                const sourceRef = `checkout:${session.id}`;
                const { data: commissionId } = await adminClient.rpc('fn_create_partner_commission', {
                  _source_ref: sourceRef,
                  _partner_id: attr.partner_id,
                  _attribution_id: attr.attribution_id,
                  _product_id: productId,
                  _order_ref: session.id,
                  _buyer_user_id: userId,
                  _org_id: null,
                  _gross_amount_eur: grossEur,
                  _net_amount_eur: netEur,
                  _commission_reason: `${flow} checkout`,
                });
                logStep("Partner commission created", { commissionId, sourceRef });
              } else {
                logStep("No partner attribution found for buyer", { userId });
              }
            } catch (partnerErr) {
              logStep("WARN: Partner commission creation failed (non-blocking)", { error: String(partnerErr) });
            }
          } // end if (userId && rawProductId)
        } catch (newFlowErr) {
          logStep("ERROR: create-payment fulfillment failed", { error: String(newFlowErr) });
        }
      } else {
        // ── ExamFit Store handler (legacy) ──
        try {
          const userId = meta.user_id;
          const productId = meta.product_id;
          const curriculumId = meta.curriculum_id;
          const quantity = parseInt(meta.quantity || "1");
          const unitPriceCents = parseInt(meta.unit_price_cents || "0");
          const buyerIsLicensee = meta.buyer_is_licensee !== 'false';

          const hasExamFitMeta = !!userId && !!productId && !!curriculumId;

          if (!hasExamFitMeta) {
            logStep("SKIP ExamFit checkout.session.completed (metadata missing)", {
              sessionId: session.id,
              metaKeys: Object.keys(meta || {}),
            });
          } else {

        // IDEMPOTENCY CHECK for license_packages
        const { data: existingPackage } = await adminClient
          .from('license_packages')
          .select('id')
          .eq('stripe_checkout_session_id', session.id)
          .maybeSingle();

        if (existingPackage) {
          logStep("Package already exists - idempotent skip", { packageId: existingPackage.id });
        } else {

        // Get product info
        const { data: product, error: productError } = await adminClient
          .from('store_products')
          .select('*')
          .eq('id', productId)
          .single();

        if (productError || !product) {
          logStep("ERROR: Product not found", { productId, error: productError });
        } else {

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
        } else {
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

          // 4b) Invoice items mirror (Loop B SSOT for /app/rechnungen)
          if (dbInvoice?.id) {
            const itemNet = Math.round(unitPriceCents / (1 + taxRate / 100));
            const itemTax = unitPriceCents - itemNet;
            const { error: itemErr } = await adminClient
              .from('invoice_items')
              .upsert({
                invoice_id: dbInvoice.id,
                order_id: order.id,
                product_id: productId,
                description: `${product.name} (${quantity}x)`,
                quantity,
                unit_price_cents: unitPriceCents,
                tax_rate: taxRate,
                tax_amount_cents: itemTax * quantity,
                total_cents: unitPriceCents * quantity,
              }, { onConflict: 'invoice_id,product_id', ignoreDuplicates: false });
            if (itemErr) logStep("WARN: invoice_items upsert failed", { error: String(itemErr) });
            else logStep("Invoice items mirrored", { invoiceId: dbInvoice.id });
          }

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

        // ===== FUNNEL: conversion_event + crm_contact upsert (Loop A) =====
        try {
          // 1) crm_contact upsert from billing data
          let contactIdForEvent: string | null = null;
          if (billingEmail) {
            const { data: existingContact } = await adminClient
              .from('crm_contacts')
              .select('id')
              .ilike('email', billingEmail)
              .maybeSingle();

            if (existingContact?.id) {
              contactIdForEvent = existingContact.id;
              await adminClient
                .from('crm_contacts')
                .update({
                  lifecycle_stage: 'customer',
                  user_id: userId,
                  company: billingCompany || null,
                  last_contacted_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                })
                .eq('id', existingContact.id);
            } else {
              const { data: newContact } = await adminClient
                .from('crm_contacts')
                .insert({
                  email: billingEmail.toLowerCase(),
                  first_name: (billingName || '').split(' ')[0] || null,
                  last_name: (billingName || '').split(' ').slice(1).join(' ') || null,
                  company: billingCompany || null,
                  lifecycle_stage: 'customer',
                  lead_source: 'stripe_checkout',
                  user_id: userId,
                  last_contacted_at: new Date().toISOString(),
                })
                .select('id')
                .single();
              contactIdForEvent = newContact?.id ?? null;
            }
          }

          // 2) checkout_complete conversion event (SSOT, package_id/persona first-class)
          await emitCheckoutCompleteEvent(adminClient, {
            user_id: userId,
            contact_id: contactIdForEvent,
            curriculum_id: meta.curriculum_id || null,
            product_id: productId,
            session_id: session.id,
            flow: 'create-product-checkout',
            extra: {
              order_id: order?.id,
              total_cents: totalPriceCents,
              currency: 'eur',
            },
          });

          // 3) crm_activity (email/order acknowledgement)
          if (contactIdForEvent) {
            await adminClient.from('crm_activities').insert({
              contact_id: contactIdForEvent,
              activity_type: 'order_paid',
              subject: `Order paid: ${product.name}`,
              body: `Order ${order?.id} | ${(totalPriceCents / 100).toFixed(2)} EUR`,
            });
          }

          logStep("Funnel sync complete", { contactId: contactIdForEvent, orderId: order?.id });
        } catch (funnelErr) {
          logStep("WARN: funnel sync failed (non-blocking)", { error: String(funnelErr) });
        }

        // ===== REFERRAL CONVERSION =====
        try {
          const { data: refResult } = await adminClient.rpc('convert_referral_on_purchase', {
            p_buyer_user_id: userId,
            p_order_id: order?.id ?? null,
          });
          if (refResult?.ok) {
            logStep("Referral converted", { referrerId: refResult.referrer_id, rewardType: refResult.reward_type });
          }
        } catch (refErr) {
          logStep("WARN: Referral conversion check failed (non-critical)", { error: String(refErr) });
        }
        } // end licensePackage ok
        } // end product ok
        } // end existingPackage check
        } // end ExamFit metadata present (else branch)
        } catch (examFitErr) {
          logStep("WARN: ExamFit handler error (non-blocking)", { error: String(examFitErr) });
        }
      } // end not work brand
    } // end checkout.session.completed (ExamFit)

    // ========== charge.refunded / refund.updated (Loop B: idempotent + revoke grants) ==========
    if (event.type === "charge.refunded" || event.type === "refund.updated") {
      let charge: Stripe.Charge | null = null;
      let refundId: string | null = null;
      let refundAmount = 0;
      let paymentIntentId: string | null = null;

      if (event.type === "charge.refunded") {
        charge = event.data.object as Stripe.Charge;
        refundAmount = charge.amount_refunded;
        paymentIntentId = typeof charge.payment_intent === 'string'
          ? charge.payment_intent : charge.payment_intent?.id || null;
        // Use latest refund as anchor
        refundId = charge.refunds?.data?.[0]?.id || charge.id;
      } else {
        // refund.updated
        const refund = event.data.object as Stripe.Refund;
        if (refund.status !== 'succeeded') {
          logStep("Skip refund.updated (not succeeded)", { refundId: refund.id, status: refund.status });
        } else {
          refundId = refund.id;
          refundAmount = refund.amount;
          paymentIntentId = typeof refund.payment_intent === 'string'
            ? refund.payment_intent : refund.payment_intent?.id || null;
        }
      }

      if (paymentIntentId && refundId) {
        logStep("Processing refund event", { eventType: event.type, refundId, refundAmount, paymentIntentId });

        // Idempotency: check if ledger entry for this event already exists
        const { data: existingLedger } = await adminClient
          .from('ledger_entries')
          .select('id')
          .eq('stripe_event_id', event.id)
          .eq('event_type', 'refund')
          .eq('account', 'refunds')
          .maybeSingle();

        if (existingLedger) {
          logStep("Skip refund: already processed", { eventId: event.id });
        } else {
          const { data: existingPayment } = await adminClient
            .from('payments')
            .select('id, order_id, amount_cents')
            .eq('stripe_payment_intent_id', paymentIntentId)
            .maybeSingle();

          if (existingPayment) {
            const isFullRefund = refundAmount >= existingPayment.amount_cents;

            await adminClient.from('payments').update({
              payment_status: isFullRefund ? 'refunded' : 'partial_refund',
            }).eq('id', existingPayment.id);

            await adminClient.from('orders').update({
              status: isFullRefund ? 'refunded' : 'partially_refunded',
            }).eq('id', existingPayment.order_id);

            const taxRate = 19.00;
            const refundTax = Math.round(refundAmount - refundAmount / (1 + taxRate / 100));

            // Idempotent ledger insert (UNIQUE on stripe_event_id, account, event_type)
            const { error: ledgerErr } = await adminClient.from('ledger_entries').insert([
              {
                event_type: 'refund',
                order_id: existingPayment.order_id,
                payment_id: existingPayment.id,
                account: 'refunds',
                amount_cents: -refundAmount,
                currency: 'eur',
                tax_rate: taxRate,
                description: `Refund: ${refundId}`,
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
                description: `Revenue reversal: ${refundId}`,
                stripe_event_id: event.id,
              },
              {
                event_type: 'refund',
                order_id: existingPayment.order_id,
                payment_id: existingPayment.id,
                account: 'tax_payable',
                amount_cents: -refundTax,
                currency: 'eur',
                tax_rate: taxRate,
                description: `Tax reversal: ${refundId}`,
                stripe_event_id: event.id,
              },
            ]);
            if (ledgerErr) {
              logStep("WARN: refund ledger insert failed (likely duplicate)", { error: String(ledgerErr) });
            } else {
              logStep("Refund ledger entries written", { refundAmount, isFullRefund });
            }

            // CRITICAL: Revoke grants/entitlements via SSOT helper
            // Only on full refund — partial refunds keep access (configurable later)
            if (isFullRefund) {
              const { data: revokeResult, error: revokeErr } = await adminClient.rpc(
                'fn_revoke_grant_on_refund',
                {
                  p_stripe_payment_intent_id: paymentIntentId,
                  p_refund_id: refundId,
                  p_reason: 'stripe_refund',
                }
              );
              if (revokeErr) {
                logStep("ERROR: fn_revoke_grant_on_refund failed", { error: String(revokeErr) });
              } else {
                logStep("Grants revoked via SSOT", { result: revokeResult });
              }
            } else {
              logStep("Partial refund — grants kept", { refundAmount, total: existingPayment.amount_cents });
            }

            // Mark invoice as void if full refund
            if (isFullRefund) {
              await adminClient.from('invoices')
                .update({ status: 'void' })
                .eq('order_id', existingPayment.order_id);
            }
          } else {
            logStep("WARN: No payment found for refund PI", { paymentIntentId });
          }
        }
      }
    }

    // ========== charge.dispute.created ==========
    if (event.type === "charge.dispute.created") {
      const dispute = event.data.object as Stripe.Dispute;
      const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
      const disputeAmount = dispute.amount;

      logStep("Processing charge.dispute.created", { disputeId: dispute.id, chargeId, disputeAmount });

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
      await emitCheckoutFailureEvent(adminClient, {
        event_type: 'payment_failed',
        payment_intent: paymentIntent,
        failure_reason: paymentIntent.last_payment_error?.message ?? null,
        failure_code: paymentIntent.last_payment_error?.code ?? null,
      });
    }

    if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
      const session = event.data.object as Stripe.Checkout.Session;
      logStep("Checkout cancelled/expired", { sessionId: session.id, eventType: event.type });
      await emitCheckoutFailureEvent(adminClient, {
        event_type: event.type === "checkout.session.async_payment_failed" ? 'payment_failed' : 'checkout_cancelled',
        session,
        failure_reason: event.type === "checkout.session.expired" ? 'session_expired' : 'async_payment_failed',
        failure_code: event.type,
      });
    }

    // ========== ExamFit@work checkout.session.completed (brand=ExamFit@work or legacy) ==========
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const meta = session.metadata || {};
      const appBaseUrl = Deno.env.get('APP_BASE_URL') || 'https://examfit.de';
      const brandName = 'ExamFit@work';

      const wBrandLower = String(meta.brand || '').toLowerCase();
      const isWorkBrand = wBrandLower.includes('examfit@work') || wBrandLower.includes('examfitwork') || wBrandLower === 'berufski';

      if (isWorkBrand && session.payment_status === 'paid') {
        const scope = meta.scope || 'product';
        logStep("ExamFit@work purchase detected", { scope, productId: meta.productId, bundleId: meta.bundleId });

        const buyerEmail = session.customer_email || session.customer_details?.email || '';
        const amountTotal = session.amount_total || 0;
        const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;

        const generateToken = () => Array.from(crypto.getRandomValues(new Uint8Array(24)))
          .map(b => b.toString(16).padStart(2, '0')).join('');

        const triggerFlush = () => {
          const supabaseUrlEnv = Deno.env.get('SUPABASE_URL') || '';
          fetch(`${supabaseUrlEnv}/functions/v1/berufski-email-flush`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            },
            body: '{}',
          }).catch(() => null);
        };

        // ===== PRODUCT PURCHASE =====
        if (scope === 'product' || (!scope && meta.productId)) {
          const { data: existingPurchase } = await adminClient
            .from('work_purchases')
            .select('id')
            .eq('stripe_session_id', session.id)
            .maybeSingle();

          if (!existingPurchase) {
            const downloadToken = generateToken();
            const userId = meta.user_id || null;

            const { data: purchase } = await adminClient
              .from('work_purchases')
              .insert({
                user_id: userId,
                user_email: buyerEmail,
                produkt_id: meta.productId,
                stripe_session_id: session.id,
                stripe_payment_intent_id: paymentIntentId,
                amount_cents: amountTotal,
                currency: session.currency || 'eur',
                coupon_code: meta.couponCode || null,
                affiliate_code: meta.affiliateCode || null,
                download_token: downloadToken,
                token_expires_at: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
                status: 'paid',
              })
              .select('id')
              .single();

            if (purchase) {
              if (meta.couponCode) {
                await adminClient.from('work_coupon_redemptions').insert({ coupon_code: meta.couponCode, purchase_id: purchase.id });
                try { await adminClient.rpc('work_increment_coupon_redeemed', { p_code: meta.couponCode }); } catch { /* best-effort */ }
              }

              // Build download links with token
              const dlBase = `${appBaseUrl}/work/download?product=${meta.productId}&token=${downloadToken}`;
              const dlScreen = `${dlBase}&mode=screen`;
              const dlPrint = `${dlBase}&mode=print`;
              const expiresStr = new Date(Date.now() + 90 * 24 * 3600 * 1000).toLocaleDateString('de-DE');

              await adminClient.from('work_email_outbox').insert({
                to_email: buyerEmail,
                subject: `Dein ${brandName} Download ist bereit 🎉`,
                html: `<div style="font-family:system-ui,Segoe UI,Roboto,Arial;line-height:1.6">
                  <h2>Danke für deinen Kauf! 🎉</h2>
                  <p>Dein Download ist jetzt bereit:</p>
                  <div style="margin:16px 0">
                    <a href="${dlScreen}" style="display:inline-block;background:#000;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;margin-right:8px">📱 PDF (Screen)</a>
                    <a href="${dlPrint}" style="display:inline-block;background:#333;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">🖨️ PDF (Print-Ready)</a>
                  </div>
                  <p style="margin-top:14px;color:#444;font-size:14px">
                    Tipp: Prüfungsvorbereitung & Lernsysteme findest du bei <a href="https://examfit.de">examfit.de</a>.
                  </p>
                  <hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>
                  <p style="color:#666;font-size:12px">Download-Links gültig bis: ${expiresStr} · ${brandName}</p>
                </div>`,
                meta: { scope: 'product', productId: meta.productId, purchaseId: purchase.id, affiliateCode: meta.affiliateCode, downloadToken },
              });

              triggerFlush();
              logStep("ExamFit@work product purchase created", { purchaseId: purchase.id });
            }
          }
        }

        // ===== BUNDLE PURCHASE =====
        if (scope === 'bundle' && meta.bundleId) {
          const { data: existingBP } = await adminClient
            .from('work_bundle_purchases')
            .select('id')
            .eq('stripe_session_id', session.id)
            .maybeSingle();

          if (!existingBP) {
            const downloadToken = generateToken();

            const { data: bundlePurchase } = await adminClient
              .from('work_bundle_purchases')
              .insert({
                user_email: buyerEmail,
                bundle_id: meta.bundleId,
                stripe_session_id: session.id,
                stripe_payment_intent_id: paymentIntentId,
                amount_paid_cents: amountTotal,
                currency: session.currency || 'eur',
                coupon_code: meta.couponCode || null,
                affiliate_code: meta.affiliateCode || null,
                download_token: downloadToken,
                token_expires_at: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
              })
              .select('id')
              .single();

            if (bundlePurchase) {
              if (meta.couponCode) {
                await adminClient.from('work_coupon_redemptions').insert({ coupon_code: meta.couponCode, purchase_id: bundlePurchase.id });
                try { await adminClient.rpc('work_increment_coupon_redeemed', { p_code: meta.couponCode }); } catch { /* best-effort */ }
              }

              const bundleDlBase = `${appBaseUrl}/work/download?bundle=${meta.bundleId}&token=${downloadToken}`;
              const bundleExpiresStr = new Date(Date.now() + 90 * 24 * 3600 * 1000).toLocaleDateString('de-DE');

              await adminClient.from('work_email_outbox').insert({
                to_email: buyerEmail,
                subject: `Dein ${brandName} Bundle-Download ist bereit 🎉`,
                html: `<div style="font-family:system-ui,Segoe UI,Roboto,Arial;line-height:1.6">
                  <h2>Bundle-Kauf erfolgreich! 🎉</h2>
                  <p>Dein Bundle-Download ist jetzt verfügbar:</p>
                  <div style="margin:16px 0">
                    <a href="${bundleDlBase}&mode=pdf" style="display:inline-block;background:#000;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">📦 Bundle PDF herunterladen</a>
                  </div>
                  <hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>
                  <p style="color:#666;font-size:12px">Download-Link gültig bis: ${bundleExpiresStr} · ${brandName}</p>
                </div>`,
                meta: { scope: 'bundle', bundleId: meta.bundleId, purchaseId: bundlePurchase.id, affiliateCode: meta.affiliateCode, downloadToken },
              });

              triggerFlush();

              logStep("ExamFit@work bundle purchase created", { purchaseId: bundlePurchase.id });
            }
          }
        }

        // ===== CORPORATE LICENSE =====
        if (scope === 'corporate' && meta.plan) {
          const existingCheck = await adminClient
            .from('work_licenses')
            .select('id')
            .eq('stripe_subscription_id', session.id)
            .maybeSingle();

          if (!existingCheck?.data) {
            // Create or find org
            let orgId: string | null = null;
            const { data: existingOrg } = await adminClient
              .from('work_organizations')
              .select('id')
              .eq('billing_email', meta.buyerEmail || buyerEmail)
              .maybeSingle();

            if (existingOrg) {
              orgId = existingOrg.id;
            } else {
              const { data: newOrg } = await adminClient
                .from('work_organizations')
                .insert({
                  name: meta.orgName || 'Organisation',
                  billing_email: meta.buyerEmail || buyerEmail,
                })
                .select('id')
                .single();
              orgId = newOrg?.id || null;
            }

            if (orgId) {
              const seats = meta.plan === 'team_10' ? 10 : meta.plan === 'company_100' ? 100 : 999;
              const endsAt = new Date();
              endsAt.setFullYear(endsAt.getFullYear() + 1);

              const { data: license } = await adminClient
                .from('work_licenses')
                .insert({
                  org_id: orgId,
                  plan: meta.plan,
                  product_id: meta.licenseScope === 'product' ? meta.licenseScopeId : null,
                  bundle_id: meta.licenseScope === 'bundle' ? meta.licenseScopeId : null,
                  seats,
                  starts_at: new Date().toISOString(),
                  ends_at: endsAt.toISOString(),
                  status: 'active',
                  stripe_subscription_id: session.id,
                  watermark_text: `Lizenziert für ${meta.orgName || 'Organisation'}`,
                })
                .select('id')
                .single();

              if (license) {
                // Generate license key
                const keyValue = `EFW-${Array.from(crypto.getRandomValues(new Uint8Array(12))).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase().substring(0, 20)}`;
                
                await adminClient.from('work_license_keys').insert({
                  license_id: license.id,
                  key: keyValue,
                  status: 'available',
                });

                // Email with license key
                await adminClient.from('work_email_outbox').insert({
                  to_email: meta.buyerEmail || buyerEmail,
                  subject: `Deine ${brandName} Corporate Lizenz 🏢`,
                  html: `<div style="font-family:system-ui,Arial;line-height:1.5"><h2>Corporate Lizenz aktiviert!</h2><p>Plan: <strong>${meta.plan}</strong> (${seats} Plätze)</p><p>Lizenz-Key: <code style="background:#f3f4f6;padding:4px 8px;border-radius:4px">${keyValue}</code></p><p>Gültig bis: ${endsAt.toLocaleDateString('de-DE')}</p><p style="color:#666;font-size:12px">Stamped PDF Downloads enthalten Wasserzeichen mit Organisationsname.</p></div>`,
                  meta: { scope: 'corporate', licenseId: license.id, orgId, plan: meta.plan },
                });

                triggerFlush();

                logStep("ExamFit@work corporate license created", { licenseId: license.id, orgId, key: keyValue });
              }
            }
          }
        }
      }
    }

    // ========== SUBSCRIPTION EVENTS (B2B Recurring) ==========

    if (event.type === "invoice.paid") {
      const invoice = event.data.object as any;
      const subscriptionId = invoice.subscription?.toString?.() || invoice.subscription;
      if (subscriptionId) {
        logStep("Processing invoice.paid for subscription renewal", { subscriptionId });
        try {
          const stripeKey2 = Deno.env.get("STRIPE_SECRET_KEY")!;
          const stripe2 = new Stripe(stripeKey2, { apiVersion: "2023-10-16" });
          const sub = await stripe2.subscriptions.retrieve(subscriptionId);
          const periodEnd = sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null;
          const periodStart = sub.current_period_start
            ? new Date(sub.current_period_start * 1000).toISOString()
            : null;

          const { error: updErr } = await adminClient
            .from('org_licenses')
            .update({
              status: 'active',
              current_period_start: periodStart,
              current_period_end: periodEnd,
              cancel_at_period_end: sub.cancel_at_period_end ?? false,
            })
            .eq('stripe_subscription_id', subscriptionId);

          if (updErr) {
            logStep("WARN: Could not update org_license on invoice.paid", { error: String(updErr) });
          } else {
            logStep("Org license renewed", { subscriptionId, periodEnd });
          }
        } catch (subErr) {
          logStep("WARN: invoice.paid subscription handling failed", { error: String(subErr) });
        }
      } else {
        // Loop B: Non-subscription invoice.paid → mirror Stripe invoice into invoices table (best-effort, idempotent via UNIQUE on stripe_invoice_id)
        try {
          const stripeInvoiceId = invoice.id as string;
          const hostedUrl = (invoice.hosted_invoice_url as string) || null;
          const pdfUrl = (invoice.invoice_pdf as string) || hostedUrl;

          // Find matching order via payment_intent or charge
          const piId = typeof invoice.payment_intent === 'string'
            ? invoice.payment_intent : invoice.payment_intent?.id;
          let orderId: string | null = null;
          if (piId) {
            const { data: ord } = await adminClient
              .from('orders')
              .select('id')
              .eq('stripe_payment_intent_id', piId)
              .maybeSingle();
            orderId = ord?.id || null;
          }

          if (!orderId) {
            logStep("Skip invoice.paid mirror: no matching order", { stripeInvoiceId, piId });
          } else {
            // Update existing invoice row (created during checkout.session.completed) with PDF URL + paid status
            const { error: upErr } = await adminClient
              .from('invoices')
              .update({
                pdf_url: pdfUrl,
                stripe_invoice_id: stripeInvoiceId,
                status: 'paid',
              })
              .eq('order_id', orderId);
            if (upErr) {
              logStep("WARN: invoice mirror update failed", { error: String(upErr) });
            } else {
              logStep("Invoice mirrored from Stripe", { stripeInvoiceId, orderId, pdfUrl });
            }
          }
        } catch (mirrorErr) {
          logStep("WARN: invoice.paid mirror failed (non-blocking)", { error: String(mirrorErr) });
        }
      }
    }

    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as any;
      const subscriptionId = invoice.subscription?.toString?.() || invoice.subscription;
      if (subscriptionId) {
        logStep("Processing invoice.payment_failed", { subscriptionId });
        await adminClient
          .from('org_licenses')
          .update({ status: 'past_due' })
          .eq('stripe_subscription_id', subscriptionId);
        logStep("Org license set to past_due", { subscriptionId });
      }
    }

    if (event.type === "customer.subscription.updated") {
      const sub = event.data.object as any;
      logStep("Processing customer.subscription.updated", { subscriptionId: sub.id });
      const periodEnd = sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null;
      const periodStart = sub.current_period_start
        ? new Date(sub.current_period_start * 1000).toISOString()
        : null;

      await adminClient
        .from('org_licenses')
        .update({
          status: sub.status,
          current_period_start: periodStart,
          current_period_end: periodEnd,
          cancel_at_period_end: sub.cancel_at_period_end ?? false,
          stripe_price_id: sub.items?.data?.[0]?.price?.id ?? null,
        })
        .eq('stripe_subscription_id', sub.id);
      logStep("Org license updated from subscription", { subscriptionId: sub.id, status: sub.status });
    }

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as any;
      logStep("Processing customer.subscription.deleted", { subscriptionId: sub.id });
      await adminClient
        .from('org_licenses')
        .update({ status: 'canceled', cancel_at_period_end: false })
        .eq('stripe_subscription_id', sub.id);
      logStep("Org license canceled", { subscriptionId: sub.id });
    }

    // Mark event as successfully processed (best-effort)
    try {
      await adminClient.from("stripe_event_log")
        .update({ process_status: 'ok', processed_at: new Date().toISOString() })
        .eq('stripe_event_id', event.id);
    } catch (_e) { /* non-blocking */ }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR: Unhandled exception", { message: errorMessage });
    // Mark event as failed (best-effort) — only if we tracked an event id earlier
    if (_trackedEventId) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const errClient = createClient(supabaseUrl, supabaseServiceKey);
        await errClient.from("stripe_event_log")
          .update({
            process_status: 'error',
            error_message: errorMessage.slice(0, 2000),
            processed_at: new Date().toISOString(),
          })
          .eq('stripe_event_id', _trackedEventId);
      } catch (_e) { /* non-blocking */ }
    }
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
