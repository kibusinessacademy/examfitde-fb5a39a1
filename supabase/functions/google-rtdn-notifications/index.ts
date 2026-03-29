import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Google Real-Time Developer Notifications (RTDN)
 *
 * Handles Pub/Sub push messages from Google Play for:
 * - Subscription state changes (renewals, cancellations, expirations, revocations)
 * - One-time purchase updates (refunds, revocations)
 *
 * Google sends:
 * {
 *   message: {
 *     data: "<base64>",  // base64-encoded DeveloperNotification JSON
 *     messageId: "...",
 *     publishTime: "..."
 *   },
 *   subscription: "projects/.../subscriptions/..."
 * }
 *
 * After decoding, the DeveloperNotification contains:
 * - subscriptionNotification (for subscriptions)
 * - oneTimeProductNotification (for one-time purchases)
 * - voidedPurchaseNotification (for voided purchases)
 * - testNotification (for test pings)
 */

const ALLOWED_PACKAGE_NAMES = (Deno.env.get("GOOGLE_ALLOWED_PACKAGE_NAMES") || "")
  .split(",").map(s => s.trim()).filter(Boolean);

// Google subscription notification types
const SUBSCRIPTION_NOTIFICATION_TYPES: Record<number, string> = {
  1: "SUBSCRIPTION_RECOVERED",      // recovered from account hold
  2: "SUBSCRIPTION_RENEWED",        // active subscription renewed
  3: "SUBSCRIPTION_CANCELED",       // user canceled voluntarily
  4: "SUBSCRIPTION_PURCHASED",      // new subscription purchased
  5: "SUBSCRIPTION_ON_HOLD",        // billing retry
  6: "SUBSCRIPTION_IN_GRACE_PERIOD",
  7: "SUBSCRIPTION_RESTARTED",      // user re-enabled after cancel
  8: "SUBSCRIPTION_PRICE_CHANGE_CONFIRMED",
  9: "SUBSCRIPTION_DEFERRED",
  10: "SUBSCRIPTION_PAUSED",
  11: "SUBSCRIPTION_PAUSE_SCHEDULE_CHANGED",
  12: "SUBSCRIPTION_REVOKED",       // user revoked (refund)
  13: "SUBSCRIPTION_EXPIRED",
  20: "SUBSCRIPTION_PENDING_PURCHASE_CANCELED",
};

// One-time product notification types
const ONETIMEPRODUCT_NOTIFICATION_TYPES: Record<number, string> = {
  1: "ONE_TIME_PRODUCT_PURCHASED",
  2: "ONE_TIME_PRODUCT_CANCELED",  // pending purchase canceled
};

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  token_uri: string;
}

function base64urlEncode(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── Google OAuth2 (reused from verify-google-purchase) ───────────

async function generateGoogleAccessToken(sa: ServiceAccountCredentials): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: sa.token_uri || "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  };

  const eh = base64urlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const ep = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signInput = `${eh}.${ep}`;

  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const keyData = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );

  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(signInput)
  );

  const jwt = `${signInput}.${base64urlEncode(new Uint8Array(sig))}`;

  const res = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google OAuth2 token error: ${res.status} ${errText}`);
  }

  const data = await res.json();
  return data.access_token;
}

// ── Helpers ──────────────────────────────────────────────────────

async function fetchSubscriptionState(
  packageName: string, token: string, accessToken: string
): Promise<Record<string, unknown> | null> {
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/subscriptionsv2/tokens/${token}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    console.error("Google sub API error", { status: res.status, body: text });
    return null;
  }
  return res.json();
}

async function revokeEntitlementsForEvent(
  sb: ReturnType<typeof createClient>,
  eventId: string,
  newReceiptStatus: string,
  newEntitlementStatus: string
): Promise<number> {
  const { data: links } = await sb
    .from("mobile_store_receipt_links")
    .select("id, entitlement_id")
    .eq("purchase_event_id", eventId)
    .eq("status", "active");

  let count = 0;
  for (const link of (links || [])) {
    await sb.from("mobile_store_receipt_links")
      .update({ status: newReceiptStatus, verified_at: new Date().toISOString() })
      .eq("id", link.id);

    if (link.entitlement_id) {
      await sb.from("entitlements")
        .update({ status: newEntitlementStatus })
        .eq("id", link.entitlement_id);
      count++;
    }
  }
  return count;
}

// ── Main Handler ─────────────────────────────────────────────────

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

    // ── 1. Decode Pub/Sub message ────────────────────────────
    const messageData = body.message?.data;
    if (!messageData) {
      return new Response(JSON.stringify({ error: "Missing message.data" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let notification: Record<string, unknown>;
    try {
      const decoded = atob(messageData);
      notification = JSON.parse(decoded);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid base64/JSON in message.data" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const packageName = notification.packageName as string;

    // ── 2. Package name validation ───────────────────────────
    if (ALLOWED_PACKAGE_NAMES.length > 0 && packageName) {
      if (!ALLOWED_PACKAGE_NAMES.includes(packageName)) {
        await sb.from("mobile_store_sync_log").insert({
          store: "google", event_type: "webhook_invalid_package",
          payload_json: { packageName },
          status: "rejected",
        });
        // Acknowledge to stop retries
        return new Response(JSON.stringify({ ok: true }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ── 3. Test notification ─────────────────────────────────
    if (notification.testNotification) {
      await sb.from("mobile_store_sync_log").insert({
        store: "google", event_type: "webhook_test",
        payload_json: notification,
        status: "completed",
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: Record<string, unknown> = { packageName, processed: false };

    // ── 4. Subscription notifications ────────────────────────
    const subNotif = notification.subscriptionNotification as Record<string, unknown> | undefined;
    if (subNotif) {
      const notifType = subNotif.notificationType as number;
      const typeName = SUBSCRIPTION_NOTIFICATION_TYPES[notifType] || `UNKNOWN_${notifType}`;
      const purchaseToken = subNotif.purchaseToken as string;
      const subscriptionId = subNotif.subscriptionId as string;

      results.type = typeName;
      results.subscriptionId = subscriptionId;

      // Find purchase event by token (stored as external_transaction_id)
      const tokenKey = purchaseToken?.substring(0, 200) || "";
      const { data: existingEvent } = await sb
        .from("mobile_store_purchase_events")
        .select("id, verification_status, user_id, learner_identity_id, store_sku")
        .eq("store", "google")
        .eq("external_transaction_id", tokenKey)
        .maybeSingle();

      if (!existingEvent) {
        // Purchase not in our system — log and skip
        await sb.from("mobile_store_sync_log").insert({
          store: "google", event_type: `webhook_${typeName.toLowerCase()}`,
          payload_json: { ...results, error: "purchase_event_not_found" },
          status: "skipped",
        });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      results.purchase_event_id = existingEvent.id;

      switch (notifType) {
        // ── RENEWED / RECOVERED / RESTARTED ──────────────────
        case 1: // RECOVERED
        case 2: // RENEWED
        case 7: // RESTARTED
        {
          // Fetch latest subscription state from API for accurate period
          let newPeriodEnd: string | null = null;
          let autoRenew: boolean | null = null;

          const saJson = Deno.env.get("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON");
          if (saJson && packageName && purchaseToken) {
            try {
              const sa: ServiceAccountCredentials = JSON.parse(saJson);
              const accessToken = await generateGoogleAccessToken(sa);
              const subState = await fetchSubscriptionState(packageName, purchaseToken, accessToken);

              if (subState) {
                const lineItem = (subState.lineItems as Record<string, unknown>[])?.[0];
                newPeriodEnd = (lineItem?.expiryTime || subState.expiryTime) as string || null;
                autoRenew = (lineItem as Record<string, unknown>)?.autoRenewingPlan
                  ? ((lineItem as Record<string, unknown>).autoRenewingPlan as Record<string, unknown>)?.autoRenewEnabled as boolean
                  : null;
              }
            } catch (e) {
              console.error("RTDN: failed to fetch sub state", { error: String(e) });
            }
          }

          await sb.from("mobile_store_purchase_events")
            .update({
              verification_status: "provider_verified",
              subscription_period_end: newPeriodEnd,
              auto_renew_status: autoRenew,
              processed_at: new Date().toISOString(),
            })
            .eq("id", existingEvent.id);

          // Update/reactivate entitlements
          const { data: links } = await sb
            .from("mobile_store_receipt_links")
            .select("entitlement_id")
            .eq("purchase_event_id", existingEvent.id);

          for (const link of (links || [])) {
            if (link.entitlement_id && newPeriodEnd) {
              await sb.from("entitlements")
                .update({ valid_until: newPeriodEnd, status: "active" })
                .eq("id", link.entitlement_id);
            }
          }

          await sb.from("mobile_store_receipt_links")
            .update({
              subscription_period_end: newPeriodEnd,
              last_renewal_at: new Date().toISOString(),
              auto_renew_status: autoRenew,
            })
            .eq("purchase_event_id", existingEvent.id)
            .eq("status", "active");

          results.processed = true;
          results.new_period_end = newPeriodEnd;
          break;
        }

        // ── CANCELED ─────────────────────────────────────────
        case 3: // CANCELED
        {
          await sb.from("mobile_store_purchase_events")
            .update({
              auto_renew_status: false,
              processed_at: new Date().toISOString(),
            })
            .eq("id", existingEvent.id);

          await sb.from("mobile_store_receipt_links")
            .update({ auto_renew_status: false })
            .eq("purchase_event_id", existingEvent.id)
            .eq("status", "active");

          // Don't revoke immediately — subscription remains until period end
          results.processed = true;
          results.note = "auto_renew disabled, access until period_end";
          break;
        }

        // ── REVOKED ──────────────────────────────────────────
        case 12: // REVOKED (refund)
        {
          await sb.from("mobile_store_purchase_events")
            .update({
              verification_status: "refunded",
              processed_at: new Date().toISOString(),
            })
            .eq("id", existingEvent.id);

          const revokedCount = await revokeEntitlementsForEvent(
            sb, existingEvent.id, "refunded", "revoked"
          );

          results.processed = true;
          results.entitlements_revoked = revokedCount;
          break;
        }

        // ── EXPIRED ──────────────────────────────────────────
        case 13: // EXPIRED
        {
          await sb.from("mobile_store_purchase_events")
            .update({
              verification_status: "expired",
              auto_renew_status: false,
              processed_at: new Date().toISOString(),
            })
            .eq("id", existingEvent.id);

          const expiredCount = await revokeEntitlementsForEvent(
            sb, existingEvent.id, "expired", "expired"
          );

          results.processed = true;
          results.entitlements_expired = expiredCount;
          break;
        }

        // ── ON_HOLD / GRACE_PERIOD ───────────────────────────
        case 5: // ON_HOLD
        case 6: // IN_GRACE_PERIOD
        {
          await sb.from("mobile_store_purchase_events")
            .update({
              auto_renew_status: true, // still trying to renew
              processed_at: new Date().toISOString(),
            })
            .eq("id", existingEvent.id);

          results.processed = true;
          results.billing_retry = true;
          break;
        }

        // ── PAUSED ───────────────────────────────────────────
        case 10: // PAUSED
        {
          await sb.from("mobile_store_purchase_events")
            .update({
              auto_renew_status: false,
              processed_at: new Date().toISOString(),
            })
            .eq("id", existingEvent.id);

          results.processed = true;
          break;
        }

        default:
          results.unhandled = true;
      }

      await sb.from("mobile_store_sync_log").insert({
        store: "google",
        event_type: `webhook_${typeName.toLowerCase()}`,
        payload_json: results,
        status: results.processed ? "completed" : "skipped",
      });
    }

    // ── 5. Voided purchase notifications ─────────────────────
    const voidedNotif = notification.voidedPurchaseNotification as Record<string, unknown> | undefined;
    if (voidedNotif) {
      const purchaseToken = voidedNotif.purchaseToken as string;
      const tokenKey = purchaseToken?.substring(0, 200) || "";

      const { data: existingEvent } = await sb
        .from("mobile_store_purchase_events")
        .select("id")
        .eq("store", "google")
        .eq("external_transaction_id", tokenKey)
        .maybeSingle();

      if (existingEvent) {
        await sb.from("mobile_store_purchase_events")
          .update({
            verification_status: "refunded",
            processed_at: new Date().toISOString(),
          })
          .eq("id", existingEvent.id);

        await revokeEntitlementsForEvent(sb, existingEvent.id, "refunded", "revoked");
        results.voided = true;
        results.processed = true;
      }

      await sb.from("mobile_store_sync_log").insert({
        store: "google",
        event_type: "webhook_voided_purchase",
        payload_json: { ...results, purchase_event_id: existingEvent?.id },
        status: existingEvent ? "completed" : "skipped",
      });
    }

    // ── 6. One-time product notifications ────────────────────
    const otpNotif = notification.oneTimeProductNotification as Record<string, unknown> | undefined;
    if (otpNotif) {
      const notifType = otpNotif.notificationType as number;
      const typeName = ONETIMEPRODUCT_NOTIFICATION_TYPES[notifType] || `UNKNOWN_OTP_${notifType}`;

      await sb.from("mobile_store_sync_log").insert({
        store: "google",
        event_type: `webhook_${typeName.toLowerCase()}`,
        payload_json: { ...otpNotif, packageName },
        status: "completed",
      });

      results.otp_type = typeName;
      results.processed = true;
    }

    // Acknowledge the Pub/Sub message
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Google RTDN webhook error:", err);
    // Return 200 to avoid infinite retries on persistent errors
    return new Response(JSON.stringify({ ok: false }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
