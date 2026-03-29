import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Apple App Store Server Notifications v2
 *
 * Handles real-time notifications from Apple for:
 * - Subscription renewals (DID_RENEW)
 * - Subscription expirations (EXPIRED)
 * - Refunds (REFUND)
 * - Revocations (REVOKE)
 * - Grace period events (GRACE_PERIOD_EXPIRED)
 * - Billing retry (DID_FAIL_TO_RENEW, DID_RECOVER)
 * - Subscription offers (OFFER_REDEEMED)
 * - Price increase consent (PRICE_INCREASE)
 *
 * All notifications arrive as signed JWS (signedPayload).
 * We verify cryptographically against Apple JWKS before processing.
 */

// ── Apple JWKS (reuse same approach as verify-apple-purchase) ────

const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
const ALLOWED_BUNDLE_IDS = (Deno.env.get("APPLE_ALLOWED_BUNDLE_IDS") || "")
  .split(",").map(s => s.trim()).filter(Boolean);
const APPLE_ENVIRONMENT = Deno.env.get("APPLE_ENVIRONMENT") || "production";

interface JWKSKey {
  kty: string; kid: string; use: string; alg: string;
  n?: string; e?: string; x?: string; y?: string;
}

let jwksCache: { keys: JWKSKey[]; fetchedAt: number } | null = null;
const JWKS_CACHE_TTL_MS = 3600_000;

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

function base64urlToUint8Array(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

/**
 * Verify and decode an Apple signed JWS payload.
 * Returns null on verification failure (HARD FAIL).
 */
async function verifyAndDecodeJWS(jws: string): Promise<Record<string, unknown> | null> {
  const parts = jws.split(".");
  if (parts.length !== 3) return null;

  let header: { kid?: string; alg?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(atob(parts[0].replace(/-/g, "+").replace(/_/g, "/")));
    payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }

  if (!header.kid) return null;

  try {
    const jwks = await fetchAppleJWKS();
    const key = jwks.find(k => k.kid === header.kid);
    if (!key) return null;

    const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signature = base64urlToUint8Array(parts[2]);

    let cryptoKey: CryptoKey;
    let algorithm: AlgorithmIdentifier | RsaPssParams | EcdsaParams;

    if (key.kty === "RSA") {
      cryptoKey = await crypto.subtle.importKey(
        "jwk", { kty: key.kty, n: key.n, e: key.e, alg: "RS256", ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
      );
      algorithm = "RSASSA-PKCS1-v1_5";
    } else if (key.kty === "EC") {
      cryptoKey = await crypto.subtle.importKey(
        "jwk", { kty: "EC", crv: "P-256", x: key.x, y: key.y, ext: true },
        { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]
      );
      algorithm = { name: "ECDSA", hash: "SHA-256" };
    } else {
      return null;
    }

    const valid = await crypto.subtle.verify(algorithm, cryptoKey, signature, signedData);
    return valid ? payload : null;
  } catch (err) {
    console.error("JWKS verification error", { error: String(err) });
    return null;
  }
}

// ── Notification Type Handlers ───────────────────────────────────

type NotificationType =
  | "DID_RENEW" | "EXPIRED" | "REFUND" | "REVOKE"
  | "GRACE_PERIOD_EXPIRED" | "DID_FAIL_TO_RENEW" | "DID_RECOVER"
  | "DID_CHANGE_RENEWAL_STATUS" | "DID_CHANGE_RENEWAL_PREF"
  | "OFFER_REDEEMED" | "PRICE_INCREASE" | "SUBSCRIBED"
  | "CONSUMPTION_REQUEST" | "TEST";

interface TransactionInfo {
  transactionId?: string;
  originalTransactionId?: string;
  productId?: string;
  bundleId?: string;
  environment?: string;
  expiresDate?: number;
  purchaseDate?: number;
  revocationDate?: number;
  revocationReason?: number;
  type?: string;
  appAccountToken?: string;
}

interface RenewalInfo {
  autoRenewStatus?: number;
  autoRenewProductId?: string;
  expirationIntent?: number;
  gracePeriodExpiresDate?: number;
  isInBillingRetryPeriod?: boolean;
  priceIncreaseStatus?: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json();

    // Apple sends { signedPayload: "..." }
    const signedPayload = body.signedPayload;
    if (!signedPayload || typeof signedPayload !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing signedPayload" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 1. Verify outer notification JWS ─────────────────────
    const notification = await verifyAndDecodeJWS(signedPayload);
    if (!notification) {
      await sb.from("mobile_store_sync_log").insert({
        store: "apple", event_type: "webhook_signature_failed",
        payload_json: { error: "JWS verification failed" },
        status: "rejected",
      });
      // Return 200 to Apple so they don't retry invalid payloads
      return new Response(JSON.stringify({ ok: false }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const notificationType = notification.notificationType as NotificationType;
    const subtype = (notification.subtype as string) || null;

    // ── 2. Decode inner signed transaction ───────────────────
    const signedTransactionInfo = (notification.data as Record<string, unknown>)?.signedTransactionInfo as string | undefined;
    const signedRenewalInfo = (notification.data as Record<string, unknown>)?.signedRenewalInfo as string | undefined;

    let txInfo: TransactionInfo | null = null;
    let renewalInfo: RenewalInfo | null = null;

    if (signedTransactionInfo) {
      const decoded = await verifyAndDecodeJWS(signedTransactionInfo);
      if (decoded) txInfo = decoded as unknown as TransactionInfo;
    }

    if (signedRenewalInfo) {
      const decoded = await verifyAndDecodeJWS(signedRenewalInfo);
      if (decoded) renewalInfo = decoded as unknown as RenewalInfo;
    }

    if (!txInfo?.transactionId) {
      await sb.from("mobile_store_sync_log").insert({
        store: "apple", event_type: "webhook_no_transaction",
        payload_json: { notificationType, subtype },
        status: "skipped",
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 3. Bundle ID validation ──────────────────────────────
    if (ALLOWED_BUNDLE_IDS.length > 0 && txInfo.bundleId) {
      if (!ALLOWED_BUNDLE_IDS.includes(txInfo.bundleId)) {
        await sb.from("mobile_store_sync_log").insert({
          store: "apple", event_type: "webhook_invalid_bundle",
          payload_json: { bundleId: txInfo.bundleId, notificationType },
          status: "rejected",
        });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ── 4. Environment validation ────────────────────────────
    if (txInfo.environment && APPLE_ENVIRONMENT === "production") {
      if (txInfo.environment !== "Production") {
        await sb.from("mobile_store_sync_log").insert({
          store: "apple", event_type: "webhook_env_mismatch",
          payload_json: { environment: txInfo.environment, notificationType },
          status: "skipped",
        });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ── 5. Find existing purchase event ──────────────────────
    const transactionId = String(txInfo.transactionId);
    const { data: existingEvent } = await sb
      .from("mobile_store_purchase_events")
      .select("id, verification_status, user_id, learner_identity_id, store_sku, is_subscription")
      .eq("store", "apple")
      .eq("external_transaction_id", transactionId)
      .maybeSingle();

    // ── 6. Process by notification type ──────────────────────
    const results: Record<string, unknown> = {
      notificationType, subtype, transactionId,
      processed: false,
    };

    switch (notificationType) {
      // ── REFUND ─────────────────────────────────────────────
      case "REFUND": {
        if (existingEvent) {
          // Update purchase event status
          await sb.from("mobile_store_purchase_events")
            .update({
              verification_status: "refunded",
              processed_at: new Date().toISOString(),
            })
            .eq("id", existingEvent.id);

          // Revoke entitlement via receipt link
          const { data: links } = await sb
            .from("mobile_store_receipt_links")
            .select("id, entitlement_id")
            .eq("purchase_event_id", existingEvent.id)
            .eq("status", "active");

          for (const link of (links || [])) {
            await sb.from("mobile_store_receipt_links")
              .update({ status: "refunded", verified_at: new Date().toISOString() })
              .eq("id", link.id);

            if (link.entitlement_id) {
              await sb.from("entitlements")
                .update({ status: "revoked" })
                .eq("id", link.entitlement_id);
            }
          }

          results.processed = true;
          results.entitlements_revoked = links?.length ?? 0;
        }
        break;
      }

      // ── REVOKE ─────────────────────────────────────────────
      case "REVOKE": {
        if (existingEvent) {
          await sb.from("mobile_store_purchase_events")
            .update({
              verification_status: "refunded",
              processed_at: new Date().toISOString(),
            })
            .eq("id", existingEvent.id);

          const { data: links } = await sb
            .from("mobile_store_receipt_links")
            .select("id, entitlement_id")
            .eq("purchase_event_id", existingEvent.id)
            .eq("status", "active");

          for (const link of (links || [])) {
            await sb.from("mobile_store_receipt_links")
              .update({ status: "revoked", verified_at: new Date().toISOString() })
              .eq("id", link.id);

            if (link.entitlement_id) {
              await sb.from("entitlements")
                .update({ status: "revoked" })
                .eq("id", link.entitlement_id);
            }
          }

          results.processed = true;
        }
        break;
      }

      // ── EXPIRED / GRACE_PERIOD_EXPIRED ─────────────────────
      case "EXPIRED":
      case "GRACE_PERIOD_EXPIRED": {
        if (existingEvent) {
          await sb.from("mobile_store_purchase_events")
            .update({
              verification_status: "expired",
              processed_at: new Date().toISOString(),
              auto_renew_status: false,
            })
            .eq("id", existingEvent.id);

          // Expire entitlements
          const { data: links } = await sb
            .from("mobile_store_receipt_links")
            .select("id, entitlement_id")
            .eq("purchase_event_id", existingEvent.id)
            .eq("status", "active");

          for (const link of (links || [])) {
            await sb.from("mobile_store_receipt_links")
              .update({ status: "expired", verified_at: new Date().toISOString() })
              .eq("id", link.id);

            if (link.entitlement_id) {
              await sb.from("entitlements")
                .update({ status: "expired" })
                .eq("id", link.entitlement_id);
            }
          }

          results.processed = true;
        }
        break;
      }

      // ── DID_RENEW ──────────────────────────────────────────
      case "DID_RENEW": {
        if (existingEvent) {
          const newPeriodEnd = txInfo.expiresDate
            ? new Date(txInfo.expiresDate).toISOString() : null;

          // Update period on purchase event
          await sb.from("mobile_store_purchase_events")
            .update({
              subscription_period_end: newPeriodEnd,
              auto_renew_status: renewalInfo?.autoRenewStatus === 1,
              processed_at: new Date().toISOString(),
            })
            .eq("id", existingEvent.id);

          // Update receipt link renewal tracking
          await sb.from("mobile_store_receipt_links")
            .update({
              subscription_period_end: newPeriodEnd,
              last_renewal_at: new Date().toISOString(),
              auto_renew_status: renewalInfo?.autoRenewStatus === 1,
            })
            .eq("purchase_event_id", existingEvent.id)
            .eq("status", "active");

          // Extend entitlement valid_until
          const { data: links } = await sb
            .from("mobile_store_receipt_links")
            .select("entitlement_id")
            .eq("purchase_event_id", existingEvent.id)
            .eq("status", "active");

          for (const link of (links || [])) {
            if (link.entitlement_id && newPeriodEnd) {
              await sb.from("entitlements")
                .update({ valid_until: newPeriodEnd, status: "active" })
                .eq("id", link.entitlement_id);
            }
          }

          results.processed = true;
          results.new_period_end = newPeriodEnd;
        }
        break;
      }

      // ── DID_RECOVER (billing retry succeeded) ──────────────
      case "DID_RECOVER": {
        if (existingEvent) {
          const newPeriodEnd = txInfo.expiresDate
            ? new Date(txInfo.expiresDate).toISOString() : null;

          await sb.from("mobile_store_purchase_events")
            .update({
              verification_status: "provider_verified",
              subscription_period_end: newPeriodEnd,
              processed_at: new Date().toISOString(),
            })
            .eq("id", existingEvent.id);

          // Reactivate entitlements
          const { data: links } = await sb
            .from("mobile_store_receipt_links")
            .select("entitlement_id")
            .eq("purchase_event_id", existingEvent.id);

          for (const link of (links || [])) {
            if (link.entitlement_id) {
              await sb.from("entitlements")
                .update({ valid_until: newPeriodEnd, status: "active" })
                .eq("id", link.entitlement_id);
            }
          }

          results.processed = true;
        }
        break;
      }

      // ── DID_FAIL_TO_RENEW ──────────────────────────────────
      case "DID_FAIL_TO_RENEW": {
        if (existingEvent) {
          await sb.from("mobile_store_purchase_events")
            .update({
              auto_renew_status: false,
              processed_at: new Date().toISOString(),
            })
            .eq("id", existingEvent.id);

          results.processed = true;
          results.grace_period = subtype === "GRACE_PERIOD";
        }
        break;
      }

      // ── DID_CHANGE_RENEWAL_STATUS ──────────────────────────
      case "DID_CHANGE_RENEWAL_STATUS": {
        if (existingEvent) {
          const autoRenew = renewalInfo?.autoRenewStatus === 1;
          await sb.from("mobile_store_purchase_events")
            .update({
              auto_renew_status: autoRenew,
              processed_at: new Date().toISOString(),
            })
            .eq("id", existingEvent.id);

          await sb.from("mobile_store_receipt_links")
            .update({ auto_renew_status: autoRenew })
            .eq("purchase_event_id", existingEvent.id)
            .eq("status", "active");

          results.processed = true;
          results.auto_renew = autoRenew;
        }
        break;
      }

      // ── TEST notification ──────────────────────────────────
      case "TEST": {
        results.processed = true;
        results.test = true;
        break;
      }

      default: {
        // Log unhandled types for future implementation
        results.unhandled = true;
        break;
      }
    }

    // ── 7. Log webhook event ─────────────────────────────────
    await sb.from("mobile_store_sync_log").insert({
      store: "apple",
      event_type: `webhook_${notificationType.toLowerCase()}`,
      payload_json: {
        ...results,
        original_transaction_id: txInfo.originalTransactionId,
        product_id: txInfo.productId,
        purchase_event_id: existingEvent?.id,
      },
      status: results.processed ? "completed" : "skipped",
    });

    // Always return 200 to Apple
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Apple webhook error:", err);
    return new Response(JSON.stringify({ ok: false }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
