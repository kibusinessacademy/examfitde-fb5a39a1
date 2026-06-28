/**
 * SELF.HEAL.OS.1 — Pure deterministic self-healing projector.
 * Input: raw rows from auto_heal_log + ops_health_summary + auto_heal_policies.
 * Output: ranked operator signals (Action Queue), effectiveness KPI, system flags.
 * No DB, no fetch, no clock-dependence in math.
 */

export const PROJECTOR_VERSION = "self-heal-os-1.0.0";

export interface HealLogRow {
  action_type: string;
  trigger_source: string | null;
  result_status: string; // 'success' | 'failed' | 'skipped' | 'pending'
  duration_ms: number | null;
  created_at: string; // ISO
  followup_verdict: string | null; // 'improved' | 'no_change' | 'regressed' | null
  followup_score_before: number | null;
  followup_score_after: number | null;
}

export interface HealthSummaryRow {
  health_score: number;
  traffic_light: string; // 'green' | 'yellow' | 'red'
  failed_1h: number;
  failed_24h: number;
  stuck_jobs: number;
  failed_packages: number;
  integrity_issues: number;
  heals_24h: number;
  heals_success_24h: number;
  heals_failed_24h: number;
  auto_heal_allowed: boolean;
}

export interface PolicyRow {
  is_active: boolean;
  incident_mode: boolean | null;
  incident_activated_at: string | null;
  incident_activated_by: string | null;
  cooldowns: Record<string, number> | null;
  requires_approval: string[] | null;
}

export interface ProjInputs {
  heals: HealLogRow[];        // last 7d
  summary: HealthSummaryRow | null;
  policy: PolicyRow | null;
  now_iso: string;
}

export type ActionCode =
  | "HEAL_DISABLED"
  | "INCIDENT_MODE"
  | "ACTION_REGRESSION"
  | "ACTION_HIGH_FAILURE"
  | "HEAL_FAIL_SPIKE"
  | "ACTION_NO_EFFECT"
  | "ACTION_NO_FOLLOWUP"
  | "HEAL_SILENCE"
  | "HEAL_THRASHING";

export type Severity = "critical" | "high" | "medium";

export interface ActionItem {
  code: ActionCode;
  action_type: string; // "*" for system-wide
  severity: Severity;
  metric: number;
  detail: string;
  score: number;
}

export interface ActionTypeKpi {
  action_type: string;
  total_24h: number;
  total_7d: number;
  success: number;
  failed: number;
  skipped: number;
  success_rate: number;        // 0..1 over 7d
  followup_checked: number;
  followup_coverage: number;   // followup_checked / (success+failed)
  improved: number;
  no_change: number;
  regressed: number;
  effective_rate: number;      // improved / followup_checked
  avg_score_delta: number;     // mean (after - before) where both present
  avg_duration_ms: number;
  last_run: string | null;
  health: "green" | "yellow" | "red";
}

export interface Projection {
  generated_at: string;
  projector_version: string;
  system: {
    health_score: number;
    traffic_light: string;
    auto_heal_allowed: boolean;
    incident_mode: boolean;
    heals_24h: number;
    heals_success_24h: number;
    heals_failed_24h: number;
    heals_24h_success_rate: number;
    distinct_actions_7d: number;
    effective_rate_7d: number; // improved / followup_checked across all actions
  };
  policy: {
    is_active: boolean;
    incident_mode: boolean;
    incident_activated_at: string | null;
    incident_activated_by: string | null;
    requires_approval: string[];
    cooldown_keys: string[];
  };
  action_types: ActionTypeKpi[];
  action_queue: ActionItem[];
  trigger_breakdown: { trigger_source: string; runs_24h: number; success_24h: number; failed_24h: number }[];
}

const SEV_SCORE: Record<Severity, number> = { critical: 1000, high: 100, medium: 10 };

function inWindow(iso: string, now: number, ms: number): boolean {
  const t = Date.parse(iso);
  return Number.isFinite(t) && now - t <= ms;
}

function classifyHealth(success_rate: number, effective_rate: number, total_7d: number): "green" | "yellow" | "red" {
  if (total_7d < 3) return "green";
  if (success_rate < 0.5 || effective_rate < 0.2) return "red";
  if (success_rate < 0.8 || effective_rate < 0.5) return "yellow";
  return "green";
}

export function project(input: ProjInputs): Projection {
  const now = Date.parse(input.now_iso);
  const DAY = 86400_000;
  const heals = input.heals ?? [];

  // Group by action_type
  const byAction = new Map<string, HealLogRow[]>();
  for (const h of heals) {
    const k = h.action_type || "unknown";
    if (!byAction.has(k)) byAction.set(k, []);
    byAction.get(k)!.push(h);
  }

  const action_types: ActionTypeKpi[] = [];
  for (const [action_type, rows] of byAction) {
    const rows7d = rows.filter((r) => inWindow(r.created_at, now, 7 * DAY));
    const rows24h = rows.filter((r) => inWindow(r.created_at, now, DAY));
    const success = rows7d.filter((r) => r.result_status === "success").length;
    const failed = rows7d.filter((r) => r.result_status === "failed").length;
    const skipped = rows7d.filter((r) => r.result_status === "skipped").length;
    const settled = success + failed;
    const success_rate = settled > 0 ? success / settled : 1;

    const followupRows = rows7d.filter((r) => r.followup_verdict != null);
    const improved = followupRows.filter((r) => r.followup_verdict === "improved").length;
    const no_change = followupRows.filter((r) => r.followup_verdict === "no_change").length;
    const regressed = followupRows.filter((r) => r.followup_verdict === "regressed").length;
    const followup_checked = followupRows.length;
    const followup_coverage = settled > 0 ? followup_checked / settled : 0;
    const effective_rate = followup_checked > 0 ? improved / followup_checked : 0;

    const deltas = rows7d
      .filter((r) => r.followup_score_after != null && r.followup_score_before != null)
      .map((r) => (r.followup_score_after as number) - (r.followup_score_before as number));
    const avg_score_delta = deltas.length > 0 ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;

    const durations = rows7d.map((r) => r.duration_ms ?? 0).filter((d) => d > 0);
    const avg_duration_ms = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

    const last_run = rows7d.reduce<string | null>((acc, r) => {
      if (!acc) return r.created_at;
      return Date.parse(r.created_at) > Date.parse(acc) ? r.created_at : acc;
    }, null);

    action_types.push({
      action_type,
      total_24h: rows24h.length,
      total_7d: rows7d.length,
      success,
      failed,
      skipped,
      success_rate: Math.round(success_rate * 1000) / 1000,
      followup_checked,
      followup_coverage: Math.round(followup_coverage * 1000) / 1000,
      improved,
      no_change,
      regressed,
      effective_rate: Math.round(effective_rate * 1000) / 1000,
      avg_score_delta: Math.round(avg_score_delta * 10) / 10,
      avg_duration_ms,
      last_run,
      health: classifyHealth(success_rate, effective_rate, rows7d.length),
    });
  }

  // Deterministic sort: red > yellow > green, then by total_7d desc
  const healthOrder = { red: 0, yellow: 1, green: 2 } as const;
  action_types.sort((a, b) => healthOrder[a.health] - healthOrder[b.health] || b.total_7d - a.total_7d || a.action_type.localeCompare(b.action_type));

  // Trigger breakdown (24h)
  const triggerMap = new Map<string, { runs: number; success: number; failed: number }>();
  for (const h of heals) {
    if (!inWindow(h.created_at, now, DAY)) continue;
    const k = h.trigger_source || "unknown";
    const e = triggerMap.get(k) ?? { runs: 0, success: 0, failed: 0 };
    e.runs += 1;
    if (h.result_status === "success") e.success += 1;
    if (h.result_status === "failed") e.failed += 1;
    triggerMap.set(k, e);
  }
  const trigger_breakdown = [...triggerMap.entries()]
    .map(([trigger_source, v]) => ({ trigger_source, runs_24h: v.runs, success_24h: v.success, failed_24h: v.failed }))
    .sort((a, b) => b.runs_24h - a.runs_24h || a.trigger_source.localeCompare(b.trigger_source));

  // ─── Action Queue ─────────────────────────────────────────────
  const queue: ActionItem[] = [];
  const summary = input.summary;
  const policy = input.policy;

  if (summary && summary.auto_heal_allowed === false) {
    queue.push({
      code: "HEAL_DISABLED", action_type: "*", severity: "critical",
      metric: summary.stuck_jobs + summary.failed_packages,
      detail: `Auto-Heal blockiert (stuck=${summary.stuck_jobs}, failed_packages=${summary.failed_packages}). Manuelles Eingreifen erforderlich.`,
      score: SEV_SCORE.critical + 50,
    });
  }
  if (policy?.incident_mode) {
    queue.push({
      code: "INCIDENT_MODE", action_type: "*", severity: "critical",
      metric: 1,
      detail: `Incident-Mode aktiv${policy.incident_activated_by ? ` (von ${policy.incident_activated_by})` : ""}. Self-Heal eingeschränkt.`,
      score: SEV_SCORE.critical + 40,
    });
  }
  if (summary && summary.heals_failed_24h >= 5) {
    queue.push({
      code: "HEAL_FAIL_SPIKE", action_type: "*", severity: "high",
      metric: summary.heals_failed_24h,
      detail: `${summary.heals_failed_24h} fehlgeschlagene Heals in 24h — Worker/Policy prüfen.`,
      score: SEV_SCORE.high + summary.heals_failed_24h,
    });
  }
  if (summary && summary.heals_24h === 0 && (summary.failed_1h > 0 || summary.stuck_jobs > 0)) {
    queue.push({
      code: "HEAL_SILENCE", action_type: "*", severity: "high",
      metric: summary.failed_1h + summary.stuck_jobs,
      detail: `Keine Heals in 24h trotz ${summary.failed_1h} failed_1h / ${summary.stuck_jobs} stuck — Cron/Worker tot?`,
      score: SEV_SCORE.high + 20,
    });
  }
  if (summary && summary.heals_24h > 100) {
    queue.push({
      code: "HEAL_THRASHING", action_type: "*", severity: "medium",
      metric: summary.heals_24h,
      detail: `${summary.heals_24h} Heals in 24h — möglicherweise Loop, Cooldowns prüfen.`,
      score: SEV_SCORE.medium + Math.floor(summary.heals_24h / 10),
    });
  }

  for (const k of action_types) {
    if (k.regressed > k.improved && k.followup_checked >= 3) {
      queue.push({
        code: "ACTION_REGRESSION", action_type: k.action_type, severity: "high",
        metric: k.regressed,
        detail: `${k.regressed}× regressed > ${k.improved}× improved (Δ ${k.avg_score_delta}) — Heal verschlechtert das System.`,
        score: SEV_SCORE.high + k.regressed * 2,
      });
    }
    if (k.success_rate < 0.5 && (k.success + k.failed) >= 5) {
      queue.push({
        code: "ACTION_HIGH_FAILURE", action_type: k.action_type, severity: "high",
        metric: Math.round((1 - k.success_rate) * 100),
        detail: `Success-Rate ${Math.round(k.success_rate * 100)}% bei ${k.success + k.failed} Versuchen.`,
        score: SEV_SCORE.high + Math.round((1 - k.success_rate) * 50),
      });
    }
    if (k.followup_checked >= 5 && k.improved === 0 && k.no_change >= 5) {
      queue.push({
        code: "ACTION_NO_EFFECT", action_type: k.action_type, severity: "medium",
        metric: k.no_change,
        detail: `0× improved bei ${k.followup_checked} Follow-ups — Heal hat keinen messbaren Effekt.`,
        score: SEV_SCORE.medium + k.no_change,
      });
    }
    if (k.total_7d >= 10 && k.followup_coverage < 0.2) {
      queue.push({
        code: "ACTION_NO_FOLLOWUP", action_type: k.action_type, severity: "medium",
        metric: Math.round(k.followup_coverage * 100),
        detail: `Nur ${Math.round(k.followup_coverage * 100)}% Follow-up-Coverage bei ${k.total_7d} Runs.`,
        score: SEV_SCORE.medium + (10 - Math.round(k.followup_coverage * 10)),
      });
    }
  }

  queue.sort((a, b) => b.score - a.score || a.action_type.localeCompare(b.action_type));

  // System aggregates
  const heals24h = summary?.heals_24h ?? action_types.reduce((s, a) => s + a.total_24h, 0);
  const successRate24h = (summary && (summary.heals_success_24h + summary.heals_failed_24h) > 0)
    ? summary.heals_success_24h / (summary.heals_success_24h + summary.heals_failed_24h)
    : 1;
  const totalFollowup = action_types.reduce((s, a) => s + a.followup_checked, 0);
  const totalImproved = action_types.reduce((s, a) => s + a.improved, 0);
  const effective_rate_7d = totalFollowup > 0 ? totalImproved / totalFollowup : 0;

  return {
    generated_at: input.now_iso,
    projector_version: PROJECTOR_VERSION,
    system: {
      health_score: summary?.health_score ?? 100,
      traffic_light: summary?.traffic_light ?? "green",
      auto_heal_allowed: summary?.auto_heal_allowed ?? true,
      incident_mode: !!policy?.incident_mode,
      heals_24h: heals24h,
      heals_success_24h: summary?.heals_success_24h ?? 0,
      heals_failed_24h: summary?.heals_failed_24h ?? 0,
      heals_24h_success_rate: Math.round(successRate24h * 1000) / 1000,
      distinct_actions_7d: action_types.length,
      effective_rate_7d: Math.round(effective_rate_7d * 1000) / 1000,
    },
    policy: {
      is_active: !!policy?.is_active,
      incident_mode: !!policy?.incident_mode,
      incident_activated_at: policy?.incident_activated_at ?? null,
      incident_activated_by: policy?.incident_activated_by ?? null,
      requires_approval: policy?.requires_approval ?? [],
      cooldown_keys: policy?.cooldowns ? Object.keys(policy.cooldowns) : [],
    },
    action_types,
    action_queue: queue,
    trigger_breakdown,
  };
}
