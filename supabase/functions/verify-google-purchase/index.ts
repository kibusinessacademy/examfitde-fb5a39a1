import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Google Package & Environment Validation ──────────────────────

const ALLOWED_PACKAGE_NAMES = (Deno.env.get("GOOGLE_ALLOWED_PACKAGE_NAMES") || "")
  .split(",").map(s => s.trim()).filter(Boolean);

interface GooglePurchasePayload {
  productId?: string;
  sku?: string;
  purchaseToken?: string;
  token?: string;
  orderId?: string;
  order_id?: string;
  packageName?: string;
  package_name?: string;
  purchaseState?: number; // 0=purchased, 1=canceled, 2=pending
  acknowledgementState?: number; // 0=not acknowledged, 1=acknowledged
  purchaseTime?: number; // ms epoch
  expiryTimeMillis?: number; // subscription expiry
  autoRenewing?: boolean;
  cancelReason?: number;
  userCancellationTimeMillis?: number;
}

/**
 * Verify Google Play purchase.
 *
 * PRODUCTION-READY ARCHITECTURE:
 * 1. Validate payload structure + package name
 * 2. Check purchaseState and acknowledgementState
 * 3. Full verification via Google Play Developer API (guarded)
 *
 * Currently: structural + state validation.
 * TODO: Add Google Play Developer API verification when GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is configured.
 */
function verifyGooglePurchase(payload: GooglePurchasePayload): {
  verified: boolean;
  rejection_reason?: string;
  is_subscription: boolean;
  period_start?: string;
  period_end?: string;
  auto_renew?: boolean;
} {
  const sku = payload.productId || payload.sku || "";
  const token = payload.purchaseToken || payload.token || "";

  if (!sku || !token) {
    return { verified: false, rejection_reason: "missing_sku_or_token", is_subscription: false };
  }

  // ── Package name validation ────────────────────────────────
  const packageName = payload.packageName || payload.package_name;
  if (ALLOWED_PACKAGE_NAMES.length > 0 && packageName) {
    if (!ALLOWED_PACKAGE_NAMES.includes(packageName)) {
      return { verified: false, rejection_reason: "invalid_package_name", is_subscription: false };
    }
  }

  // ── Purchase state validation ──────────────────────────────
  if (payload.purchaseState !== undefined) {
    if (payload.purchaseState === 1) {
      return { verified: false, rejection_reason: "purchase_canceled", is_subscription: false };
    }
    if (payload.purchaseState === 2) {
      return { verified: false, rejection_reason: "purchase_pending", is_subscription: false };
    }
    if (payload.purchaseState !== 0) {
      return { verified: false, rejection_reason: "unknown_purchase_state", is_subscription: false };
    }
  }

  // ── Cancellation check ─────────────────────────────────────
  if (payload.userCancellationTimeMillis) {
    return { verified: false, rejection_reason: "purchase_user_cancelled", is_subscription: false };
  }

  // ── Subscription data extraction ───────────────────────────
  const isSubscription = !!payload.expiryTimeMillis;
  let periodStart: string | undefined;
  let periodEnd: string | undefined;

  if (payload.purchaseTime) {
    periodStart = new Date(payload.purchaseTime).toISOString();
  }
  if (payload.expiryTimeMillis) {
    periodEnd = new Date(payload.expiryTimeMillis).toISOString();
    // Check if already expired
    if (payload.expiryTimeMillis < Date.now()) {
      return { verified: false, rejection_reason: "subscription_expired", is_subscription: true };
    }
  }

  return {
    verified: true,
    is_subscription: isSubscription,
    period_start: periodStart,
    period_end: periodEnd,
    auto_renew: payload.autoRenewing,
  };
}

// ── Main Handler ─────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json();
    const { purchase_payload, user_id, app_account_token } = body;

    if (!purchase_payload || typeof purchase_payload !== "object") {
      return new Response(
        JSON.stringify({ error: "Missing or invalid purchase_payload" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const store = "google";

    // ── Verify purchase ──────────────────────────────────────
    const verResult = verifyGooglePurchase(purchase_payload);

    const storeSku = String(purchase_payload.productId ?? purchase_payload.sku ?? "");
    const purchaseToken = String(purchase_payload.purchaseToken ?? purchase_payload.token ?? "");
    const orderId = String(purchase_payload.orderId ?? purchase_payload.order_id ?? "");
    const packageName = purchase_payload.packageName ?? purchase_payload.package_name ?? null;
    const transactionId = purchaseToken.substring(0, 200);

    if (!verResult.verified) {
      // Log the rejection
      await sb.from("mobile_store_sync_log").insert({
        store,
        event_type: "verification_rejected",
        payload_json: { reason: verResult.rejection_reason, sku: storeSku },
        status: "rejected",
      });

      return new Response(
        JSON.stringify({
          verified: false,
          error: `Google verification failed: ${verResult.rejection_reason}`,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 1. Resolve store product ─────────────────────────────
    const { data: productData, error: productErr } = await sb.rpc(
      "resolve_mobile_store_product",
      { p_store: store, p_store_sku: storeSku }
    );

    if (productErr || !productData?.length) {
      console.error("Google verify: unknown SKU", { storeSku, error: productErr });
      return new Response(
        JSON.stringify({ error: "Unknown store product SKU" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const storeProduct = productData[0];
    if (!storeProduct.is_active) {
      return new Response(
        JSON.stringify({ error: "Store product is inactive" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 2. Purchase context & identity ───────────────────────
    const purchaseContext = user_id ? "authenticated" : "anonymous";
    const linkStatus = user_id ? "linked" : "unlinked";

    let learnerIdentityId: string | null = null;
    if (user_id) {
      const { data: liId } = await sb.rpc("ensure_mobile_learner_identity", {
        p_user_id: user_id,
        p_app_account_token: app_account_token || null,
      });
      learnerIdentityId = liId;
    }

    // ── 3. Create or find purchase event (idempotent) ────────
    const { data: existingEvent } = await sb
      .from("mobile_store_purchase_events")
      .select("id, verification_status")
      .eq("store", store)
      .eq("external_transaction_id", transactionId)
      .maybeSingle();

    let purchaseEventId: string;
    const isSubscription = storeProduct.store_product_type === "subscription" || verResult.is_subscription;

    if (existingEvent) {
      purchaseEventId = existingEvent.id;
      if (existingEvent.verification_status === "verified" || existingEvent.verification_status === "provider_verified") {
        // Update subscription period if renewal
        if (isSubscription && verResult.period_end) {
          await sb.rpc("create_mobile_store_entitlement", {
            p_store: store,
            p_purchase_event_id: purchaseEventId,
            p_product_id: storeProduct.product_id,
            p_user_id: user_id || null,
            p_learner_identity_id: learnerIdentityId,
            p_source_ref: orderId || transactionId,
            p_is_subscription: true,
            p_subscription_period_start: verResult.period_start || null,
            p_subscription_period_end: verResult.period_end,
          });
        }

        const { data: existingLink } = await sb
          .from("mobile_store_receipt_links")
          .select("entitlement_id, status")
          .eq("purchase_event_id", purchaseEventId)
          .eq("status", "active")
          .maybeSingle();

        return new Response(
          JSON.stringify({
            verified: true,
            product_id: storeProduct.product_id,
            entitlement_id: existingLink?.entitlement_id ?? null,
            entitlement_status: existingLink?.status ?? "unknown",
            idempotent: true,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      const { data: newEvent, error: insertErr } = await sb
        .from("mobile_store_purchase_events")
        .insert({
          store,
          external_transaction_id: transactionId,
          external_original_transaction_id: orderId || null,
          store_sku: storeSku,
          user_id: user_id || null,
          learner_identity_id: learnerIdentityId,
          app_account_token: app_account_token || null,
          raw_payload_json: purchase_payload,
          verification_status: "pending",
          environment: "production",
          bundle_id: packageName,
          is_subscription: isSubscription,
          subscription_period_start: verResult.period_start || null,
          subscription_period_end: verResult.period_end || null,
          auto_renew_status: verResult.auto_renew ?? null,
          purchase_context: purchaseContext,
          link_status: linkStatus,
          provider_verification_json: { purchaseState: purchase_payload.purchaseState, acknowledgementState: purchase_payload.acknowledgementState },
        })
        .select("id")
        .single();

      if (insertErr || !newEvent) {
        console.error("Google verify: failed to create purchase event", { error: insertErr });
        return new Response(
          JSON.stringify({ error: "Failed to record purchase event" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      purchaseEventId = newEvent.id;
    }

    // ── 4. Google Play Developer API verification (guarded) ──
    const serviceAccountJson = Deno.env.get("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON");
    let providerVerified = false;

    if (serviceAccountJson) {
      // TODO: PRODUCTION — Full Google Play verification:
      // 1. Parse service account JSON
      // 2. Generate OAuth2 token
      // 3. Call purchases.products.get or purchases.subscriptions.get
      // 4. Verify purchaseState, acknowledgementState, packageName
      // 5. Acknowledge purchase if not yet acknowledged
      console.log("Google verify: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON configured, full API verification pending");
      providerVerified = false; // Will be true when API is integrated
    }

    const verificationStatus = providerVerified ? "provider_verified" : "verified";

    await sb
      .from("mobile_store_purchase_events")
      .update({
        verification_status: verificationStatus,
        processed_at: new Date().toISOString(),
        provider_verification_json: {
          structural_verified: true,
          provider_verified: providerVerified,
          purchaseState: purchase_payload.purchaseState,
          acknowledgementState: purchase_payload.acknowledgementState,
        },
      })
      .eq("id", purchaseEventId);

    // ── 5. Create entitlement ────────────────────────────────
    const { data: entitlementId, error: entErr } = await sb.rpc(
      "create_mobile_store_entitlement",
      {
        p_store: store,
        p_purchase_event_id: purchaseEventId,
        p_product_id: storeProduct.product_id,
        p_user_id: user_id || null,
        p_learner_identity_id: learnerIdentityId,
        p_source_ref: orderId || transactionId,
        p_is_subscription: isSubscription,
        p_subscription_period_start: verResult.period_start || null,
        p_subscription_period_end: verResult.period_end || null,
      }
    );

    if (entErr) {
      console.error("Google verify: entitlement creation failed", { error: entErr });
      return new Response(
        JSON.stringify({ error: "Entitlement creation failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await sb.from("mobile_store_sync_log").insert({
      store,
      event_type: "purchase_verified",
      payload_json: {
        purchase_event_id: purchaseEventId,
        entitlement_id: entitlementId,
        store_sku: storeSku,
        order_id: orderId,
        is_subscription: isSubscription,
        purchase_context: purchaseContext,
      },
      status: "completed",
    });

    return new Response(
      JSON.stringify({
        verified: true,
        product_id: storeProduct.product_id,
        entitlement_id: entitlementId,
        entitlement_status: "active",
        is_subscription: isSubscription,
        subscription_period_end: verResult.period_end || null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Google verify error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error during Google purchase verification" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
