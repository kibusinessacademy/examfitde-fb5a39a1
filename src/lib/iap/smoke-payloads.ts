/**
 * IAP Smoke Payload Builder — Phase B.1
 *
 * Generates synthetic, prefixed receipt payloads for the admin Mobile-IAP-Smoke
 * harness. Every transaction_id / purchase_token starts with `SMOKE-` so the
 * cleanup RPC can locate and purge artifacts deterministically.
 *
 * NEVER use these payloads in production purchase flows.
 */

import type { IAPValidationInput, IAPPlatform } from "@/hooks/useIAPReceiptValidation";

export type SmokeCase = "happy" | "duplicate" | "invalid" | "expired";

export const SMOKE_PREFIX = "SMOKE-";
export const SMOKE_INVALID_SKU = "SMOKE-INVALID-SKU";

const randomId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export interface SmokePayloadOptions {
  platform: IAPPlatform;
  sku: string;
  curriculumId: string;
  case: SmokeCase;
  /** For `duplicate`, reuse the transaction id from a prior run. */
  reuseTransactionId?: string;
}

export interface SmokePayload {
  platform: IAPPlatform;
  transactionId: string;
  invocation: IAPValidationInput;
}

export function buildSmokePayload(opts: SmokePayloadOptions): SmokePayload {
  const sku =
    opts.case === "invalid" ? SMOKE_INVALID_SKU : opts.sku;

  const txId =
    opts.case === "duplicate" && opts.reuseTransactionId
      ? opts.reuseTransactionId
      : `${SMOKE_PREFIX}${opts.platform.toUpperCase()}-${randomId()}`;

  if (opts.platform === "ios") {
    return {
      platform: "ios",
      transactionId: txId,
      invocation: {
        platform: "ios",
        sku,
        curriculum_id: opts.curriculumId,
        transaction_id: txId,
        receipt_data: "SMOKE_SANDBOX",
      },
    };
  }

  return {
    platform: "android",
    transactionId: txId,
    invocation: {
      platform: "android",
      sku,
      curriculum_id: opts.curriculumId,
      purchase_token: txId,
      order_id: txId,
      package_name: "com.examfit.smoke",
    },
  };
}

/** UI labels for harness rendering — keep aligned with backend semantics. */
export const SMOKE_CASE_LABELS: Record<SmokeCase, string> = {
  happy: "Happy Path",
  duplicate: "Duplicate Receipt",
  invalid: "Invalid Receipt (unknown SKU)",
  expired: "Expired / Refunded (TODO — Status-Lifecycle)",
};
