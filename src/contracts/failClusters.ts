/**
 * SSOT — Fail Cluster Contract
 * ────────────────────────────
 * Mirrors public.fn_classify_fail_cluster (DB pure classifier).
 * UI labels + ordering live here. DB and UI MUST stay in sync.
 *
 * Used by: FailClusterDeltaCard, classifier tests.
 */

export const FAIL_CLUSTER_KEYS = [
  'lf_self_fail',
  'missing_blueprint_id',
  'ai_gateway_bypass',
  'phk_nested_kill',
  'sealed_course_retry',
  'generic_http_500',
] as const;

export type FailClusterKey = (typeof FAIL_CLUSTER_KEYS)[number];

export const FAIL_CLUSTER_LABELS: Record<FailClusterKey, string> = {
  lf_self_fail: 'LF Self-Fail',
  missing_blueprint_id: 'Missing Blueprint ID',
  ai_gateway_bypass: 'AI Gateway Bypass',
  phk_nested_kill: 'PHK Nested Kill',
  sealed_course_retry: 'Sealed Course Retry',
  generic_http_500: 'Generic HTTP 5xx',
};

export type FailClusterStatus = 'green' | 'watch' | 'critical';

export interface FailClusterRow {
  cluster_key: FailClusterKey;
  label: string;
  count_24h: number;
  count_5d: number;
  delta: number;
  status: FailClusterStatus;
  last_seen: string | null;
  sample_error: string | null;
}

/**
 * Pure classifier — mirrors fn_classify_fail_cluster (Postgres).
 * Used in unit tests to validate pattern parity.
 */
export function classifyFailCluster(input: {
  job_type?: string | null;
  error?: string | null;
  last_error?: string | null;
  last_error_code?: string | null;
}): FailClusterKey | null {
  const code = (input.last_error_code ?? '').toUpperCase();
  const msg = `${input.error ?? ''} ${input.last_error ?? ''}`;

  if (
    ['LF_REPAIR_RESCHEDULE_LOCK', 'NO_JOBS_DISPATCHED', 'ACTIVE_FANOUT_FOR_LF'].includes(code) ||
    /no_jobs_dispatched|active_fanout_for_lf|lf_repair_reschedule_lock/i.test(msg)
  ) {
    return 'lf_self_fail';
  }
  if (code === 'MISSING_BLUEPRINT_ID' || /missing.?blueprint.?id/i.test(msg)) {
    return 'missing_blueprint_id';
  }
  if (/google_ai_api_key|invalid model id|gemini api key/i.test(msg)) {
    return 'ai_gateway_bypass';
  }
  if (code === 'PRE_HEARTBEAT_KILL_TERMINAL' || /was killed \(was killed/i.test(msg)) {
    return 'phk_nested_kill';
  }
  if (code === 'SEALED_COURSE' || /sealed_course/i.test(msg)) {
    return 'sealed_course_retry';
  }
  if (/http\s*5\d\d|status\s*5\d\d|internal server error/i.test(msg)) {
    return 'generic_http_500';
  }
  return null;
}

/**
 * Status thresholds (mirrors RPC).
 * green: count_24h = 0
 * critical: count_24h >= 10 OR count_24h > 2x prior-4d-daily-average
 * watch: otherwise
 */
export function classifyStatus(count_24h: number, count_5d: number): FailClusterStatus {
  if (count_24h <= 0) return 'green';
  const prior4dAvg = Math.max(Math.floor((count_5d - count_24h) / 4), 0);
  if (count_24h >= 10 || count_24h > prior4dAvg * 2) return 'critical';
  return 'watch';
}

/** Strip secrets and truncate to 240 chars (mirrors fn_sanitize_error_sample). */
export function sanitizeSample(msg: string | null | undefined): string {
  if (!msg) return '';
  return msg
    .replace(/(sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_.-]{20,}|Bearer\s+[A-Za-z0-9_.-]+)/gi, '[REDACTED]')
    .replace(/([A-Z0-9_]*API[_]?KEY[A-Z0-9_]*\s*[:=]\s*)\S+/gi, '$1[REDACTED]')
    .replace(/\s+/g, ' ')
    .slice(0, 240);
}
