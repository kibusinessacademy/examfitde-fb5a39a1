export type HealthTone = "green" | "yellow" | "red" | "neutral";

export interface GlobalHealthItem {
  key:
    | "system"
    | "queue"
    | "ai"
    | "build"
    | "quality"
    | "publish"
    | "learners"
    | "revenue"
    | "seo"
    | "crm"
    | "trust"
    | "dead_letter";
  label: string;
  tone: HealthTone;
  count: number;
  hint?: string | null;
}

export interface CriticalAlertItem {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  domain: "ops" | "quality" | "revenue" | "learner" | "seo" | "crm";
  title: string;
  detail: string;
  action_label?: string | null;
  action_type?: string | null;
}

export interface TowerKpis {
  pending_jobs: number;
  processing_jobs: number;
  completed_24h: number;
  failed_24h: number;
  stalled_packages: number;
  provider_cooldowns: number;
  blocked_publishables: number;
  open_claim_issues: number;
  lc_starvation: number;
}

export interface PipelineStepStat {
  step_key: string;
  queued: number;
  running: number;
  blocked: number;
  done: number;
  failed: number;
}

export interface ProviderHealthItem {
  provider: string;
  model: string;
  status: "healthy" | "degraded" | "cooldown" | "down";
  cooldown_until: string | null;
  success_rate_1h: number | null;
  avg_latency_ms_1h: number | null;
  requests_1h: number;
  failures_1h: number;
  top_reason: string | null;
}

export interface PackageRiskItem {
  package_id: string;
  package_title: string;
  curriculum_title: string | null;
  track: string | null;
  status: string;
  current_step: string | null;
  blocked_reason: string | null;
  stall_minutes: number | null;
  integrity_passed: boolean | null;
  placeholder_count: number | null;
  publish_ready: boolean | null;
  risk_score: number;
}

export interface RevenueOverview {
  orders_today: number;
  revenue_today: number;
  revenue_7d: number;
  revenue_30d: number;
  open_claim_issues: number;
  corporate_seats_total: number;
  corporate_seats_claimed: number;
  checkout_failures_24h: number;
}

export interface OpsJobItem {
  job_id: string;
  job_type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  package_ref: string | null;
  error: string | null;
  created_at: string;
}

export interface AdminControlTowerResponse {
  health: GlobalHealthItem[];
  alerts: CriticalAlertItem[];
  kpis: TowerKpis;
  pipeline: PipelineStepStat[];
}
