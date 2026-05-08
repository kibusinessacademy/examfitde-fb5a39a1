/**
 * Dev-only Tracking-Contract Validator (Phase D.2).
 *
 * Prüft beim Emit, dass:
 *  - eventType in der bekannten Allowlist steht (mirror der Edge-ALLOWED_EVENTS),
 *  - alle vertraglichen Metadata-Pflichtfelder vorhanden sind (null erlaubt, undefined nicht),
 *  - strict-events nicht ohne package_id gefeuert werden.
 *
 * In Production ein No-Op (kein Bundle-Bloat, kein User-impact).
 */

const EDGE_ALLOWED_EVENTS = new Set<string>([
  // legacy
  "paywall_view", "cta_click", "checkout_started", "checkout_completed", "dismissed",
  "pricing_hero_view", "pricing_hero_primary_click", "pricing_hero_secondary_click",
  "shop_view", "product_search", "product_filter", "product_view", "product_select", "checkout_start",
  // SSOT v2
  "lead_magnet_view", "quiz_started", "quiz_completed", "lead_capture_submitted", "lead_capture_view",
]);

const STRICT_REQUIRES_PACKAGE = new Set<string>([
  "quiz_started", "quiz_completed", "lead_capture_submitted",
]);

export interface ContractCheckInput {
  eventType: string;
  packageId: string | null;
  metadata: Record<string, unknown>;
  /** Pflichtfelder dieses Surfaces (alle dürfen null sein, aber nie undefined). */
  requiredMetadataKeys: string[];
}

export function devTrackingContractCheck(input: ContractCheckInput): void {
  if (!import.meta.env.DEV) return;
  const { eventType, packageId, metadata, requiredMetadataKeys } = input;

  if (!EDGE_ALLOWED_EVENTS.has(eventType)) {
    // eslint-disable-next-line no-console
    console.warn(`[track-contract] event "${eventType}" not in EDGE_ALLOWED_EVENTS — server will return 400`);
  }
  if (STRICT_REQUIRES_PACKAGE.has(eventType) && !packageId) {
    // eslint-disable-next-line no-console
    console.warn(`[track-contract] strict event "${eventType}" emitted without package_id — server will return 400`);
  }
  for (const key of requiredMetadataKeys) {
    if (!(key in metadata)) {
      // eslint-disable-next-line no-console
      console.warn(`[track-contract] "${eventType}" missing required metadata.${key}`);
    } else if (metadata[key] === undefined) {
      // eslint-disable-next-line no-console
      console.warn(`[track-contract] "${eventType}" metadata.${key} is undefined — use null instead`);
    }
  }
}
