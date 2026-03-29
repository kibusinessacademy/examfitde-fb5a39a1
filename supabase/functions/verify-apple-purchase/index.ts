import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Apple Configuration ──────────────────────────────────────────

const ALLOWED_BUNDLE_IDS = (Deno.env.get("APPLE_ALLOWED_BUNDLE_IDS") || "")
  .split(",").map(s => s.trim()).filter(Boolean);

const APPLE_ENVIRONMENT = Deno.env.get("APPLE_ENVIRONMENT") || "production";

// Apple JWKS endpoint
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";

interface AppleTransactionClaims {
  transactionId?: string;
  originalTransactionId?: string;
  productId?: string;
  bundleId?: string;
  environment?: string;
  type?: string;
  expiresDate?: number;
  purchaseDate?: number;
  revocationDate?: number;
  revocationReason?: number;
  isUpgraded?: boolean;
  inAppOwnershipType?: string;
  appAccountToken?: string;
}

interface JWKSKey {
  kty: string;
  kid: string;
  use: string;
  alg: string;
  n: string;
  e: string;
}

// ── JWKS Cache ───────────────────────────────────────────────────
let jwksCache: { keys: JWKSKey[]; fetchedAt: number } | null = null;
const JWKS_CACHE_TTL_MS = 3600_000; // 1 hour

async function fetchAppleJWKS(): Promise<JWKSKey[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(APPLE_JWKS_URL);
  if (!res.ok) throw new Error(`Failed to fetch Apple JWKS: ${res.status}`);
  const data = await res.json();
  jwksCache = { keys: data.keys, fetchedAt: Date.now() };
  return data.keys;
}

function base64urlToUint8Array(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  const binary = atob(base64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importRSAPublicKey(jwk: JWKSKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

/**
 * Cryptographically verify Apple JWS against Apple JWKS.
 * Returns decoded claims on success, null on failure.
 */
async function verifyAppleJWS(jws: string): Promise<{
  verified: boolean;
  claims: AppleTransactionClaims | null;
  rejection_reason?: string;
  verification_method: "cryptographic" | "structural_only";
}> {
  const parts = jws.split(".");
  if (parts.length !== 3) {
    return { verified: false, claims: null, rejection_reason: "invalid_jws_format", verification_method: "structural_only" };
  }

  // Decode header and payload
  let header: { kid?: string; alg?: string };
  let claims: AppleTransactionClaims;
  try {
    header = JSON.parse(atob(parts[0].replace(/-/g, "+").replace(/_/g, "/")));
    claims = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return { verified: false, claims: null, rejection_reason: "invalid_jws_encoding", verification_method: "structural_only" };
  }

  // ── Structural validation ──────────────────────────────────
  if (!claims.transactionId || !claims.productId) {
    return { verified: false, claims, rejection_reason: "missing_required_claims", verification_method: "structural_only" };
  }

  // ── Bundle ID validation ───────────────────────────────────
  if (ALLOWED_BUNDLE_IDS.length > 0 && claims.bundleId) {
    if (!ALLOWED_BUNDLE_IDS.includes(claims.bundleId)) {
      return { verified: false, claims, rejection_reason: "invalid_bundle_id", verification_method: "structural_only" };
    }
  }

  // ── Environment validation ─────────────────────────────────
  if (claims.environment) {
    const expectedEnv = APPLE_ENVIRONMENT === "production" ? "Production" : "Sandbox";
    if (claims.environment !== expectedEnv && APPLE_ENVIRONMENT !== "sandbox") {
      return { verified: false, claims, rejection_reason: "environment_mismatch", verification_method: "structural_only" };
    }
  }

  // ── Revocation check ───────────────────────────────────────
  if (claims.revocationDate) {
    return { verified: false, claims, rejection_reason: "transaction_revoked", verification_method: "structural_only" };
  }

  // ── Cryptographic JWS Signature Verification ───────────────
  if (!header.kid || header.alg !== "ES256" && header.alg !== "RS256") {
    // Apple uses ES256 but we handle RS256 too
    // If no kid or unknown alg, mark as structurally_valid only
    console.warn("Apple verify: JWS header missing kid or unsupported alg", { kid: header.kid, alg: header.alg });
    return { verified: false, claims, rejection_reason: "no_cryptographic_verification_possible", verification_method: "structural_only" };
  }

  try {
    const jwks = await fetchAppleJWKS();
    const matchingKey = jwks.find(k => k.kid === header.kid);

    if (!matchingKey) {
      console.error("Apple verify: no matching JWKS key for kid", { kid: header.kid });
      return { verified: false, claims, rejection_reason: "jwks_key_not_found", verification_method: "structural_only" };
    }

    // Import the public key
    let cryptoKey: CryptoKey;
    const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signature = base64urlToUint8Array(parts[2]);

    if (matchingKey.kty === "RSA") {
      cryptoKey = await importRSAPublicKey(matchingKey);
      const valid = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        cryptoKey,
        signature,
        signedData
      );
      if (!valid) {
        return { verified: false, claims, rejection_reason: "signature_invalid", verification_method: "cryptographic" };
      }
    } else if (matchingKey.kty === "EC") {
      // Apple App Store uses EC keys (ES256)
      cryptoKey = await crypto.subtle.importKey(
        "jwk",
        { kty: "EC", crv: "P-256", x: (matchingKey as any).x, y: (matchingKey as any).y, ext: true },
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"]
      );
      const valid = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        cryptoKey,
        signature,
        signedData
      );
      if (!valid) {
        return { verified: false, claims, rejection_reason: "signature_invalid", verification_method: "cryptographic" };
      }
    } else {
      return { verified: false, claims, rejection_reason: "unsupported_key_type", verification_method: "structural_only" };
    }

    // Signature verified!
    return { verified: true, claims, verification_method: "cryptographic" };
  } catch (err) {
    console.error("Apple verify: JWKS verification error", { error: String(err) });
    // HARD FAIL: if JWKS fetch or verification errors out, do NOT fall through to verified
    return { verified: false, claims, rejection_reason: "jwks_verification_error", verification_method: "structural_only" };
  }
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

    // ── Extract JWS ──────────────────────────────────────────
    const signedTransaction = transaction_payload.signedTransactionInfo
      ?? transaction_payload.signed_transaction
      ?? (typeof transaction_payload === "string" ? transaction_payload : null);

    if (!signedTransaction || typeof signedTransaction !== "string") {
      // Legacy non-JWS payloads: mark as structurally_valid only, never verified
      return new Response(
        JSON.stringify({
          verified: false,
          error: "Apple verification requires signed JWS transaction (StoreKit 2). Legacy receipts are not accepted.",
          status: "structurally_valid",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Verify JWS cryptographically ─────────────────────────
    const verResult = await verifyAppleJWS(signedTransaction);

    if (!verResult.claims) {
      await sb.from("mobile_store_sync_log").insert({
        store, event_type: "verification_rejected",
        payload_json: { reason: verResult.rejection_reason },
        status: "rejected",
      });
      return new Response(
        JSON.stringify({ verified: false, error: `Apple verification failed: ${verResult.rejection_reason}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const claims = verResult.claims;
    const storeSku = claims.productId!;
    const transactionId = claims.transactionId!;
    const originalTransactionId = claims.originalTransactionId || "";

    // Determine verification status based on actual verification method
    // CRITICAL: only cryptographic verification → provider_verified
    // structural only → structurally_valid (NO entitlement creation)
    const verificationStatus = verResult.verified && verResult.verification_method === "cryptographic"
      ? "provider_verified"
      : verResult.verified
        ? "structurally_valid" // should not happen given the logic above, but defensive
        : "rejected";

    if (!verResult.verified) {
      await sb.from("mobile_store_sync_log").insert({
        store, event_type: "verification_rejected",
        payload_json: { reason: verResult.rejection_reason, method: verResult.verification_method },
        status: "rejected",
      });
    }

    // ── 1. Resolve store product ─────────────────────────────
    const { data: productData, error: productErr } = await sb.rpc(
      "resolve_mobile_store_product",
      { p_store: store, p_store_sku: storeSku }
    );

    if (productErr || !productData?.length) {
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
        p_app_account_token: app_account_token || claims.appAccountToken || null,
      });
      learnerIdentityId = liId;
    }

    // ── 3. Subscription lifecycle ────────────────────────────
    const isSubscription = storeProduct.store_product_type === "subscription";
    let subscriptionPeriodStart: string | null = null;
    let subscriptionPeriodEnd: string | null = null;

    if (isSubscription && claims.purchaseDate) {
      subscriptionPeriodStart = new Date(claims.purchaseDate).toISOString();
    }
    if (isSubscription && claims.expiresDate) {
      subscriptionPeriodEnd = new Date(claims.expiresDate).toISOString();
    }

    // ── 4. Create or find purchase event (idempotent) ────────
    const { data: existingEvent } = await sb
      .from("mobile_store_purchase_events")
      .select("id, verification_status")
      .eq("store", store)
      .eq("external_transaction_id", transactionId)
      .maybeSingle();

    let purchaseEventId: string;

    if (existingEvent) {
      purchaseEventId = existingEvent.id;

      // If already provider_verified, handle idempotent return
      if (existingEvent.verification_status === "provider_verified") {
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
            verification_method: "cryptographic",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Update status if we now have better verification
      await sb.from("mobile_store_purchase_events")
        .update({
          verification_status: verificationStatus,
          processed_at: new Date().toISOString(),
          provider_verification_json: {
            verified: verResult.verified,
            method: verResult.verification_method,
            rejection_reason: verResult.rejection_reason || null,
          },
        })
        .eq("id", purchaseEventId);
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
          verification_status: verificationStatus,
          environment: claims.environment?.toLowerCase() || "production",
          bundle_id: claims.bundleId || null,
          is_subscription: isSubscription,
          subscription_period_start: subscriptionPeriodStart,
          subscription_period_end: subscriptionPeriodEnd,
          auto_renew_status: null,
          purchase_context: purchaseContext,
          link_status: linkStatus,
          provider_verification_json: {
            verified: verResult.verified,
            method: verResult.verification_method,
            rejection_reason: verResult.rejection_reason || null,
          },
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

    // ── 5. HARD GATE: only provider_verified → entitlement ───
    if (verificationStatus !== "provider_verified") {
      await sb.from("mobile_store_sync_log").insert({
        store, event_type: "verification_incomplete",
        payload_json: {
          purchase_event_id: purchaseEventId,
          status: verificationStatus,
          reason: verResult.rejection_reason,
          method: verResult.verification_method,
        },
        status: verificationStatus,
      });

      return new Response(
        JSON.stringify({
          verified: false,
          status: verificationStatus,
          error: verResult.rejection_reason
            ? `Verification failed: ${verResult.rejection_reason}`
            : "Cryptographic verification required but not achieved",
          purchase_event_id: purchaseEventId,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 6. Create entitlement (only for provider_verified) ───
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

    await sb.from("mobile_store_sync_log").insert({
      store, event_type: "purchase_verified",
      payload_json: {
        purchase_event_id: purchaseEventId,
        entitlement_id: entitlementId,
        store_sku: storeSku,
        transaction_id: transactionId,
        is_subscription: isSubscription,
        verification_method: "cryptographic",
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
        verification_method: "cryptographic",
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
