export interface PackageInfo {
  id: string;
  title: string | null;
  status: string;
  build_progress: number;
  priority: number;
  current_step: string | null;
  step_status_json: Record<string, string> | null;
  created_at: string;
  updated_at: string;
  track: string | null;
  curriculum_id: string | null;
}

export interface PlatformKPIs {
  seoPages: number;
  ticketsOpen: number;
  ticketsTotal: number;
  usersTotal: number;
  ordersPaid: number;
  revenueCents: number;
}

export interface QueueHealth {
  pending: number;
  processing: number;
  failed: number;
  stuck: number;
}

export interface BudgetInfo {
  dailyCost: number;
  monthBudget: number;
  monthSpent: number;
}

export interface AIDiagnose {
  risks: { scope_id: string; score: number; risk_type: string }[];
  recommendations: { title: string; impact: string; council_id: string }[];
  systemHealth: { failedJobs: number; pendingJobs: number; gatePassRate: number; aiCostMtd: number; budgetPct: number } | null;
}
