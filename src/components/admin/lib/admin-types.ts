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
  package_title: string | null;
  error: string | null;
  created_at: string;
}

export interface AdminControlTowerResponse {
  health: GlobalHealthItem[];
  alerts: CriticalAlertItem[];
  kpis: TowerKpis;
  pipeline: PipelineStepStat[];
}

export interface DashboardBuildingPackage {
  id: string;
  title: string;
  status: string;
  build_progress: number;
  current_step: string | null;
  step_status_json: Record<string, string> | null;
  updated_at: string;
}

export interface DashboardKpis {
  total_packages: number;
  building: number;
  queued: number;
  published: number;
  done: number;
  failed: number;
  jobs_pending: number;
  jobs_processing: number;
  jobs_completed_today: number;
  jobs_failed_24h: number;
  cost_today_eur: number;
  budget_eur: number;
  stalled_packages: number;
  provider_cooldowns: number;
  blocked_publishables: number;
  open_claim_issues: number;
  lc_starvation: number;
  revenue_30d: number;
  building_metrics: {
    active_by_jobs: number;
    active_by_leases: number;
    status_building: number;
    zombies: number;
  };
}

export interface DashboardCooldown {
  provider: string;
  model: string;
  reason: string | null;
  until_at: string;
}

export interface DashboardResponse {
  health: GlobalHealthItem[];
  kpis: DashboardKpis;
  building_packages: DashboardBuildingPackage[];
  pipeline: PipelineStepStat[];
  cooldowns: DashboardCooldown[];
}
