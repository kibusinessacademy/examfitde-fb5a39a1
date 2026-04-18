/**
 * SSOT Heal Reason Schema
 * ───────────────────────
 * Erzwingt audit-stabile Reason-Strings statt Freitext.
 *
 * Format:
 *   manual_soft_reentry:<step_key>
 *   manual_hard_heal:<step_key>
 *   auto_heal_queue:soft:<queueId>
 *   auto_heal_queue:hard:<queueId>
 *
 * Freitext-Operator-Notes gehören in operator_note (separat persistiert),
 * NICHT in den Primär-Reason.
 */

export type HealReasonKind =
  | "manual_soft_reentry"
  | "manual_hard_heal"
  | "auto_heal_queue_soft"
  | "auto_heal_queue_hard";

const REASON_RE = /^(manual_soft_reentry|manual_hard_heal|auto_heal_queue:(soft|hard)):[A-Za-z0-9_\-]+$/;

export function buildHealReason(kind: HealReasonKind, suffix: string): string {
  if (!suffix || !/^[A-Za-z0-9_\-]+$/.test(suffix)) {
    throw new Error(`buildHealReason: invalid suffix "${suffix}"`);
  }
  switch (kind) {
    case "manual_soft_reentry": return `manual_soft_reentry:${suffix}`;
    case "manual_hard_heal":    return `manual_hard_heal:${suffix}`;
    case "auto_heal_queue_soft": return `auto_heal_queue:soft:${suffix}`;
    case "auto_heal_queue_hard": return `auto_heal_queue:hard:${suffix}`;
  }
}

export function assertValidHealReason(reason: string): void {
  if (!REASON_RE.test(reason)) {
    throw new Error(
      `Invalid heal reason "${reason}". Expected manual_soft_reentry:<step> | manual_hard_heal:<step> | auto_heal_queue:(soft|hard):<id>`,
    );
  }
}
