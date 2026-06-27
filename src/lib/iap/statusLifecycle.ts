/**
 * IAP Status Lifecycle Normalizer — SSOT
 *
 * Pure module — no I/O, no Supabase, no DOM. Used by edge functions
 * (apple-server-notifications, google-rtdn-notifications) to normalize
 * raw store webhook payloads into a stable, auditable lifecycle vocabulary
 * before any DB write.
 *
 * Contract (immutable):
 *   - `store_receipts.status` = receipt lifecycle SSOT
 *   - `entitlements` = access truth layer
 *   - Lifecycle DB writes only via SECURITY DEFINER RPCs
 *     (revoke|suspend|restore)_store_entitlement
 *   - Raw payloads MUST NOT be persisted; only masked + hashed.
 */

export type NormalizedEventType =
  | "purchase_active"
  | "renewal_active"
  | "restored_active"
  | "expired"
  | "cancelled"
  | "refunded"
  | "revoked"
  | "billing_retry"
  | "grace_period"
  | "pending"
  | "unknown";

export type ReceiptStatus =
  | "active"
  | "expired"
  | "cancelled"
  | "refunded"
  | "revoked"
  | "pending"
  | "unknown";

export type EntitlementAction = "none" | "activate" | "restore" | "suspend" | "revoke";

export interface NormalizedLifecycleEvent {
  platform: "ios" | "android";
  storeEventId: string;
  storeEventType: string;
  normalizedEventType: NormalizedEventType;
  transactionId?: string;
  purchaseToken?: string;
  productSku?: string;
  eventAt?: string; // ISO
  expiresAt?: string; // ISO
}

// ---------- Apple ASSN v2 ----------

const APPLE_MAP: Record<string, NormalizedEventType> = {
  SUBSCRIBED: "purchase_active",
  DID_RENEW: "renewal_active",
  DID_RECOVER: "restored_active",
  EXPIRED: "expired",
  GRACE_PERIOD_EXPIRED: "expired",
  REFUND: "refunded",
  REVOKE: "revoked",
  DID_FAIL_TO_RENEW: "billing_retry",
  // OFFER_REDEEMED / PRICE_INCREASE / DID_CHANGE_RENEWAL_* are commercial-only,
  // not lifecycle access events → unknown (no access change).
};

export function normalizeAppleAssnV2Event(input: {
  notificationUUID?: string;
  notificationType?: string;
  subtype?: string | null;
  transactionId?: string;
  originalTransactionId?: string;
  productId?: string;
  expiresDate?: number; // ms epoch
  purchaseDate?: number;
  signedDate?: number;
}): NormalizedLifecycleEvent | null {
  if (!input.notificationUUID || !input.notificationType) return null;
  let kind = APPLE_MAP[input.notificationType] ?? "unknown";
  if (input.notificationType === "DID_FAIL_TO_RENEW" && input.subtype === "GRACE_PERIOD") {
    kind = "grace_period";
  }
  return {
    platform: "ios",
    storeEventId: input.notificationUUID,
    storeEventType: input.notificationType,
    normalizedEventType: kind,
    transactionId: input.transactionId ?? input.originalTransactionId,
    productSku: input.productId,
    eventAt: input.signedDate ? new Date(input.signedDate).toISOString() : undefined,
    expiresAt: input.expiresDate ? new Date(input.expiresDate).toISOString() : undefined,
  };
}

// ---------- Google RTDN ----------

const GOOGLE_SUB_MAP: Record<number, NormalizedEventType> = {
  1: "restored_active", // SUBSCRIPTION_RECOVERED
  2: "renewal_active", // SUBSCRIPTION_RENEWED
  3: "cancelled", // SUBSCRIPTION_CANCELED (still has access until expiry; status flips at EXPIRED)
  4: "purchase_active", // SUBSCRIPTION_PURCHASED
  5: "billing_retry", // SUBSCRIPTION_ON_HOLD
  6: "grace_period", // SUBSCRIPTION_IN_GRACE_PERIOD
  7: "restored_active", // SUBSCRIPTION_RESTARTED
  12: "revoked", // SUBSCRIPTION_REVOKED (refund)
  13: "expired", // SUBSCRIPTION_EXPIRED
  20: "cancelled", // SUBSCRIPTION_PENDING_PURCHASE_CANCELED
};

const GOOGLE_OTP_MAP: Record<number, NormalizedEventType> = {
  1: "purchase_active", // ONE_TIME_PRODUCT_PURCHASED
  2: "cancelled", // ONE_TIME_PRODUCT_CANCELED (pending cancel)
};

export function normalizeGoogleRtdnEvent(input: {
  messageId?: string;
  eventTimeMillis?: string | number;
  subscriptionNotification?: { notificationType: number; purchaseToken: string; subscriptionId: string };
  oneTimeProductNotification?: { notificationType: number; purchaseToken: string; sku: string };
  voidedPurchaseNotification?: { purchaseToken: string; orderId?: string };
}): NormalizedLifecycleEvent | null {
  if (!input.messageId) return null;
  const eventAt = input.eventTimeMillis
    ? new Date(Number(input.eventTimeMillis)).toISOString()
    : undefined;

  if (input.voidedPurchaseNotification) {
    return {
      platform: "android",
      storeEventId: input.messageId,
      storeEventType: "VOIDED_PURCHASE",
      normalizedEventType: "refunded",
      purchaseToken: input.voidedPurchaseNotification.purchaseToken,
      transactionId: input.voidedPurchaseNotification.orderId,
      eventAt,
    };
  }
  if (input.subscriptionNotification) {
    const n = input.subscriptionNotification;
    return {
      platform: "android",
      storeEventId: input.messageId,
      storeEventType: `SUBSCRIPTION_${n.notificationType}`,
      normalizedEventType: GOOGLE_SUB_MAP[n.notificationType] ?? "unknown",
      purchaseToken: n.purchaseToken,
      productSku: n.subscriptionId,
      eventAt,
    };
  }
  if (input.oneTimeProductNotification) {
    const n = input.oneTimeProductNotification;
    return {
      platform: "android",
      storeEventId: input.messageId,
      storeEventType: `ONE_TIME_${n.notificationType}`,
      normalizedEventType: GOOGLE_OTP_MAP[n.notificationType] ?? "unknown",
      purchaseToken: n.purchaseToken,
      productSku: n.sku,
      eventAt,
    };
  }
  return null;
}

// ---------- Mapping helpers ----------

export function mapLifecycleEventToReceiptStatus(e: NormalizedEventType): ReceiptStatus {
  switch (e) {
    case "purchase_active":
    case "renewal_active":
    case "restored_active":
      return "active";
    case "expired":
      return "expired";
    case "cancelled":
      return "cancelled";
    case "refunded":
      return "refunded";
    case "revoked":
      return "revoked";
    case "billing_retry":
    case "grace_period":
      return "active"; // remains accessible until expiry policy fires
    case "pending":
      return "pending";
    default:
      return "unknown";
  }
}

export function mapLifecycleEventToEntitlementAction(
  e: NormalizedEventType,
): EntitlementAction {
  switch (e) {
    case "purchase_active":
      return "activate";
    case "renewal_active":
    case "restored_active":
      return "restore";
    case "expired":
      return "suspend";
    case "cancelled":
      return "none"; // user cancelled future renewal; access until expiry
    case "refunded":
    case "revoked":
      return "revoke";
    case "billing_retry":
    case "grace_period":
      return "none";
    case "pending":
    case "unknown":
    default:
      return "none";
  }
}

export function isLifecycleEventTerminal(e: NormalizedEventType): boolean {
  return e === "refunded" || e === "revoked" || e === "expired";
}

/**
 * Out-of-order protection. Returns true if the incoming event is older than
 * or equal to what we already processed for the same receipt and should be ignored.
 */
export function shouldIgnoreOlderEvent(
  existing: { last_store_event_at?: string | null } | null,
  incoming: { eventAt?: string },
): boolean {
  if (!existing?.last_store_event_at || !incoming.eventAt) return false;
  return new Date(incoming.eventAt).getTime() < new Date(existing.last_store_event_at).getTime();
}

// ---------- Payload safety ----------

/** Strip raw signed/JWS payload before any logging. Keeps only safe identifiers. */
export function maskStoreEventPayload(input: Record<string, unknown>): Record<string, unknown> {
  const SAFE_KEYS = new Set([
    "notificationType",
    "notificationUUID",
    "subtype",
    "messageId",
    "publishTime",
    "transactionId",
    "originalTransactionId",
    "productId",
    "subscriptionId",
    "sku",
    "purchaseToken",
    "bundleId",
    "environment",
    "expiresDate",
    "signedDate",
    "eventTimeMillis",
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (SAFE_KEYS.has(k)) out[k] = v;
  }
  return out;
}

/** SHA-256 hex hash of any payload — for audit traceability without storing PII. */
export async function hashStoreEventPayload(input: unknown): Promise<string> {
  const enc = new TextEncoder().encode(JSON.stringify(input));
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
