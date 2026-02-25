import type { PipelineStepKey } from '@/lib/pipeline-steps';
import { FULL_STEP_ORDER, PIPELINE_STEP_SHORT_LABELS, PACKAGE_STATUS_CONFIG } from '@/lib/pipeline-steps';

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
}

// Re-export from SSOT
export { PACKAGE_STATUS_CONFIG };

/** @deprecated Use PIPELINE_STEP_SHORT_LABELS from '@/lib/pipeline-steps' */
export const STEP_LABELS = PIPELINE_STEP_SHORT_LABELS as Record<string, string>;

/** @deprecated Use FULL_STEP_ORDER from '@/lib/pipeline-steps' */
export const STEP_ORDER = FULL_STEP_ORDER as readonly string[];

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
