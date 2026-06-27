/**
 * PIPELINE.HEALTH.OS.1 — Pure deterministic pipeline-health projector.
 * Input: raw rows from existing SSOT views. Output: ranked operator signals.
 * No DB, no fetch, no clock-dependence in math.
 */

export const PROJECTOR_VERSION = "pipeline-health-os-1.0.0";

export interface JobHealthRow {
  job_type: string;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  cancelled: number;
  blocked: number;
  total: number;
  avg_fail_attempts: number | null;
  last_activity: string | null;
}

export interface StuckRow {
  id: string;
  worker_pool: string | null;
  job_type: string;
  running_for_seconds: number;
  attempts: number;
  last_error: string | null;
}

export interface DeadLetterRow {
  job_type: string;
  error_category: string | null;
  error_code: string | null;
  created_at: string;
}

export interface PendingAgeRow {
  job_type: string;
  worker_pool: string | null;
  pending_jobs: number;
  blocked_mode_jobs: number;
  oldest_updated_at: string | null;
}

export interface ProjInputs {
  kpis: JobHealthRow[];
  stuck: StuckRow[];
  dlq: DeadLetterRow[];
  pending_age: PendingAgeRow[];
  now_iso: string;
}

export type ActionCode =
  | "CANCEL_LOOP"
  | "STUCK_RUNNING"
  | "STALE_PENDING"
  | "HIGH_FAIL_RATE"
  | "DLQ_BACKLOG"
  | "BLOCKED_BACKLOG";

export interface ActionItem {
  code: ActionCode;
  job_type: string;
  severity: "critical" | "high" | "medium";
  metric: number;
  detail: string;
  score: number;
}

export interface JobTypeKpi {
  job_type: string;
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  pending: number;
  processing: number;
  blocked: number;
  success_rate: number;     // completed / (completed+failed+cancelled) in [0..1]
  cancel_ratio: number;     // cancelled / total
  fail_ratio: number;       // failed / total
  avg_fail_attempts: number;
  last_activity: string | null;
  health: "green" | "yellow" | "red";
}

export interface Projection {
  generated_at: string;
  projector_version: string;
  totals: {
    job_types: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    cancelled: number;
    blocked: number;
    success_rate: number;
    dlq_unresolved: number;
    stuck_running: number;
  };
  job_types: JobTypeKpi[];
  action_queue: ActionItem[];
  dlq_by_category: { category: string; count: number; sample_job_type: string }[];
  stuck_top: StuckRow[];
}

const ACTION_PRIORITY: Record<ActionCode, number> = {
  STUCK_RUNNING: 100,
  CANCEL_LOOP: 90,
  DLQ_BACKLOG: 80,
  HIGH_FAIL_RATE: 70,
  STALE_PENDING: 50,
  BLOCKED_BACKLOG: 40,
};

function classifyHealth(k: JobTypeKpi): JobTypeKpi["health"] {
  if (k.total === 0) return "yellow";
  if (k.cancel_ratio > 0.5 || k.fail_ratio > 0.3) return "red";
  if (k.success_rate < 0.7) return "yellow";
  return "green";
}

function ageSec(iso: string | null | undefined, now: number): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 1000)) : 0;
}

export function buildJobTypeKpis(kpis: JobHealthRow[]): JobTypeKpi[] {
  return kpis.map((r) => {
    const decided = r.completed + r.failed + r.cancelled;
    const success = decided > 0 ? r.completed / decided : 0;
    const cancelRatio = r.total > 0 ? r.cancelled / r.total : 0;
    const failRatio = r.total > 0 ? r.failed / r.total : 0;
    const base: JobTypeKpi = {
      job_type: r.job_type,
      total: r.total,
      completed: r.completed,
      failed: r.failed,
      cancelled: r.cancelled,
      pending: r.pending,
      processing: r.processing,
      blocked: r.blocked,
      success_rate: Math.round(success * 1000) / 1000,
      cancel_ratio: Math.round(cancelRatio * 1000) / 1000,
      fail_ratio: Math.round(failRatio * 1000) / 1000,
      avg_fail_attempts: Math.round((r.avg_fail_attempts ?? 0) * 100) / 100,
      last_activity: r.last_activity,
      health: "green",
    };
    base.health = classifyHealth(base);
    return base;
  });
}

export function buildActionQueue(p: {
  jobTypes: JobTypeKpi[];
  stuck: StuckRow[];
  dlq: DeadLetterRow[];
  pendingAge: PendingAgeRow[];
  nowMs: number;
}): ActionItem[] {
  const items: ActionItem[] = [];

  // STUCK_RUNNING — anything running > 30min is critical, > 10min high
  for (const s of p.stuck) {
    const sev: ActionItem["severity"] = s.running_for_seconds > 1800 ? "critical" : "high";
    items.push({
      code: "STUCK_RUNNING",
      job_type: s.job_type,
      severity: sev,
      metric: s.running_for_seconds,
      detail: `Job ${s.id.slice(0, 8)} läuft ${Math.round(s.running_for_seconds / 60)} min (${s.attempts} Versuche)`,
      score: 0,
    });
  }

  // CANCEL_LOOP — cancel_ratio > 0.5 AND total >= 20
  for (const k of p.jobTypes) {
    if (k.total >= 20 && k.cancel_ratio > 0.5) {
      items.push({
        code: "CANCEL_LOOP",
        job_type: k.job_type,
        severity: k.cancel_ratio > 0.8 ? "critical" : "high",
        metric: k.cancel_ratio,
        detail: `${Math.round(k.cancel_ratio * 100)}% cancelled (${k.cancelled}/${k.total})`,
        score: 0,
      });
    }
  }

  // HIGH_FAIL_RATE — fail_ratio > 0.2 AND total >= 20
  for (const k of p.jobTypes) {
    if (k.total >= 20 && k.fail_ratio > 0.2) {
      items.push({
        code: "HIGH_FAIL_RATE",
        job_type: k.job_type,
        severity: k.fail_ratio > 0.5 ? "critical" : "high",
        metric: k.fail_ratio,
        detail: `${Math.round(k.fail_ratio * 100)}% fail (${k.failed}/${k.total}), ⌀ ${k.avg_fail_attempts} Versuche`,
        score: 0,
      });
    }
  }

  // STALE_PENDING — oldest_updated_at > 1h AND pending_jobs >= 5
  for (const r of p.pendingAge) {
    const age = ageSec(r.oldest_updated_at, p.nowMs);
    if (r.pending_jobs >= 5 && age > 3600) {
      items.push({
        code: "STALE_PENDING",
        job_type: r.job_type,
        severity: age > 21600 ? "high" : "medium",
        metric: age,
        detail: `${r.pending_jobs} pending, ältester ${Math.round(age / 60)} min alt`,
        score: 0,
      });
    }
  }

  // BLOCKED_BACKLOG — blocked > 20
  for (const k of p.jobTypes) {
    if (k.blocked > 20) {
      items.push({
        code: "BLOCKED_BACKLOG",
        job_type: k.job_type,
        severity: k.blocked > 100 ? "high" : "medium",
        metric: k.blocked,
        detail: `${k.blocked} blocked Jobs warten auf Artifact-Resolution`,
        score: 0,
      });
    }
  }

  // DLQ_BACKLOG — count per job_type from dlq input
  const dlqByType = new Map<string, number>();
  for (const d of p.dlq) dlqByType.set(d.job_type, (dlqByType.get(d.job_type) ?? 0) + 1);
  for (const [job_type, count] of dlqByType) {
    if (count >= 3) {
      items.push({
        code: "DLQ_BACKLOG",
        job_type,
        severity: count >= 10 ? "critical" : count >= 5 ? "high" : "medium",
        metric: count,
        detail: `${count} unresolved Dead-Letter Items`,
        score: 0,
      });
    }
  }

  // Score & sort
  const sevWeight = { critical: 3, high: 2, medium: 1 } as const;
  for (const it of items) {
    it.score = ACTION_PRIORITY[it.code] * sevWeight[it.severity];
  }
  return items.sort((a, b) => b.score - a.score).slice(0, 20);
}

export function summarizeDlq(dlq: DeadLetterRow[]): Projection["dlq_by_category"] {
  const map = new Map<string, { count: number; sample: string }>();
  for (const d of dlq) {
    const k = d.error_category ?? "uncategorized";
    const cur = map.get(k) ?? { count: 0, sample: d.job_type };
    cur.count++;
    map.set(k, cur);
  }
  return Array.from(map.entries())
    .map(([category, v]) => ({ category, count: v.count, sample_job_type: v.sample }))
    .sort((a, b) => b.count - a.count);
}

export function project(inputs: ProjInputs): Projection {
  const nowMs = Date.parse(inputs.now_iso);
  const jobTypes = buildJobTypeKpis(inputs.kpis);
  const totals = jobTypes.reduce(
    (acc, k) => {
      acc.pending += k.pending; acc.processing += k.processing;
      acc.completed += k.completed; acc.failed += k.failed;
      acc.cancelled += k.cancelled; acc.blocked += k.blocked;
      return acc;
    },
    { pending: 0, processing: 0, completed: 0, failed: 0, cancelled: 0, blocked: 0 },
  );
  const decided = totals.completed + totals.failed + totals.cancelled;
  const successRate = decided > 0 ? Math.round((totals.completed / decided) * 1000) / 1000 : 0;

  return {
    generated_at: inputs.now_iso,
    projector_version: PROJECTOR_VERSION,
    totals: {
      job_types: jobTypes.length,
      ...totals,
      success_rate: successRate,
      dlq_unresolved: inputs.dlq.length,
      stuck_running: inputs.stuck.length,
    },
    job_types: jobTypes.sort((a, b) => {
      const order = { red: 0, yellow: 1, green: 2 };
      return order[a.health] - order[b.health] || b.total - a.total;
    }),
    action_queue: buildActionQueue({
      jobTypes, stuck: inputs.stuck, dlq: inputs.dlq, pendingAge: inputs.pending_age, nowMs,
    }),
    dlq_by_category: summarizeDlq(inputs.dlq),
    stuck_top: [...inputs.stuck].sort((a, b) => b.running_for_seconds - a.running_for_seconds).slice(0, 10),
  };
}
