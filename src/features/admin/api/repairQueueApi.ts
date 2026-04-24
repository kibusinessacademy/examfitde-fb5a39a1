/**
 * Repair Queue Dashboard — Data Layer
 * ───────────────────────────────────
 * Combines three SSOT sources into a per-package repair-status row:
 *   1. v_admin_packages_ssot      → track / status / build_progress / current_step / blocked_reason
 *   2. ops_validate_exam_pool_progress → approved_count / missing_competency_coverage /
 *                                        guard_state / reason_code / active_*_jobs / recommended_action
 *   3. job_queue (live)           → pending/processing repair jobs incl. payload mode &
 *                                   target_competency_ids count → "why is it stalled?"
 *
 * Read-only; no mutations.
 */
import { supabase } from "@/integrations/supabase/client";

export type RepairQueueRow = {
  package_id: string;
  title: string;
  track: string | null;
  status: string;
  build_progress: number;
  current_step: string | null;
  blocked_reason: string | null;
  // exam-pool gate signals
  approved_count: number;
  review_count: number;
  missing_lf_coverage: number;
  missing_competency_coverage: number;
  guard_state: string | null;
  reason_code: string | null;
  recommended_action: string | null;
  consecutive_no_progress: number;
  last_validate_at: string | null;
  last_repair_at: string | null;
  // job-queue signals
  active_validate_jobs: number;
  active_repair_jobs: number;
  validate_attempts_24h: number;
  repair_attempts_24h: number;
  has_active_lease: boolean;
  // live repair jobs detail
  live_repair_jobs: LiveRepairJob[];
  // computed verdict
  stall_reason: StallReason;
};

export type LiveRepairJob = {
  id: string;
  job_type: string;
  status: string;
  mode: string | null;
  target_competency_count: number;
  auto_heal_origin: string | null;
  resolved_strategy: string | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type StallReason =
  | { kind: "ok"; label: string }
  | { kind: "running"; label: string }
  | { kind: "no_repair_enqueued"; label: string }
  | { kind: "wrong_repair_route"; label: string }
  | { kind: "hard_fail"; label: string }
  | { kind: "exhausted"; label: string }
  | { kind: "no_progress"; label: string }
  | { kind: "unknown"; label: string };

type ProgressRow = {
  package_id: string;
  title: string | null;
  approved_count: number;
  review_count: number;
  missing_lf_coverage: number;
  missing_competency_coverage: number;
  guard_state: string | null;
  reason_code: string | null;
  recommended_action: string | null;
  consecutive_no_progress: number;
  last_validate_at: string | null;
  last_repair_at: string | null;
  active_validate_jobs: number;
  active_repair_jobs: number;
  validate_attempts_24h: number;
  repair_attempts_24h: number;
  has_active_lease: boolean;
};

type SsotRow = {
  package_id: string;
  canonical_title: string;
  track: string | null;
  status: string;
  build_progress: number;
  current_step: string | null;
  blocked_reason: string | null;
};

type LiveJobRow = {
  id: string;
  package_id: string;
  job_type: string;
  status: string;
  payload: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

const REPAIR_JOB_TYPES = [
  "package_repair_exam_pool",
  "package_repair_exam_pool_quality",
  "package_repair_exam_pool_competency_coverage",
  "package_repair_exam_pool_lf_coverage",
  "package_repair_learning_content",
  "package_repair_lessons",
  "package_repair_handbook",
  "package_repair_minichecks",
  "package_repair_oral_exam",
  "package_exam_rebalance",
  "package_generate_exam_pool",
];

export type RepairQueueFilter = {
  trackOnly?: string | null;
  onlyStalled?: boolean;
  search?: string;
};

export async function getRepairQueueOverview(filter: RepairQueueFilter = {}): Promise<RepairQueueRow[]> {
  // Pull all three sources in parallel
  const [progressRes, ssotRes, jobsRes] = await Promise.all([
    supabase
      .from("ops_validate_exam_pool_progress")
      .select(
        "package_id, title, approved_count, review_count, missing_lf_coverage, missing_competency_coverage, guard_state, reason_code, recommended_action, consecutive_no_progress, last_validate_at, last_repair_at, active_validate_jobs, active_repair_jobs, validate_attempts_24h, repair_attempts_24h, has_active_lease",
      )
      .limit(1000),
    supabase
      .from("v_admin_packages_ssot")
      .select("package_id, canonical_title, track, status, build_progress, current_step, blocked_reason")
      .limit(1000),
    supabase
      .from("job_queue")
      .select("id, package_id, job_type, status, payload, meta, attempts, last_error, created_at, updated_at")
      .in("status", ["pending", "processing"])
      .in("job_type", REPAIR_JOB_TYPES)
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);

  if (progressRes.error) throw progressRes.error;
  if (ssotRes.error) throw ssotRes.error;
  if (jobsRes.error) throw jobsRes.error;

  const progress = (progressRes.data ?? []) as ProgressRow[];
  const ssot = (ssotRes.data ?? []) as SsotRow[];
  const jobs = (jobsRes.data ?? []) as LiveJobRow[];

  const ssotById = new Map(ssot.map((r) => [r.package_id, r]));
  const jobsById = new Map<string, LiveRepairJob[]>();
  for (const j of jobs) {
    const payload = (j.payload ?? {}) as Record<string, unknown>;
    const meta = (j.meta ?? {}) as Record<string, unknown>;
    const targetIds = payload.target_competency_ids;
    const live: LiveRepairJob = {
      id: j.id,
      job_type: j.job_type,
      status: j.status,
      mode: typeof payload.mode === "string" ? payload.mode : null,
      target_competency_count: Array.isArray(targetIds) ? targetIds.length : 0,
      auto_heal_origin: typeof meta.auto_heal_origin === "string" ? meta.auto_heal_origin : null,
      resolved_strategy: typeof meta.resolved_strategy === "string" ? meta.resolved_strategy : null,
      attempts: j.attempts ?? 0,
      last_error: j.last_error,
      created_at: j.created_at,
      updated_at: j.updated_at,
    };
    if (!jobsById.has(j.package_id)) jobsById.set(j.package_id, []);
    jobsById.get(j.package_id)!.push(live);
  }

  const rows: RepairQueueRow[] = progress
    .map((p) => {
      const meta = ssotById.get(p.package_id);
      if (!meta) return null;
      const liveJobs = jobsById.get(p.package_id) ?? [];
      const row: RepairQueueRow = {
        package_id: p.package_id,
        title: meta.canonical_title || p.title || "—",
        track: meta.track,
        status: meta.status,
        build_progress: meta.build_progress ?? 0,
        current_step: meta.current_step,
        blocked_reason: meta.blocked_reason,
        approved_count: p.approved_count ?? 0,
        review_count: p.review_count ?? 0,
        missing_lf_coverage: p.missing_lf_coverage ?? 0,
        missing_competency_coverage: p.missing_competency_coverage ?? 0,
        guard_state: p.guard_state,
        reason_code: p.reason_code,
        recommended_action: p.recommended_action,
        consecutive_no_progress: p.consecutive_no_progress ?? 0,
        last_validate_at: p.last_validate_at,
        last_repair_at: p.last_repair_at,
        active_validate_jobs: Number(p.active_validate_jobs ?? 0),
        active_repair_jobs: Number(p.active_repair_jobs ?? 0),
        validate_attempts_24h: Number(p.validate_attempts_24h ?? 0),
        repair_attempts_24h: Number(p.repair_attempts_24h ?? 0),
        has_active_lease: !!p.has_active_lease,
        live_repair_jobs: liveJobs,
        stall_reason: { kind: "unknown", label: "—" },
      };
      row.stall_reason = computeStallReason(row);
      return row;
    })
    .filter((r): r is RepairQueueRow => r !== null);

  // Apply filters
  let out = rows;
  if (filter.trackOnly) {
    out = out.filter((r) => (r.track ?? "").toUpperCase() === filter.trackOnly!.toUpperCase());
  }
  if (filter.onlyStalled) {
    out = out.filter((r) => r.stall_reason.kind !== "ok" && r.stall_reason.kind !== "running");
  }
  if (filter.search?.trim()) {
    const q = filter.search.trim().toLowerCase();
    out = out.filter((r) => r.title.toLowerCase().includes(q) || r.package_id.startsWith(q));
  }

  // Sort: stalled first, then by least progress
  const stallRank: Record<StallReason["kind"], number> = {
    hard_fail: 0,
    exhausted: 1,
    wrong_repair_route: 2,
    no_repair_enqueued: 3,
    no_progress: 4,
    unknown: 5,
    running: 6,
    ok: 7,
  };
  out.sort((a, b) => {
    const ra = stallRank[a.stall_reason.kind];
    const rb = stallRank[b.stall_reason.kind];
    if (ra !== rb) return ra - rb;
    return a.build_progress - b.build_progress;
  });

  return out;
}

/**
 * Heuristic mirror of fn_auto_heal_cluster routing logic, intended only for UI explanation:
 * If the package has a competency-coverage gap but no active competency-targeted repair job,
 * we surface that as the stall reason — exactly the §34f failure mode described in the brief.
 */
function computeStallReason(r: RepairQueueRow): StallReason {
  const reason = (r.reason_code ?? "").toUpperCase();
  const guard = (r.guard_state ?? "").toLowerCase();

  if (reason.startsWith("HARD_FAIL")) {
    return { kind: "hard_fail", label: `HARD_FAIL: ${r.reason_code}` };
  }
  if (reason === "HARD_FAIL_REPAIR_EXHAUSTED" || guard === "exhausted") {
    return { kind: "exhausted", label: "Repair-Versuche erschöpft" };
  }
  if (guard === "pass_ready" || reason === "GATE_PASS") {
    return { kind: "ok", label: "Gate passed" };
  }

  const competencyJobs = r.live_repair_jobs.filter(
    (j) =>
      j.job_type === "package_repair_exam_pool_competency_coverage" ||
      j.mode === "targeted_competency_fill" ||
      j.target_competency_count > 0,
  );
  const wrongRouteJobs = r.live_repair_jobs.filter(
    (j) => j.job_type === "package_exam_rebalance" && r.missing_competency_coverage > 0,
  );

  if (r.missing_competency_coverage > 0) {
    if (competencyJobs.length === 0 && wrongRouteJobs.length > 0) {
      return {
        kind: "wrong_repair_route",
        label: `Falsches Repair: ${wrongRouteJobs.length}× exam_rebalance statt competency_fill (${r.missing_competency_coverage} fehlende Kompetenzen)`,
      };
    }
    if (competencyJobs.length === 0 && r.active_repair_jobs === 0) {
      return {
        kind: "no_repair_enqueued",
        label: `${r.missing_competency_coverage} fehlende Kompetenzen, aber kein competency_fill-Job in Queue`,
      };
    }
  }

  if (competencyJobs.length > 0) {
    return {
      kind: "running",
      label: `competency_fill läuft (${competencyJobs[0].status}, ${competencyJobs[0].target_competency_count} Targets)`,
    };
  }
  if (r.active_repair_jobs > 0 || r.active_validate_jobs > 0) {
    return { kind: "running", label: "Repair/Validate aktiv" };
  }
  if (r.consecutive_no_progress >= 3) {
    return {
      kind: "no_progress",
      label: `${r.consecutive_no_progress}× ohne Fortschritt (recommended: ${r.recommended_action ?? "—"})`,
    };
  }
  return { kind: "unknown", label: r.reason_code ?? r.recommended_action ?? "—" };
}
