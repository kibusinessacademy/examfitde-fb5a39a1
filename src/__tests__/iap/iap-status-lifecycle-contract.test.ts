/**
 * IAP Status Lifecycle — Normalizer contract tests.
 * Pure unit tests; no DB. Validates the SSOT contract before any webhook write.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeAppleAssnV2Event,
  normalizeGoogleRtdnEvent,
  mapLifecycleEventToReceiptStatus,
  mapLifecycleEventToEntitlementAction,
  isLifecycleEventTerminal,
  shouldIgnoreOlderEvent,
  maskStoreEventPayload,
  hashStoreEventPayload,
} from "@/lib/iap/statusLifecycle";

describe("IAP Status Lifecycle — Apple ASSN v2", () => {
  it("REFUND → refunded + revoke", () => {
    const e = normalizeAppleAssnV2Event({
      notificationUUID: "uuid-1",
      notificationType: "REFUND",
      transactionId: "tx-1",
      productId: "sku.x",
      signedDate: 1700000000000,
    })!;
    expect(e.normalizedEventType).toBe("refunded");
    expect(mapLifecycleEventToReceiptStatus(e.normalizedEventType)).toBe("refunded");
    expect(mapLifecycleEventToEntitlementAction(e.normalizedEventType)).toBe("revoke");
    expect(isLifecycleEventTerminal(e.normalizedEventType)).toBe(true);
  });

  it("REVOKE → revoked + revoke action", () => {
    const e = normalizeAppleAssnV2Event({
      notificationUUID: "uuid-2", notificationType: "REVOKE", transactionId: "t",
    })!;
    expect(e.normalizedEventType).toBe("revoked");
    expect(mapLifecycleEventToEntitlementAction(e.normalizedEventType)).toBe("revoke");
  });

  it("DID_RENEW → renewal_active + restore", () => {
    const e = normalizeAppleAssnV2Event({
      notificationUUID: "uuid-3", notificationType: "DID_RENEW",
      transactionId: "t", expiresDate: 1800000000000,
    })!;
    expect(e.normalizedEventType).toBe("renewal_active");
    expect(mapLifecycleEventToReceiptStatus(e.normalizedEventType)).toBe("active");
    expect(mapLifecycleEventToEntitlementAction(e.normalizedEventType)).toBe("restore");
    expect(e.expiresAt).toBeTruthy();
  });

  it("EXPIRED → expired + suspend", () => {
    const e = normalizeAppleAssnV2Event({
      notificationUUID: "u4", notificationType: "EXPIRED", transactionId: "t",
    })!;
    expect(e.normalizedEventType).toBe("expired");
    expect(mapLifecycleEventToEntitlementAction(e.normalizedEventType)).toBe("suspend");
  });

  it("DID_FAIL_TO_RENEW + GRACE_PERIOD → grace_period, no access change", () => {
    const e = normalizeAppleAssnV2Event({
      notificationUUID: "u5", notificationType: "DID_FAIL_TO_RENEW",
      subtype: "GRACE_PERIOD", transactionId: "t",
    })!;
    expect(e.normalizedEventType).toBe("grace_period");
    expect(mapLifecycleEventToEntitlementAction(e.normalizedEventType)).toBe("none");
  });

  it("unknown type → unknown + no action", () => {
    const e = normalizeAppleAssnV2Event({
      notificationUUID: "u6", notificationType: "OFFER_REDEEMED", transactionId: "t",
    })!;
    expect(e.normalizedEventType).toBe("unknown");
    expect(mapLifecycleEventToEntitlementAction(e.normalizedEventType)).toBe("none");
  });

  it("missing notificationUUID → null (cannot dedupe)", () => {
    expect(
      normalizeAppleAssnV2Event({ notificationType: "REFUND", transactionId: "t" } as any),
    ).toBeNull();
  });
});

describe("IAP Status Lifecycle — Google RTDN", () => {
  it("SUBSCRIPTION_REVOKED (12) → revoked + revoke", () => {
    const e = normalizeGoogleRtdnEvent({
      messageId: "m1",
      subscriptionNotification: { notificationType: 12, purchaseToken: "tok", subscriptionId: "sku" },
    })!;
    expect(e.normalizedEventType).toBe("revoked");
    expect(mapLifecycleEventToEntitlementAction(e.normalizedEventType)).toBe("revoke");
  });

  it("SUBSCRIPTION_EXPIRED (13) → expired + suspend", () => {
    const e = normalizeGoogleRtdnEvent({
      messageId: "m2",
      subscriptionNotification: { notificationType: 13, purchaseToken: "tok", subscriptionId: "sku" },
    })!;
    expect(e.normalizedEventType).toBe("expired");
    expect(mapLifecycleEventToEntitlementAction(e.normalizedEventType)).toBe("suspend");
  });

  it("SUBSCRIPTION_RENEWED (2) → renewal_active + restore", () => {
    const e = normalizeGoogleRtdnEvent({
      messageId: "m3",
      subscriptionNotification: { notificationType: 2, purchaseToken: "tok", subscriptionId: "sku" },
    })!;
    expect(e.normalizedEventType).toBe("renewal_active");
    expect(mapLifecycleEventToEntitlementAction(e.normalizedEventType)).toBe("restore");
  });

  it("voidedPurchase → refunded + revoke", () => {
    const e = normalizeGoogleRtdnEvent({
      messageId: "m4",
      voidedPurchaseNotification: { purchaseToken: "tok", orderId: "o" },
    })!;
    expect(e.normalizedEventType).toBe("refunded");
    expect(mapLifecycleEventToEntitlementAction(e.normalizedEventType)).toBe("revoke");
  });

  it("ONE_TIME_PRODUCT_PURCHASED → purchase_active + activate", () => {
    const e = normalizeGoogleRtdnEvent({
      messageId: "m5",
      oneTimeProductNotification: { notificationType: 1, purchaseToken: "tok", sku: "sku" },
    })!;
    expect(e.normalizedEventType).toBe("purchase_active");
    expect(mapLifecycleEventToEntitlementAction(e.normalizedEventType)).toBe("activate");
  });

  it("missing messageId → null", () => {
    expect(normalizeGoogleRtdnEvent({} as any)).toBeNull();
  });
});

describe("Stale guard + payload safety", () => {
  it("ignores older incoming event vs receipt", () => {
    const stale = shouldIgnoreOlderEvent(
      { last_store_event_at: "2026-01-01T00:00:00.000Z" },
      { eventAt: "2025-12-01T00:00:00.000Z" },
    );
    expect(stale).toBe(true);
  });

  it("does not ignore newer", () => {
    const stale = shouldIgnoreOlderEvent(
      { last_store_event_at: "2026-01-01T00:00:00.000Z" },
      { eventAt: "2026-02-01T00:00:00.000Z" },
    );
    expect(stale).toBe(false);
  });

  it("maskStoreEventPayload strips signed/raw fields", () => {
    const masked = maskStoreEventPayload({
      signedPayload: "JWS.SECRET.PAYLOAD",
      rawPayload: { secret: "x" },
      notificationType: "REFUND",
      notificationUUID: "u",
      transactionId: "t",
    });
    expect(masked).not.toHaveProperty("signedPayload");
    expect(masked).not.toHaveProperty("rawPayload");
    expect(masked.notificationType).toBe("REFUND");
    expect(masked.transactionId).toBe("t");
  });

  it("hashStoreEventPayload returns stable SHA-256 hex", async () => {
    const h1 = await hashStoreEventPayload({ a: 1, b: 2 });
    const h2 = await hashStoreEventPayload({ a: 1, b: 2 });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});
