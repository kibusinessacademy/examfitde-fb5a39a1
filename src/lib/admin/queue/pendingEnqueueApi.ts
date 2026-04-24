/**
 * Pending-Enqueue Observability API
 * ─────────────────────────────────
 * Wrappers für Cron Health Monitor, Stuck Steps View, Reschedule-Log und
 * Manual-Review-Queue. Kein Heal-Pfad — reine Observability + Manual-Resolution.
 *
 * Quellen (SSOT):
 *   - public.v_pending_enqueue_cron_health
 *   - public.v_pending_enqueue_stuck
 *   - public.pending_enqueue_reschedule_log
 *   - public.pending_enqueue_manual_review
 */
import { supabase } from "@/integrations/supabase/client";

export type CronHealth =
  | "healthy"
  | "lagging"
  | "last_run_failed"
  | "disabled"
  | "never_ran";

export interface CronHealthRow {
  jobname: string;
  schedule: string;
  active: boolean;
  last_start: string | null;
  last_end: string | null;
  last_status: string | null;
  last_message: string | null;
  seconds_since_last_run: number | null;
  health: CronHealth;
  healed_1h: number;
  failed_1h: number;
  skipped_1h: number;
  last_log_at: string | null;
}

export type FixPrognosis =
  | "eligible_now"
  | "awaiting_min_age"
  | "blocked_by_active_job"
  | "blocked_by_package_status"
  | "manual_review_required";

export interface StuckStepRow {
  package_id: string;
  step_key: string;
  pending_since: string | null;
  age_seconds: number;
  package_status: string | null;
  package_title: string | null;
  has_active_job: boolean;
  fix_prognosis: FixPrognosis;
  manual_review_id: string | null;
  manual_review_status: ManualReviewStatus | null;
  manual_review_failure_count: number | null;
  manual_review_last_error: string | null;
}

export interface AuditExportRow {
  log_id: number;
  created_at: string;
  package_id: string;
  package_title: string | null;
  step_key: string;
  prev_status: string | null;
  new_status: string | null;
  reason: string | null;
  triggered_by: string | null;
  age_seconds: number | null;
  error_message: string | null;
  cron_run_id: number | null;
  cron_job_id: number | null;
  cron_start_time: string | null;
  cron_run_status: string | null;
}

export interface RescheduleLogRow {
  id: number;
  package_id: string;
  step_key: string;
  prev_status: string | null;
  new_status: string | null;
  reason: string | null;
  triggered_by: string | null;
  age_seconds: number | null;
  created_at: string;
}

export type ManualReviewStatus = "open" | "investigating" | "resolved" | "wont_fix";

export interface ManualReviewRow {
  id: string;
  package_id: string;
  step_key: string;
  failure_count: number;
  first_failed_at: string;
  last_failed_at: string;
  last_error: string | null;
  status: ManualReviewStatus;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchCronHealth(): Promise<CronHealthRow[]> {
  const { data, error } = await supabase
    .from("v_pending_enqueue_cron_health" as never)
    .select("*");
  if (error) throw error;
  return (data ?? []) as CronHealthRow[];
}

export async function fetchStuckSteps(): Promise<StuckStepRow[]> {
  const { data, error } = await supabase
    .from("v_pending_enqueue_stuck_enriched" as never)
    .select("*")
    .order("age_seconds", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as StuckStepRow[];
}

export async function fetchAuditExport(limitRows = 1000): Promise<AuditExportRow[]> {
  const { data, error } = await supabase
    .from("v_pending_enqueue_audit_export" as never)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limitRows);
  if (error) throw error;
  return (data ?? []) as AuditExportRow[];
}

// ─── Admin RPC wrappers ──────────────────────────────────────────────────

export interface RpcResult { ok: boolean; error?: string; [k: string]: unknown }

export async function forceRescheduleStep(packageId: string, stepKey: string): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("fn_force_reschedule_step" as never, {
    p_package_id: packageId, p_step_key: stepKey,
  } as never);
  if (error) return { ok: false, error: error.message };
  return data as RpcResult;
}

export async function cancelPendingEnqueueStep(
  packageId: string, stepKey: string, reason: string,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("fn_cancel_pending_enqueue_step" as never, {
    p_package_id: packageId, p_step_key: stepKey, p_reason: reason,
  } as never);
  if (error) return { ok: false, error: error.message };
  return data as RpcResult;
}

export interface ReplayResult extends RpcResult {
  replay_marker?: string;
  window_minutes?: number;
  candidates_in_window?: number;
  rescheduled?: number;
  skipped_active?: number;
  skipped_not_building?: number;
  ran_at?: string;
}

export async function replayRecentReschedules(windowMinutes = 5, maxSteps = 100): Promise<ReplayResult> {
  const { data, error } = await supabase.rpc("fn_replay_recent_reschedules" as never, {
    p_window_minutes: windowMinutes, p_max_steps: maxSteps,
  } as never);
  if (error) return { ok: false, error: error.message };
  return data as ReplayResult;
}

// ─── Export helpers ──────────────────────────────────────────────────────

export function rowsToCsv(rows: AuditExportRow[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape((r as Record<string, unknown>)[h])).join(",")),
  ].join("\n");
}

export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

export async function fetchRescheduleLog(limit = 50): Promise<RescheduleLogRow[]> {
  const { data, error } = await supabase
    .from("pending_enqueue_reschedule_log" as never)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as RescheduleLogRow[];
}

export async function fetchManualReviewQueue(
  status: ManualReviewStatus | "all" = "open",
): Promise<ManualReviewRow[]> {
  let q = supabase
    .from("pending_enqueue_manual_review" as never)
    .select("*")
    .order("last_failed_at", { ascending: false });
  if (status !== "all") q = q.eq("status", status);
  const { data, error } = await q.limit(100);
  if (error) throw error;
  return (data ?? []) as ManualReviewRow[];
}

export async function updateManualReview(
  id: string,
  patch: { status?: ManualReviewStatus; resolution_note?: string },
): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const update: Record<string, unknown> = { ...patch };
  if (patch.status === "resolved" || patch.status === "wont_fix") {
    update.resolved_at = new Date().toISOString();
    update.resolved_by = userData.user?.id ?? null;
  }
  const { error } = await supabase
    .from("pending_enqueue_manual_review" as never)
    .update(update as never)
    .eq("id", id);
  if (error) throw error;
}
