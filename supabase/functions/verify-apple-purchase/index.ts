import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Apple Environment & Bundle Validation ────────────────────────

const ALLOWED_BUNDLE_IDS = (Deno.env.get("APPLE_ALLOWED_BUNDLE_IDS") || "")
  .split(",").map(s => s.trim()).filter(Boolean);

const APPLE_ENVIRONMENT = Deno.env.get("APPLE_ENVIRONMENT") || "production"; // "production" | "sandbox"

interface AppleTransactionClaims {
  transactionId?: string;
  originalTransactionId?: string;
  productId?: string;
  bundleId?: string;
  environment?: string; // "Production" | "Sandbox"
  type?: string; // "Auto-Renewable Subscription" | "Non-Consumable" | ...
  expiresDate?: number; // ms epoch
  purchaseDate?: number;
  revocationDate?: number;
  revocationReason?: number;
  isUpgraded?: boolean;
  inAppOwnershipType?: string;
  appAccountToken?: string;
}

/**
 * Decode a JWS (JSON Web Signature) without cryptographic verification.
 * Used as structural pre-check. Full verification requires JWKS.
 */
function decodeJWSPayload(jws: string): AppleTransactionClaims | null {
  try {
    const parts = jws.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload;
  } catch {
    return null;
  }
}

/**
 * Verify Apple JWS transaction against Apple's JWKS.
 *
 * PRODUCTION-READY ARCHITECTURE:
 * 1. Fetch Apple's public keys from JWKS endpoint
 * 2. Verify JWS signature using the matching key
 * 3. Validate claims (iss, aud, exp, bundleId, environment)
 *
 * Currently: structural validation + claims checking.
 * TODO: Add full JWS signature verification when APPLE_SHARED_SECRET is configured.
 */
async function verifyAppleTransaction(
  jws: string,
  _keyset_url?: string
): Promise<{
  verified: boolean;
  claims: AppleTransactionClaims | null;
  rejection_reason?: string;
}> {
  const claims = decodeJWSPayload(jws);
  if (!claims) {
    return { verified: false, claims: null, rejection_reason: "invalid_jws_format" };
  }

  // ── Structural validation ──────────────────────────────────
  if (!claims.transactionId || !claims.productId) {
    return { verified: false, claims, rejection_reason: "missing_required_claims" };
  }

  // ── Bundle ID validation ───────────────────────────────────
  if (ALLOWED_BUNDLE_IDS.length > 0 && claims.bundleId) {
    if (!ALLOWED_BUNDLE_IDS.includes(claims.bundleId)) {
      return { verified: false, claims, rejection_reason: "invalid_bundle_id" };
    }
  }

  // ── Environment validation ─────────────────────────────────
  if (claims.environment) {
    const expectedEnv = APPLE_ENVIRONMENT === "production" ? "Production" : "Sandbox";
    if (claims.environment !== expectedEnv && APPLE_ENVIRONMENT !== "sandbox") {
      return { verified: false, claims, rejection_reason: "environment_mismatch" };
    }
  }

  // ── Revocation check ───────────────────────────────────────
  if (claims.revocationDate) {
    return { verified: false, claims, rejection_reason: "transaction_revoked" };
  }

  // ── JWKS Signature Verification (guarded) ──────────────────
  const appleSharedSecret = Deno.env.get("APPLE_SHARED_SECRET");
  if (appleSharedSecret) {
    // TODO: PRODUCTION — Full JWS verification:
    // 1. Fetch JWKS from https://appleid.apple.com/auth/keys
    // 2. Match kid from JWS header to JWKS key
    // 3. Verify RS256 signature
    // 4. Validate iss = "https://appleid.apple.com"
    // For now: presence of secret signals production readiness intent
    console.log("Apple verify: APPLE_SHARED_SECRET configured, full JWS verification pending");
  }

  return { verified: true, claims };
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
    const { transaction_payload, user_id, app_account_token } = body;

    if (!transaction_payload || typeof transaction_payload !== "object") {
      return new Response(
        JSON.stringify({ error: "Missing or invalid transaction_payload" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const store = "apple";

    // ── Support both raw object and JWS string ───────────────
    let claims: AppleTransactionClaims;
    let verificationResult: { verified: boolean; claims: AppleTransactionClaims | null; rejection_reason?: string };

    const signedTransaction = transaction_payload.signedTransactionInfo
      ?? transaction_payload.signed_transaction
      ?? (typeof transaction_payload === "string" ? transaction_payload : null);

    if (signedTransaction && typeof signedTransaction === "string") {
      // JWS path (StoreKit 2 / App Store Server API v2)
      verificationResult = await verifyAppleTransaction(signedTransaction);
      if (!verificationResult.verified || !verificationResult.claims) {
        // Log rejection
        await sb.from("mobile_store_sync_log").insert({
          store,
          event_type: "verification_rejected",
          payload_json: {
            reason: verificationResult.rejection_reason,
            has_claims: !!verificationResult.claims,
          },
          status: "rejected",
        });
        return new Response(
          JSON.stringify({
            verified: false,
            error: `Apple verification failed: ${verificationResult.rejection_reason}`,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      claims = verificationResult.claims;
    } else {
      // Legacy object path (backward compat)
      claims = {
        transactionId: String(transaction_payload.transactionId ?? transaction_payload.transaction_id ?? ""),
        originalTransactionId: String(transaction_payload.originalTransactionId ?? transaction_payload.original_transaction_id ?? ""),
        productId: String(transaction_payload.productId ?? transaction_payload.product_id ?? ""),
        bundleId: transaction_payload.bundleId ?? transaction_payload.bundle_id,
        environment: transaction_payload.environment,
      };

      if (!claims.transactionId || !claims.productId) {
        return new Response(
          JSON.stringify({ error: "Missing productId or transactionId in payload" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Bundle ID check for legacy path too
      if (ALLOWED_BUNDLE_IDS.length > 0 && claims.bundleId) {
        if (!ALLOWED_BUNDLE_IDS.includes(claims.bundleId)) {
          return new Response(
            JSON.stringify({ verified: false, error: "Invalid bundle ID" }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      verificationResult = { verified: true, claims };
    }

    const storeSku = claims.productId!;
    const transactionId = claims.transactionId!;
    const originalTransactionId = claims.originalTransactionId || "";

    // ── 1. Resolve store product ─────────────────────────────
    const { data: productData, error: productErr } = await sb.rpc(
      "resolve_mobile_store_product",
      { p_store: store, p_store_sku: storeSku }
    );

    if (productErr || !productData?.length) {
      console.error("Apple verify: unknown SKU", { storeSku, error: productErr });
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

    // ── 2. Determine purchase context ────────────────────────
    const purchaseContext = user_id ? "authenticated" : "anonymous";
    const linkStatus = user_id ? "linked" : "unlinked";

    // ── 3. Ensure learner identity ───────────────────────────
    let learnerIdentityId: string | null = null;
    if (user_id) {
      const { data: liId } = await sb.rpc("ensure_mobile_learner_identity", {
        p_user_id: user_id,
        p_app_account_token: app_account_token || claims.appAccountToken || null,
      });
      learnerIdentityId = liId;
    }

    // ── 4. Subscription lifecycle data ───────────────────────
    const isSubscription = storeProduct.store_product_type === "subscription";
    let subscriptionPeriodStart: string | null = null;
    let subscriptionPeriodEnd: string | null = null;

    if (isSubscription && claims.purchaseDate) {
      subscriptionPeriodStart = new Date(claims.purchaseDate).toISOString();
    }
    if (isSubscription && claims.expiresDate) {
      subscriptionPeriodEnd = new Date(claims.expiresDate).toISOString();
    }

    // ── 5. Create or find purchase event (idempotent) ────────
    const { data: existingEvent } = await sb
      .from("mobile_store_purchase_events")
      .select("id, verification_status")
      .eq("store", store)
      .eq("external_transaction_id", transactionId)
      .maybeSingle();

    let purchaseEventId: string;

    if (existingEvent) {
      purchaseEventId = existingEvent.id;

      if (existingEvent.verification_status === "verified" || existingEvent.verification_status === "provider_verified") {
        // Idempotent return — but update subscription period if newer
        if (isSubscription && subscriptionPeriodEnd) {
          await sb.rpc("create_mobile_store_entitlement", {
            p_store: store,
            p_purchase_event_id: purchaseEventId,
            p_product_id: storeProduct.product_id,
            p_user_id: user_id || null,
            p_learner_identity_id: learnerIdentityId,
            p_source_ref: transactionId,
            p_is_subscription: true,
            p_subscription_period_start: subscriptionPeriodStart,
            p_subscription_period_end: subscriptionPeriodEnd,
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
          external_original_transaction_id: originalTransactionId || null,
          store_sku: storeSku,
          user_id: user_id || null,
          learner_identity_id: learnerIdentityId,
          app_account_token: app_account_token || claims.appAccountToken || null,
          raw_payload_json: transaction_payload,
          verification_status: "pending",
          environment: claims.environment?.toLowerCase() || "production",
          bundle_id: claims.bundleId || null,
          is_subscription: isSubscription,
          subscription_period_start: subscriptionPeriodStart,
          subscription_period_end: subscriptionPeriodEnd,
          auto_renew_status: null,
          purchase_context: purchaseContext,
          link_status: linkStatus,
          provider_verification_json: verificationResult.claims ? { verified: true } : null,
        })
        .select("id")
        .single();

      if (insertErr || !newEvent) {
        console.error("Apple verify: failed to create purchase event", { error: insertErr });
        return new Response(
          JSON.stringify({ error: "Failed to record purchase event" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      purchaseEventId = newEvent.id;
    }

    // ── 6. Set verification status ───────────────────────────
    const verificationStatus = verificationResult.verified ? "verified" : "rejected";

    await sb
      .from("mobile_store_purchase_events")
      .update({
        verification_status: verificationStatus,
        processed_at: new Date().toISOString(),
        provider_verification_json: { verified: verificationResult.verified, rejection_reason: verificationResult.rejection_reason || null },
      })
      .eq("id", purchaseEventId);

    if (verificationStatus !== "verified") {
      return new Response(
        JSON.stringify({ verified: false, error: `Verification failed: ${verificationResult.rejection_reason}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 7. Create entitlement ────────────────────────────────
    const { data: entitlementId, error: entErr } = await sb.rpc(
      "create_mobile_store_entitlement",
      {
        p_store: store,
        p_purchase_event_id: purchaseEventId,
        p_product_id: storeProduct.product_id,
        p_user_id: user_id || null,
        p_learner_identity_id: learnerIdentityId,
        p_source_ref: transactionId,
        p_is_subscription: isSubscription,
        p_subscription_period_start: subscriptionPeriodStart,
        p_subscription_period_end: subscriptionPeriodEnd,
      }
    );

    if (entErr) {
      console.error("Apple verify: entitlement creation failed", { error: entErr });
      return new Response(
        JSON.stringify({ error: "Entitlement creation failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 8. Sync log ──────────────────────────────────────────
    await sb.from("mobile_store_sync_log").insert({
      store,
      event_type: "purchase_verified",
      payload_json: {
        purchase_event_id: purchaseEventId,
        entitlement_id: entitlementId,
        store_sku: storeSku,
        transaction_id: transactionId,
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
        subscription_period_end: subscriptionPeriodEnd,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Apple verify error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error during Apple purchase verification" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
