/**
 * Heal-Cockpit v8.2 — API layer
 * Thin wrappers around Supabase client. No business logic here.
 */
import { supabase } from "@/integrations/supabase/client";
import type {
  BulkHealResponse,
  HealWorklistFilters,
  HealWorklistRow,
  MorningBriefing,
} from "./types";

/** Allowlist for explicit override actions in bulk RPC. RPC enforces the same. */
export type BulkOverrideAction = "bulk_reconcile";

export async function getMorningBriefing(): Promise<MorningBriefing> {
  const { data, error } = await supabase
    .from("v_admin_morning_briefing" as never)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as MorningBriefing) ?? {
    newly_blocked_count: 0,
    newly_published_count: 0,
    completed_repairs_24h: 0,
    failed_jobs_24h: 0,
    quality_no_progress_blocks: 0,
    wip_active: 0,
    wip_capacity: null,
    critical_actions_pending: 0,
    publish_ready_count: 0,
  };
}

export async function getHealWorklist(
  filters: HealWorklistFilters = {},
): Promise<HealWorklistRow[]> {
  let q = supabase
    .from("v_admin_heal_cockpit" as never)
    .select("*")
    .order("urgency_score", { ascending: false })
    .limit(500);

  if (filters.recommended_action && filters.recommended_action !== "all") {
    q = q.eq("recommended_action", filters.recommended_action);
  }
  if (filters.actionability_class && filters.actionability_class !== "all") {
    q = q.eq("actionability_class", filters.actionability_class);
  }
  if (filters.release_class && filters.release_class !== "all") {
    q = q.eq("release_class", filters.release_class);
  }

  const { data, error } = await q;
  if (error) throw error;

  // v1: top-500 by urgency_score from server, search filtering is client-side.
  // Side effect: search may not surface matches outside the top-500 window.
  let rows = ((data ?? []) as unknown as HealWorklistRow[]).map((row) => ({
    ...row,
    recommended_action_reasons: row.recommended_action_reasons ?? [],
    deficiency_codes: row.deficiency_codes ?? [],
    open_jobs_by_type: row.open_jobs_by_type ?? {},
  }));

  // Reichere mit Track-Code an (für Track-aware UI-Filterung in GuidedRecoveryModal).
  // Einzelner Bulk-Lookup statt N+1.
  const pkgIds = rows.map((r) => r.package_id).filter(Boolean);
  if (pkgIds.length > 0) {
    const { data: pkgs } = await supabase
      .from("course_packages")
      .select("id, track")
      .in("id", pkgIds);
    if (pkgs) {
      const trackById = new Map<string, string | null>(
        (pkgs as Array<{ id: string; track: string | null }>).map((p) => [p.id, p.track]),
      );
      rows = rows.map((r) => ({ ...r, track: trackById.get(r.package_id) ?? null }));
    }
  }

  if (filters.search?.trim()) {
    const needle = filters.search.trim().toLowerCase();
    rows = rows.filter((r) =>
      [r.package_title, r.course_title, r.package_id]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(needle)),
    );
  }
  return rows;
}

export async function smartHealBulk(
  packageIds: string[],
  callerId?: string | null,
  action?: BulkOverrideAction,
): Promise<BulkHealResponse> {
  const { data, error } = await supabase.rpc("admin_smart_heal_bulk" as never, {
    p_package_ids: packageIds,
    p_caller_id: callerId ?? null,
    p_action: action ?? null,
  } as never);
  if (error) throw error;
  return data as unknown as BulkHealResponse;
}
