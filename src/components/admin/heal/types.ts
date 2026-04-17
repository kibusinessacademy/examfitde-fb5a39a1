/**
 * Heal-Cockpit v8.2 — Type definitions
 * SSOT: v_admin_heal_cockpit, v_admin_morning_briefing, admin_smart_heal_bulk
 */

export type RecommendedAction =
  | "hard_rebuild"
  | "guided_recovery"
  | "mark_content_gap"
  | "force_publish"
  | "needs_repair_dispatch"
  | "bulk_reconcile"
  | "awaiting_pipeline"
  | "monitor"
  | "manual_review";

export type ActionabilityClass = "auto" | "modal" | "confirm" | "observe";

export type ReleaseClass = "release_ok" | "release_warn" | "release_block" | null;

export interface HealWorklistRow {
  package_id: string;
  package_title: string | null;
  course_title: string | null;
  curriculum_id: string | null;
  package_status: string | null;
  is_published: boolean | null;
  blocked_reason: string | null;
  release_class: ReleaseClass;
  deficiency_codes: string[] | null;
  pending_jobs: number;
  processing_jobs: number;
  failed_jobs_24h: number;
  active_repair_jobs: number;
  active_reconcile_jobs: number;
  repair_attempts_proxy: number;
  exhausted_steps: number;
  blocked_steps: number;
  last_processing_at: string | null;
  last_step_change: string | null;
  package_updated_at: string | null;
  open_jobs_by_type: Record<string, number>;
  recommended_action: RecommendedAction;
  actionability_class: ActionabilityClass;
  recommended_action_reasons: string[];
  urgency_score: number;
}

export interface MorningBriefing {
  newly_blocked_count: number;
  newly_published_count: number;
  completed_repairs_24h: number;
  failed_jobs_24h: number;
  quality_no_progress_blocks: number;
  wip_active: number;
  wip_capacity: number | null;
  critical_actions_pending: number;
  publish_ready_count: number;
}

export interface BulkHealOutcomeItem {
  package_id: string;
  action?: string;
  reason?: string;
  result?: string;
  error?: string;
  reasons?: string[];
}

export interface BulkHealResponse {
  ok: boolean;
  executed: BulkHealOutcomeItem[];
  skipped: BulkHealOutcomeItem[];
  needs_modal: BulkHealOutcomeItem[];
  needs_confirmation: BulkHealOutcomeItem[];
}

export interface HealWorklistFilters {
  recommended_action?: RecommendedAction | "all";
  actionability_class?: ActionabilityClass | "all";
  release_class?: ReleaseClass | "all";
  search?: string;
}

export const ACTION_LABEL: Record<RecommendedAction, string> = {
  hard_rebuild: "Hard Rebuild",
  guided_recovery: "Guided Recovery",
  mark_content_gap: "Content-Gap markieren",
  force_publish: "Force Publish",
  needs_repair_dispatch: "Repair Dispatch",
  bulk_reconcile: "Reconcile Artefakte",
  awaiting_pipeline: "Awaiting Pipeline",
  monitor: "Monitoring",
  manual_review: "Manual Review",
};

export const ACTION_DESCRIPTION: Record<RecommendedAction, string> = {
  hard_rebuild: "Published Paket mit Defekten — kompletter Rebuild nötig",
  guided_recovery: "Quality-No-Progress oder erschöpfte Steps — geführte Reparatur",
  mark_content_gap: "Wiederholte Repair-Fehlschläge — als Content-Lücke markieren",
  force_publish: "Release-OK & nicht published — direkt veröffentlichen",
  needs_repair_dispatch: "Pipeline-Repair erforderlich — Reconcile-Job kicken",
  bulk_reconcile: "Release-Warn ohne aktive Jobs — Artefakt-Abgleich",
  awaiting_pipeline: "Frisches blockiertes Paket ohne gestartete Jobs — zunächst beobachten",
  monitor: "Aktive Verarbeitung läuft — beobachten",
  manual_review: "Kein klares Aktions-Signal — manuelle Sichtung",
};
