/**
 * P20 Cut 0A — P18 Auto-Trigger Hook
 * ───────────────────────────────────
 * Adapter zwischen pure `reviewArchitecture()` und Mutation-Pfad
 * `recordP18Detection()`. Schreibt KEINE Tabelle direkt — nur via
 * existierende SECURITY DEFINER RPC `admin_p18_record_detection`.
 *
 * Verhalten:
 *   - Trigger-Source = "architecture-review-done"
 *   - approved + 0 findings              → noop (no noise)
 *   - review_required / blocked          → runP18Cut1 → recordP18Detection*
 *   - bestehende Idempotency-Formel
 *     `p18:{drift_type}:{target_fingerprint}:{policy_version}:{time_bucket}`
 *     wird nicht modifiziert → wiederholte Reviews = keine Doppel-Rows
 *
 * Pure Review-Core (`architecture-review.ts`, `p18-orchestrator.ts`) bleibt
 * unverändert. Diese Datei ist der einzige Mutationspunkt.
 */

import type { ArchitectureReview } from './architecture-review';
import { runP18Cut1, type DriftSignal } from './p18-orchestrator';
import { recordP18Detection } from './p18-heal-executor.functions';

export interface P18ReviewHookResult {
  triggered: boolean;
  reason: 'approved_no_findings' | 'recorded' | 'no_signals';
  signals: DriftSignal[];
  recorded_keys: string[];
  errors: Array<{ idempotency_key: string; error: string }>;
}

/**
 * Wird von der UI / einem ServerFn nach erfolgreichem
 * `reviewArchitecture(proposal)` aufgerufen.
 *
 * Wirft NICHT — sammelt Fehler in `errors[]`, damit ein einzelner
 * RPC-Fail die UI nicht blockiert.
 */
export async function runP18DetectionForArchitectureReview(
  review: ArchitectureReview,
  options: { now?: Date } = {},
): Promise<P18ReviewHookResult> {
  // Suppress noise: approved review without findings → no Ledger-Write
  if (review.verdict === 'approved' && review.findings.length === 0) {
    return {
      triggered: false,
      reason: 'approved_no_findings',
      signals: [],
      recorded_keys: [],
      errors: [],
    };
  }

  const result = runP18Cut1({
    architectureReviewDone: { review },
    now: options.now ?? new Date(),
  });

  if (result.signals.length === 0) {
    return {
      triggered: false,
      reason: 'no_signals',
      signals: [],
      recorded_keys: [],
      errors: [],
    };
  }

  const recorded_keys: string[] = [];
  const errors: P18ReviewHookResult['errors'] = [];

  for (const sig of result.signals) {
    try {
      await recordP18Detection(sig);
      recorded_keys.push(sig.idempotency_key);
    } catch (e) {
      errors.push({
        idempotency_key: sig.idempotency_key,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    triggered: true,
    reason: 'recorded',
    signals: result.signals,
    recorded_keys,
    errors,
  };
}
