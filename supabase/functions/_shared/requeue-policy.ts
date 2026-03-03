// supabase/functions/_shared/requeue-policy.ts
// SSOT Backoff + Requeue for HOLLOW_* auto-rebuild
type SB = any;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function num(x: any): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Deterministic backoff for HOLLOW_* rebuilds:
 * attempt 0 -> 30s
 * attempt 1 -> 90s
 * attempt 2 -> 3m
 * attempt 3 -> 10m
 * attempt 4 -> 30m
 * attempt 5+ -> 60m (cap)
 */
export function computeHollowBackoffSeconds(attempt: number): number {
  const a = clamp(num(attempt), 0, 10);
  const table = [30, 90, 180, 600, 1800, 3600];
  return table[Math.min(a, table.length - 1)];
}

export function isHollowVerdict(v: any): boolean {
  const s = String(v ?? "");
  return s.startsWith("HOLLOW_");
}

/**
 * Skip helper for runner step loop: respect backoff next_run_at
 */
export function shouldSkipByNextRunAt(step: any): boolean {
  const nra = step?.meta?.next_run_at;
  if (!nra) return false;
  const t = Date.parse(String(nra));
  if (!Number.isFinite(t)) return false;
  return Date.now() < t;
}

export async function requeueStepWithBackoff(sb: SB, args: {
  packageId: string;
  stepKey: string;
  stepMeta?: Record<string, any>;
  reason?: string;
}) {
  // attempts already incremented by markStepFailed upstream — don't double-count
  const nextAttempt = num(args.stepMeta?.attempts ?? 1);
  const prevAttempts = Math.max(0, nextAttempt - 1);

  const backoff = computeHollowBackoffSeconds(prevAttempts);
  const nextRunAt = new Date(Date.now() + backoff * 1000).toISOString();

  const meta = {
    ...(args.stepMeta ?? {}),
    attempts: nextAttempt,
    last_progress_note: args.reason ?? "auto-rebuild: HOLLOW_* detected",
    next_run_at: nextRunAt,
    backoff_seconds: backoff,
    auto_rebuild: true,
  };

  const { error } = await sb
    .from("package_steps")
    .update({
      status: "queued",
      started_at: null,
      finished_at: null,
      meta,
    })
    .eq("package_id", args.packageId)
    .eq("step_key", args.stepKey);

  if (error) throw error;

  return { nextRunAt, backoff, nextAttempt };
}
