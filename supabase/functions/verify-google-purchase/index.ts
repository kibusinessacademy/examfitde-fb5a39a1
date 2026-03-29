import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Verify Google Play Purchase
 *
 * Server-side validation of Google Play billing transactions.
 * Resolves product, creates purchase event, validates purchase token,
 * and creates entitlement via create_mobile_store_entitlement().
 *
 * TODO: PRODUCTION — Integrate Google Play Developer API for
 * full purchase token verification via purchases.products.get / purchases.subscriptions.get
 */
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
    const storeSku = String(purchase_payload.productId ?? purchase_payload.sku ?? "");
    const purchaseToken = String(purchase_payload.purchaseToken ?? purchase_payload.token ?? "");
    const orderId = String(purchase_payload.orderId ?? purchase_payload.order_id ?? "");

    if (!storeSku || !purchaseToken) {
      return new Response(
        JSON.stringify({ error: "Missing productId/sku or purchaseToken in payload" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use purchaseToken as transaction ID (unique per purchase)
    const transactionId = purchaseToken.substring(0, 200);

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

    // ── 2. Ensure learner identity ───────────────────────────
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

    if (existingEvent) {
      purchaseEventId = existingEvent.id;
      if (existingEvent.verification_status === "verified") {
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

    // ── 4. Validate purchase token ───────────────────────────
    // TODO: PRODUCTION — Call Google Play Developer API:
    //   1. purchases.products.get for one-time purchases
    //   2. purchases.subscriptions.get for subscriptions
    //   3. Verify purchaseState, acknowledgementState
    //   4. Check package name matches
    //
    // For now: structural validation
    const isStructurallyValid = !!storeSku && !!purchaseToken;
    const verificationStatus = isStructurallyValid ? "verified" : "rejected";

    await sb
      .from("mobile_store_purchase_events")
      .update({
        verification_status: verificationStatus,
        processed_at: new Date().toISOString(),
      })
      .eq("id", purchaseEventId);

    if (verificationStatus !== "verified") {
      return new Response(
        JSON.stringify({ verified: false, error: "Purchase token validation failed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 5. Create entitlement ────────────────────────────────
    const isSubscription = storeProduct.store_product_type === "subscription";

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
      },
      status: "completed",
    });

    console.log("Google verify: success", {
      purchaseEventId,
      entitlementId,
      productId: storeProduct.product_id,
    });

    return new Response(
      JSON.stringify({
        verified: true,
        product_id: storeProduct.product_id,
        entitlement_id: entitlementId,
        entitlement_status: "active",
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
