/**
 * IAP Lifecycle Bridge — applies normalized lifecycle events to the SSOT:
 *   - append-only insert into `store_receipt_events`
 *   - status/expires update on `store_receipts`
 *   - entitlement action via SECURITY DEFINER RPC
 *
 * Used by apple-server-notifications + google-rtdn-notifications.
 * Idempotent on (platform, store_event_id).
 */
import {
  type NormalizedLifecycleEvent,
  mapLifecycleEventToReceiptStatus,
  mapLifecycleEventToEntitlementAction,
  shouldIgnoreOlderEvent,
  hashStoreEventPayload,
  maskStoreEventPayload,
} from "./iap-status-lifecycle.ts";

type SB = {
  from: (t: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => any;
};

export interface LifecycleApplyResult {
  ok: boolean;
  processing_status:
    | "processed"
    | "ignored_stale"
    | "ignored_duplicate"
    | "unknown_receipt"
    | "unknown_sku"
    | "unsupported_type"
    | "error";
  receipt_id?: string;
  entitlement_action?: string;
  error_code?: string;
}

export async function applyLifecycleEvent(
  sb: SB,
  event: NormalizedLifecycleEvent,
  rawPayloadForHash: unknown,
): Promise<LifecycleApplyResult> {
  try {
    // 1) Duplicate check (unique on platform,store_event_id)
    const { data: dup } = await sb
      .from("store_receipt_events")
      .select("id")
      .eq("platform", event.platform)
      .eq("store_event_id", event.storeEventId)
      .maybeSingle();
    if (dup) {
      return { ok: true, processing_status: "ignored_duplicate" };
    }

    // 2) Resolve receipt
    let receipt:
      | {
          id: string;
          entitlement_id: string | null;
          last_store_event_at: string | null;
          curriculum_id: string | null;
        }
      | null = null;

    if (event.platform === "ios" && event.transactionId) {
      const r = await sb
        .from("store_receipts")
        .select("id, entitlement_id, last_store_event_at, curriculum_id")
        .eq("platform", "ios")
        .eq("transaction_id", event.transactionId)
        .maybeSingle();
      receipt = r.data ?? null;
    } else if (event.platform === "android" && event.purchaseToken) {
      const r = await sb
        .from("store_receipts")
        .select("id, entitlement_id, last_store_event_at, curriculum_id")
        .eq("platform", "android")
        .eq("transaction_id", event.purchaseToken)
        .maybeSingle();
      receipt = r.data ?? null;
    }

    const hash = await hashStoreEventPayload(maskStoreEventPayload(
      (rawPayloadForHash as Record<string, unknown>) ?? {},
    ));

    if (!receipt) {
      await sb.from("store_receipt_events").insert({
        platform: event.platform,
        store_event_id: event.storeEventId,
        store_event_type: event.storeEventType,
        normalized_event_type: event.normalizedEventType,
        transaction_id: event.transactionId ?? null,
        purchase_token: event.purchaseToken ?? null,
        product_sku: event.productSku ?? null,
        event_at: event.eventAt ?? null,
        processing_status: "unknown_receipt",
        masked_payload_hash: hash,
      });
      return { ok: true, processing_status: "unknown_receipt" };
    }

    // 3) Stale guard
    if (shouldIgnoreOlderEvent(receipt, event)) {
      await sb.from("store_receipt_events").insert({
        platform: event.platform,
        store_event_id: event.storeEventId,
        store_event_type: event.storeEventType,
        normalized_event_type: event.normalizedEventType,
        receipt_id: receipt.id,
        transaction_id: event.transactionId ?? null,
        purchase_token: event.purchaseToken ?? null,
        product_sku: event.productSku ?? null,
        curriculum_id: receipt.curriculum_id,
        entitlement_id: receipt.entitlement_id,
        event_at: event.eventAt ?? null,
        processing_status: "ignored_stale",
        masked_payload_hash: hash,
      });
      return { ok: true, processing_status: "ignored_stale" };
    }

    if (event.normalizedEventType === "unknown") {
      await sb.from("store_receipt_events").insert({
        platform: event.platform,
        store_event_id: event.storeEventId,
        store_event_type: event.storeEventType,
        normalized_event_type: "unknown",
        receipt_id: receipt.id,
        transaction_id: event.transactionId ?? null,
        purchase_token: event.purchaseToken ?? null,
        product_sku: event.productSku ?? null,
        curriculum_id: receipt.curriculum_id,
        entitlement_id: receipt.entitlement_id,
        event_at: event.eventAt ?? null,
        processing_status: "unsupported_type",
        masked_payload_hash: hash,
      });
      return { ok: true, processing_status: "unsupported_type" };
    }

    // 4) Apply entitlement action via SECURITY DEFINER RPC
    const action = mapLifecycleEventToEntitlementAction(event.normalizedEventType);
    const reason = `${event.platform}:${event.storeEventType}`;

    if (action === "revoke") {
      await sb.rpc("revoke_store_entitlement", {
        p_receipt_id: receipt.id,
        p_reason: reason,
        p_store_event_id: event.storeEventId,
      });
      // status_reason set; force terminal columns
      const now = new Date().toISOString();
      const patch =
        event.normalizedEventType === "refunded"
          ? { refunded_at: now }
          : { revoked_at: now };
      await sb.from("store_receipts").update(patch).eq("id", receipt.id);
    } else if (action === "suspend") {
      await sb.rpc("suspend_store_entitlement", {
        p_receipt_id: receipt.id,
        p_reason: reason,
        p_store_event_id: event.storeEventId,
      });
    } else if (action === "restore" || action === "activate") {
      await sb.rpc("restore_store_entitlement", {
        p_receipt_id: receipt.id,
        p_reason: reason,
        p_store_event_id: event.storeEventId,
        p_new_expires_at: event.expiresAt ?? null,
      });
    } else {
      // none — still record event + reflect status
      const status = mapLifecycleEventToReceiptStatus(event.normalizedEventType);
      const patch: Record<string, unknown> = {
        status,
        status_reason: reason,
        last_store_event_id: event.storeEventId,
        last_store_event_type: event.storeEventType,
        last_store_event_at: new Date().toISOString(),
      };
      if (event.normalizedEventType === "cancelled") {
        patch.cancelled_at = new Date().toISOString();
      }
      await sb.from("store_receipts").update(patch).eq("id", receipt.id);
    }

    // 5) Append event record
    await sb.from("store_receipt_events").insert({
      platform: event.platform,
      store_event_id: event.storeEventId,
      store_event_type: event.storeEventType,
      normalized_event_type: event.normalizedEventType,
      receipt_id: receipt.id,
      transaction_id: event.transactionId ?? null,
      purchase_token: event.purchaseToken ?? null,
      product_sku: event.productSku ?? null,
      curriculum_id: receipt.curriculum_id,
      entitlement_id: receipt.entitlement_id,
      event_at: event.eventAt ?? null,
      processing_status: "processed",
      masked_payload_hash: hash,
    });

    return {
      ok: true,
      processing_status: "processed",
      receipt_id: receipt.id,
      entitlement_action: action,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await sb.from("store_receipt_events").insert({
        platform: event.platform,
        store_event_id: event.storeEventId,
        store_event_type: event.storeEventType,
        normalized_event_type: event.normalizedEventType,
        transaction_id: event.transactionId ?? null,
        purchase_token: event.purchaseToken ?? null,
        product_sku: event.productSku ?? null,
        event_at: event.eventAt ?? null,
        processing_status: "error",
        error_code: msg.slice(0, 200),
      });
    } catch { /* swallow */ }
    return { ok: false, processing_status: "error", error_code: msg };
  }
}
