import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Google Configuration ─────────────────────────────────────────

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
  purchaseState?: number;
  acknowledgementState?: number;
  purchaseTime?: number;
  expiryTimeMillis?: number;
  autoRenewing?: boolean;
  cancelReason?: number;
  userCancellationTimeMillis?: number;
}

// ── Google OAuth2 Token Generation ───────────────────────────────

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  token_uri: string;
}

function base64urlEncode(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function generateGoogleAccessToken(sa: ServiceAccountCredentials): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: sa.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const encodedHeader = base64urlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const encodedPayload = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signInput = `${encodedHeader}.${encodedPayload}`;

  // Import RSA private key
  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const keyData = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", cryptoKey,
    new TextEncoder().encode(signInput)
  );

  const jwt = `${signInput}.${base64urlEncode(new Uint8Array(signature))}`;

  const tokenRes = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Google OAuth2 token error: ${tokenRes.status} ${errText}`);
  }

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

// ── Google Play Developer API Verification ───────────────────────

interface PlayApiVerificationResult {
  verified: boolean;
  rejection_reason?: string;
  is_subscription: boolean;
  period_start?: string;
  period_end?: string;
  auto_renew?: boolean;
  acknowledgement_state?: number;
  purchase_state?: number;
  provider_response?: Record<string, unknown>;
}

async function verifyViaPlayDeveloperAPI(
  packageName: string,
  productId: string,
  purchaseToken: string,
  isSubscriptionHint: boolean,
  accessToken: string
): Promise<PlayApiVerificationResult> {
  const baseUrl = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";

  // Try subscription endpoint first if hinted, then products
  const endpoints = isSubscriptionHint
    ? [
        `${baseUrl}/${packageName}/purchases/subscriptionsv2/tokens/${purchaseToken}`,
        `${baseUrl}/${packageName}/purchases/products/${productId}/tokens/${purchaseToken}`,
      ]
    : [
        `${baseUrl}/${packageName}/purchases/products/${productId}/tokens/${purchaseToken}`,
      ];

  for (const url of endpoints) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.status === 404) {
      await res.text(); // consume body
      continue;
    }

    if (!res.ok) {
      const errText = await res.text();
      console.error("Google Play API error", { status: res.status, body: errText });
      return { verified: false, rejection_reason: `play_api_error_${res.status}`, is_subscription: false };
    }

    const data = await res.json();

    // Subscriptions v2 response
    if (data.lineItems || data.subscriptionState) {
      const state = data.subscriptionState;
      // SUBSCRIPTION_STATE_ACTIVE = "SUBSCRIPTION_STATE_ACTIVE"
      if (state && state !== "SUBSCRIPTION_STATE_ACTIVE" && state !== "SUBSCRIPTION_STATE_IN_GRACE_PERIOD") {
        return {
          verified: false,
          rejection_reason: `subscription_state_${state.toLowerCase()}`,
          is_subscription: true,
          provider_response: data,
        };
      }

      const lineItem = data.lineItems?.[0];
      return {
        verified: true,
        is_subscription: true,
        period_start: data.startTime,
        period_end: lineItem?.expiryTime || data.expiryTime,
        auto_renew: lineItem?.autoRenewingPlan?.autoRenewEnabled ?? data.autoRenewing,
        provider_response: data,
      };
    }

    // Products (one-time) response
    if (data.purchaseState !== undefined) {
      if (data.purchaseState !== 0) {
        return {
          verified: false,
          rejection_reason: `purchase_state_${data.purchaseState}`,
          is_subscription: false,
          purchase_state: data.purchaseState,
          provider_response: data,
        };
      }

      return {
        verified: true,
        is_subscription: false,
        acknowledgement_state: data.acknowledgementState,
        purchase_state: data.purchaseState,
        period_start: data.purchaseTimeMillis ? new Date(Number(data.purchaseTimeMillis)).toISOString() : undefined,
        provider_response: data,
      };
    }

    // Unknown response format
    return { verified: false, rejection_reason: "unknown_api_response_format", is_subscription: false, provider_response: data };
  }

  return { verified: false, rejection_reason: "purchase_not_found_in_play_api", is_subscription: false };
}

// ── Structural Pre-Validation ────────────────────────────────────

function structuralValidation(payload: GooglePurchasePayload): {
  valid: boolean;
  rejection_reason?: string;
  is_subscription: boolean;
  period_start?: string;
  period_end?: string;
  auto_renew?: boolean;
} {
  const sku = payload.productId || payload.sku || "";
  const token = payload.purchaseToken || payload.token || "";

  if (!sku || !token) {
    return { valid: false, rejection_reason: "missing_sku_or_token", is_subscription: false };
  }

  const packageName = payload.packageName || payload.package_name;
  if (ALLOWED_PACKAGE_NAMES.length > 0 && packageName) {
    if (!ALLOWED_PACKAGE_NAMES.includes(packageName)) {
      return { valid: false, rejection_reason: "invalid_package_name", is_subscription: false };
    }
  }

  if (payload.purchaseState !== undefined) {
    if (payload.purchaseState === 1) return { valid: false, rejection_reason: "purchase_canceled", is_subscription: false };
    if (payload.purchaseState === 2) return { valid: false, rejection_reason: "purchase_pending", is_subscription: false };
    if (payload.purchaseState !== 0) return { valid: false, rejection_reason: "unknown_purchase_state", is_subscription: false };
  }

  if (payload.userCancellationTimeMillis) {
    return { valid: false, rejection_reason: "purchase_user_cancelled", is_subscription: false };
  }

  const isSubscription = !!payload.expiryTimeMillis;
  let periodStart: string | undefined;
  let periodEnd: string | undefined;

  if (payload.purchaseTime) periodStart = new Date(payload.purchaseTime).toISOString();
  if (payload.expiryTimeMillis) {
    periodEnd = new Date(payload.expiryTimeMillis).toISOString();
    if (payload.expiryTimeMillis < Date.now()) {
      return { valid: false, rejection_reason: "subscription_expired", is_subscription: true };
    }
  }

  return { valid: true, is_subscription: isSubscription, period_start: periodStart, period_end: periodEnd, auto_renew: payload.autoRenewing };
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

    // ── Structural pre-validation ────────────────────────────
    const structural = structuralValidation(purchase_payload);
    if (!structural.valid) {
      await sb.from("mobile_store_sync_log").insert({
        store, event_type: "verification_rejected",
        payload_json: { reason: structural.rejection_reason },
        status: "rejected",
      });
      return new Response(
        JSON.stringify({ verified: false, error: `Google verification failed: ${structural.rejection_reason}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const storeSku = String(purchase_payload.productId ?? purchase_payload.sku ?? "");
    const purchaseToken = String(purchase_payload.purchaseToken ?? purchase_payload.token ?? "");
    const orderId = String(purchase_payload.orderId ?? purchase_payload.order_id ?? "");
    const packageName = String(purchase_payload.packageName ?? purchase_payload.package_name ?? "");
    const transactionId = purchaseToken.substring(0, 200);

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
    const isSubscription = storeProduct.store_product_type === "subscription" || structural.is_subscription;

    let learnerIdentityId: string | null = null;
    if (user_id) {
      const { data: liId } = await sb.rpc("ensure_mobile_learner_identity", {
        p_user_id: user_id,
        p_app_account_token: app_account_token || null,
      });
      learnerIdentityId = liId;
    }

    // ── 3. Google Play Developer API verification ────────────
    const serviceAccountJson = Deno.env.get("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON");
    let verificationStatus: string;
    let verificationMethod: string;
    let providerResult: PlayApiVerificationResult | null = null;
    let periodStart = structural.period_start || null;
    let periodEnd = structural.period_end || null;
    let autoRenew = structural.auto_renew ?? null;

    if (serviceAccountJson && packageName) {
      try {
        const sa: ServiceAccountCredentials = JSON.parse(serviceAccountJson);
        const accessToken = await generateGoogleAccessToken(sa);

        providerResult = await verifyViaPlayDeveloperAPI(
          packageName, storeSku, purchaseToken, isSubscription, accessToken
        );

        if (!providerResult.verified) {
          verificationStatus = "rejected";
          verificationMethod = "play_developer_api";

          // Still record the event for audit
          const { data: newEvent } = await sb.from("mobile_store_purchase_events")
            .insert({
              store, external_transaction_id: transactionId,
              external_original_transaction_id: orderId || null,
              store_sku: storeSku, user_id: user_id || null,
              learner_identity_id: learnerIdentityId,
              app_account_token: app_account_token || null,
              raw_payload_json: purchase_payload,
              verification_status: "rejected",
              environment: "production", bundle_id: packageName,
              is_subscription: isSubscription,
              purchase_context: purchaseContext, link_status: linkStatus,
              provider_verification_json: {
                method: "play_developer_api",
                verified: false,
                rejection_reason: providerResult.rejection_reason,
                provider_response: providerResult.provider_response,
              },
            })
            .select("id").single();

          await sb.from("mobile_store_sync_log").insert({
            store, event_type: "provider_rejected",
            payload_json: { reason: providerResult.rejection_reason, purchase_event_id: newEvent?.id },
            status: "rejected",
          });

          return new Response(
            JSON.stringify({
              verified: false,
              error: `Google Play API rejected: ${providerResult.rejection_reason}`,
              verification_method: "play_developer_api",
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Provider verified!
        verificationStatus = "provider_verified";
        verificationMethod = "play_developer_api";

        // Use provider data for periods if available
        if (providerResult.period_start) periodStart = providerResult.period_start;
        if (providerResult.period_end) periodEnd = providerResult.period_end;
        if (providerResult.auto_renew !== undefined) autoRenew = providerResult.auto_renew;

      } catch (apiErr) {
        console.error("Google Play API error", { error: String(apiErr) });
        // HARD FAIL: API error → do NOT grant entitlement
        verificationStatus = "error";
        verificationMethod = "play_developer_api_error";

        const { data: errorEvent } = await sb.from("mobile_store_purchase_events")
          .insert({
            store, external_transaction_id: transactionId,
            external_original_transaction_id: orderId || null,
            store_sku: storeSku, user_id: user_id || null,
            learner_identity_id: learnerIdentityId,
            raw_payload_json: purchase_payload,
            verification_status: "error",
            environment: "production", bundle_id: packageName,
            is_subscription: isSubscription,
            purchase_context: purchaseContext, link_status: linkStatus,
            provider_verification_json: { method: "play_developer_api", error: String(apiErr) },
          })
          .select("id").single();

        return new Response(
          JSON.stringify({
            verified: false,
            error: "Google Play API verification error — purchase recorded for retry",
            purchase_event_id: errorEvent?.id,
            verification_method: "play_developer_api_error",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      // No service account configured → structurally_valid only, NO entitlement
      verificationStatus = "structurally_valid";
      verificationMethod = "structural_only";
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

      if (existingEvent.verification_status === "provider_verified") {
        // Idempotent: update subscription if renewal
        if (isSubscription && periodEnd) {
          await sb.rpc("create_mobile_store_entitlement", {
            p_store: store, p_purchase_event_id: purchaseEventId,
            p_product_id: storeProduct.product_id,
            p_user_id: user_id || null, p_learner_identity_id: learnerIdentityId,
            p_source_ref: orderId || transactionId,
            p_is_subscription: true,
            p_subscription_period_start: periodStart, p_subscription_period_end: periodEnd,
          });
        }

        const { data: existingLink } = await sb
          .from("mobile_store_receipt_links")
          .select("entitlement_id, status")
          .eq("purchase_event_id", purchaseEventId).eq("status", "active").maybeSingle();

        return new Response(
          JSON.stringify({
            verified: true, product_id: storeProduct.product_id,
            entitlement_id: existingLink?.entitlement_id ?? null,
            entitlement_status: existingLink?.status ?? "unknown",
            idempotent: true, verification_method: verificationMethod,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Update to better status
      await sb.from("mobile_store_purchase_events")
        .update({
          verification_status: verificationStatus,
          processed_at: new Date().toISOString(),
          subscription_period_start: periodStart,
          subscription_period_end: periodEnd,
          auto_renew_status: autoRenew,
          provider_verification_json: {
            method: verificationMethod,
            verified: verificationStatus === "provider_verified",
            provider_response: providerResult?.provider_response,
          },
        })
        .eq("id", purchaseEventId);
    } else {
      const { data: newEvent, error: insertErr } = await sb
        .from("mobile_store_purchase_events")
        .insert({
          store, external_transaction_id: transactionId,
          external_original_transaction_id: orderId || null,
          store_sku: storeSku, user_id: user_id || null,
          learner_identity_id: learnerIdentityId,
          app_account_token: app_account_token || null,
          raw_payload_json: purchase_payload,
          verification_status: verificationStatus,
          environment: "production", bundle_id: packageName || null,
          is_subscription: isSubscription,
          subscription_period_start: periodStart,
          subscription_period_end: periodEnd,
          auto_renew_status: autoRenew,
          purchase_context: purchaseContext, link_status: linkStatus,
          provider_verification_json: {
            method: verificationMethod,
            verified: verificationStatus === "provider_verified",
            provider_response: providerResult?.provider_response,
          },
        })
        .select("id").single();

      if (insertErr || !newEvent) {
        console.error("Google verify: insert error", { error: insertErr });
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
          status: verificationStatus, method: verificationMethod,
        },
        status: verificationStatus,
      });

      return new Response(
        JSON.stringify({
          verified: false,
          status: verificationStatus,
          error: verificationStatus === "structurally_valid"
            ? "Google Play Developer API not configured — purchase recorded but no entitlement granted. Configure GOOGLE_PLAY_SERVICE_ACCOUNT_JSON for provider verification."
            : "Provider verification failed",
          purchase_event_id: purchaseEventId,
          verification_method: verificationMethod,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 6. Create entitlement ────────────────────────────────
    const { data: entitlementId, error: entErr } = await sb.rpc(
      "create_mobile_store_entitlement",
      {
        p_store: store, p_purchase_event_id: purchaseEventId,
        p_product_id: storeProduct.product_id,
        p_user_id: user_id || null, p_learner_identity_id: learnerIdentityId,
        p_source_ref: orderId || transactionId,
        p_is_subscription: isSubscription,
        p_subscription_period_start: periodStart,
        p_subscription_period_end: periodEnd,
      }
    );

    if (entErr) {
      console.error("Google verify: entitlement error", { error: entErr });
      return new Response(
        JSON.stringify({ error: "Entitlement creation failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await sb.from("mobile_store_sync_log").insert({
      store, event_type: "purchase_verified",
      payload_json: {
        purchase_event_id: purchaseEventId, entitlement_id: entitlementId,
        store_sku: storeSku, order_id: orderId,
        is_subscription: isSubscription, verification_method: verificationMethod,
        purchase_context: purchaseContext,
      },
      status: "completed",
    });

    return new Response(
      JSON.stringify({
        verified: true, product_id: storeProduct.product_id,
        entitlement_id: entitlementId, entitlement_status: "active",
        is_subscription: isSubscription, subscription_period_end: periodEnd,
        verification_method: verificationMethod,
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
