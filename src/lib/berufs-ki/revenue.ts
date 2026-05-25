/**
 * Berufs-KI Revenue UX — Client API (BK-Act-2).
 *
 * Wraps the three learner-facing SSOT RPCs:
 *  - learner_get_workflow_usage_summary
 *  - learner_get_workflow_upgrade_signal
 *  - learner_get_locked_workflow_preview
 *
 * Plus a thin tracking helper that logs upgrade-signal exposure into
 * `auto_heal_log` via `fn_emit_audit` for downstream conversion measurement.
 */
import { supabase } from "@/integrations/supabase/client";

export type CapacityHint =
  | "unlimited"
  | "comfortable"
  | "plenty"
  | "heavy_usage"
  | "near_daily_limit";

export interface WorkflowUsageSummary {
  tier: "free" | "pro" | "business";
  window_days: number;
  runs_today: number;
  runs_window: number;
  minutes_saved_window: number;
  distinct_workflows: number;
  heavy_runs_today: number;
  top_workflows: Array<{
    slug: string;
    title: string;
    category: string;
    tier_required: string;
    runs: number;
    last_at: string;
  }>;
  per_day: Array<{ day: string; runs: number }>;
  categories: Array<{ category: string; runs: number }>;
  business_signal: boolean;
  capacity_hint: CapacityHint;
  generated_at: string;
  error?: string;
}

export type UpgradeRecommendation =
  | "stay_free"
  | "stay_current"
  | "upgrade_pro"
  | "upgrade_business"
  | "auth_required";

export interface WorkflowUpgradeSignal {
  recommendation: UpgradeRecommendation;
  tier_current: "free" | "pro" | "business";
  tier_target: "pro" | "business" | null;
  human_label: string | null;
  reasons: string[];
  runs_7d: number;
  runs_30d: number;
  distinct_workflows_7d: number;
  locked_attempts_30d: number;
  business_locked_30d: number;
  generated_at: string;
}

export interface LockedWorkflowPreview {
  slug: string;
  title: string;
  description: string;
  category: string;
  tier_required: "free" | "pro" | "business";
  tier_actual: "free" | "pro" | "business";
  is_locked: boolean;
  outcome: string;
  use_case: string;
  estimated_time_saved_minutes: number;
  output_sample_sections: string[];
  has_curriculum_binding: boolean;
  has_competency_binding: boolean;
  error?: string;
}

export async function fetchWorkflowUsageSummary(
  windowDays = 7,
): Promise<WorkflowUsageSummary | null> {
  const { data, error } = await supabase.rpc("learner_get_workflow_usage_summary", {
    p_days: windowDays,
  });
  if (error) throw error;
  return (data ?? null) as WorkflowUsageSummary | null;
}

export async function fetchWorkflowUpgradeSignal(): Promise<WorkflowUpgradeSignal | null> {
  const { data, error } = await supabase.rpc("learner_get_workflow_upgrade_signal");
  if (error) throw error;
  return (data ?? null) as WorkflowUpgradeSignal | null;
}

export async function fetchLockedWorkflowPreview(
  slug: string,
): Promise<LockedWorkflowPreview | null> {
  const { data, error } = await supabase.rpc("learner_get_locked_workflow_preview", {
    p_slug: slug,
  });
  if (error) throw error;
  return (data ?? null) as LockedWorkflowPreview | null;
}

/**
 * Best-effort logging of upgrade-signal exposure for downstream conversion
 * measurement. Silent on failure — never blocks the UI.
 */
export async function trackUpgradeSignalShown(signal: WorkflowUpgradeSignal): Promise<void> {
  if (signal.recommendation === "stay_free" || signal.recommendation === "stay_current") return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.rpc as any)("fn_emit_audit", {
      _action_type: "workflow_upgrade_signal_shown",
      _details: {
        recommendation: signal.recommendation,
        tier_current: signal.tier_current,
        tier_target: signal.tier_target,
        reason_count: signal.reasons.length,
      },
    });
  } catch {
    // intentionally swallowed — tracking is best-effort
  }
}

export function capacityHintLabel(hint: CapacityHint, tier: WorkflowUsageSummary["tier"]): string {
  switch (hint) {
    case "unlimited":
      return "Unbegrenzte AI-Kapazität für dein Team.";
    case "comfortable":
      return "Noch genug Kapazität für diese Woche.";
    case "plenty":
      return tier === "free"
        ? "Heute noch nichts genutzt — leg los."
        : "Reichlich Kapazität verfügbar.";
    case "heavy_usage":
      return "Heavy-Usage-Tag erkannt — du nutzt Berufs-KI intensiv.";
    case "near_daily_limit":
      return "Free-Tageslimit fast erreicht.";
  }
}

export function formatMinutesSaved(minutes: number): string {
  if (!minutes || minutes < 1) return "Noch keine Zeitersparnis gemessen";
  if (minutes < 60) return `${minutes} Minuten gespart`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} Stunden gespart` : `${h} Std ${m} Min gespart`;
}
