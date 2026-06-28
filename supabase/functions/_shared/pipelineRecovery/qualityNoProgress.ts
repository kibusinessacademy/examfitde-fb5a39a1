/**
 * PIPELINE.RECOVERY.OS.3 — Quality No-Progress Lock (Pure SSOT)
 *
 * Prevents endless done-reaudit retriggers when no content/lf fix
 * has occurred between attempts.
 */

export interface ReauditAttempt {
  package_id: string;
  executed_at: string; // ISO
  verification_status?: string | null;
}

export interface FixSignal {
  package_id: string;
  occurred_at: string; // ISO
  kind: "content_fix" | "lf_fix" | "step_update";
}

export interface NoProgressDecision {
  package_id: string;
  lock: boolean;
  reason:
    | "no_previous_reaudit"
    | "fix_signal_after_last_reaudit"
    | "reaudit_too_recent"
    | "no_fix_since_last_reaudit";
  last_reaudit_at: string | null;
  last_fix_at: string | null;
}

const MIN_HOURS_BETWEEN_REAUDITS = 24;

export function evaluateQualityNoProgress(input: {
  now: string;
  package_id: string;
  reaudit_attempts: ReauditAttempt[];
  fix_signals: FixSignal[];
}): NoProgressDecision {
  const { now, package_id, reaudit_attempts, fix_signals } = input;
  const nowMs = Date.parse(now);

  const myReaudits = reaudit_attempts
    .filter((a) => a.package_id === package_id)
    .sort((a, b) => Date.parse(b.executed_at) - Date.parse(a.executed_at));
  const myFixes = fix_signals
    .filter((f) => f.package_id === package_id)
    .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));

  const lastReaudit = myReaudits[0] ?? null;
  const lastFix = myFixes[0] ?? null;

  if (!lastReaudit) {
    return {
      package_id,
      lock: false,
      reason: "no_previous_reaudit",
      last_reaudit_at: null,
      last_fix_at: lastFix?.occurred_at ?? null,
    };
  }

  const lastReauditMs = Date.parse(lastReaudit.executed_at);
  const ageHours = (nowMs - lastReauditMs) / 3600_000;

  if (ageHours < MIN_HOURS_BETWEEN_REAUDITS) {
    return {
      package_id,
      lock: true,
      reason: "reaudit_too_recent",
      last_reaudit_at: lastReaudit.executed_at,
      last_fix_at: lastFix?.occurred_at ?? null,
    };
  }

  if (lastFix && Date.parse(lastFix.occurred_at) > lastReauditMs) {
    return {
      package_id,
      lock: false,
      reason: "fix_signal_after_last_reaudit",
      last_reaudit_at: lastReaudit.executed_at,
      last_fix_at: lastFix.occurred_at,
    };
  }

  return {
    package_id,
    lock: true,
    reason: "no_fix_since_last_reaudit",
    last_reaudit_at: lastReaudit.executed_at,
    last_fix_at: lastFix?.occurred_at ?? null,
  };
}
