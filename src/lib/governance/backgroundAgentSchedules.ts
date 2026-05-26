/**
 * P72 — Scheduled Agent Runs (pure resolver)
 *
 * Normalisiert die Read-Only-Aggregation aus `admin_get_background_agent_schedules`
 * (cron.job + cron.job_run_details + system_intents) zu customer-facing
 * Workflow-Schedule-Karten.
 *
 * Invarianten:
 *  - KEINE supabase.from / supabase.rpc / fetch / Date.now / Math.random
 *  - KEINE Mutation
 *  - Customer-Labels ohne "curriculum repair" / "council"
 *  - Nur die 3 bekannten Workflow-Typen werden gerendert
 */
import type { WorkflowTriggerType } from "@/lib/governance/backgroundAgentWorkflowTriggers";
import { WORKFLOW_TRIGGER_REGISTRY } from "@/lib/governance/backgroundAgentWorkflowTriggers";
import type { BackgroundTaskLike } from "@/lib/governance/backgroundAgentActions";

export interface ScheduleRowLike {
  workflow_type: string;
  jobid: number | string | null;
  jobname: string;
  schedule: string;
  active: boolean | null;
  last_run_at: string | null;
  last_status: string | null;
  intent_count_24h: number | string | null;
}

export interface WorkflowScheduleCard {
  type: WorkflowTriggerType;
  /** Customer-safe label from WORKFLOW_TRIGGER_REGISTRY. */
  label: string;
  /** Short description (customer-safe). */
  description: string;
  /** Capability gate key (mirrors P70.4). */
  capabilityKey: string;
  /** Aggregated active state: any active cron row enables the workflow. */
  active: boolean;
  /** Number of bound cron rows. */
  scheduleCount: number;
  /** Aggregated risk level. */
  riskLevel: "low" | "medium" | "high";
  /** Most recent run across all bound schedules. */
  lastRunAt: string | null;
  lastStatus: string | null;
  /** Intent traffic in last 24h. */
  intentCount24h: number;
  /** Latest artifact count across matching tasks. */
  latestArtifactCount: number;
  /** Latest task (P71 preview source). */
  latestTask: BackgroundTaskLike | null;
  /** Stable evidence chain for the card. */
  evidenceChain: ScheduleEvidenceStep[];
  /** Source rows kept for traceability. */
  sources: Array<{
    source_type: "cron_job";
    source_id: string;
    jobname: string;
    schedule: string;
    active: boolean;
    lastRunAt: string | null;
    lastStatus: string | null;
  }>;
}

export interface ScheduleEvidenceStep {
  kind: "schedule" | "trigger" | "task" | "artifact" | "audit";
  label: string;
  detail: string;
}

const SUPPORTED: WorkflowTriggerType[] = [
  "seo_opportunity",
  "compliance_drift",
  "operational_quality",
];

const CUSTOMER_LABELS: Record<WorkflowTriggerType, string> = {
  seo_opportunity: "SEO Opportunity Scan",
  compliance_drift: "Compliance Drift Check",
  // never expose "curriculum repair" / "council" externally
  operational_quality: "Kontinuierliche Qualitätsoptimierung",
};

function asNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function isWorkflowType(t: string): t is WorkflowTriggerType {
  return (SUPPORTED as string[]).includes(t);
}

function deriveRiskLevel(
  type: WorkflowTriggerType,
  failingCount: number,
): "low" | "medium" | "high" {
  if (failingCount > 0) return "high";
  if (type === "operational_quality") return "medium";
  return "low";
}

function newerIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

/**
 * Pure: build one card per supported workflow type from raw rows + tasks.
 * Returns cards even when no cron row exists (empty-state for UI).
 */
export function buildScheduleCards(
  rows: ScheduleRowLike[],
  tasks: BackgroundTaskLike[] = [],
): WorkflowScheduleCard[] {
  const byType = new Map<WorkflowTriggerType, ScheduleRowLike[]>();
  for (const r of rows) {
    if (!isWorkflowType(r.workflow_type)) continue;
    const arr = byType.get(r.workflow_type) ?? [];
    arr.push(r);
    byType.set(r.workflow_type, arr);
  }

  return SUPPORTED.map((type) => {
    const descriptor = WORKFLOW_TRIGGER_REGISTRY[type];
    const myRows = byType.get(type) ?? [];

    const active = myRows.some((r) => r.active === true);
    let lastRunAt: string | null = null;
    let lastStatus: string | null = null;
    let failing = 0;
    let intent24h = 0;

    const sources = myRows.map((r) => {
      lastRunAt = newerIso(lastRunAt, r.last_run_at);
      if (r.last_run_at === lastRunAt) lastStatus = r.last_status ?? lastStatus;
      if ((r.last_status ?? "").toLowerCase() === "failed") failing += 1;
      intent24h += asNumber(r.intent_count_24h);
      return {
        source_type: "cron_job" as const,
        source_id: String(r.jobid ?? r.jobname),
        jobname: r.jobname,
        schedule: r.schedule,
        active: r.active === true,
        lastRunAt: r.last_run_at,
        lastStatus: r.last_status,
      };
    });

    // Match tasks to workflow type via existing classifier sources.
    const matchingTasks = tasks.filter((t) => {
      const hay = `${t.capability_summary ?? ""} ${t.source_type}`.toLowerCase();
      if (type === "seo_opportunity") return /seo|sitemap|cluster|intent[_-]?page|persona[_-]?landing|cert[_-]?pillar|keyword|internal[_-]?link/i.test(hay);
      if (type === "compliance_drift") return /compliance|dsgvo|gdpr|ai[_-]?act|trust|evidence|audit[_-]?export|provider[_-]?drift|azav/i.test(hay);
      return /heal|repair|integrity|council|quality|tutor|minicheck|blueprint|curriculum|exam[_-]?pool|pipeline/i.test(hay)
        || t.source_type === "heal_permanent_fix_tasks";
    });

    // Latest task by last_event_at-equivalent: callers pass already-sorted tasks; fallback to first.
    const latestTask = matchingTasks[0] ?? null;
    const latestArtifactCount = matchingTasks.reduce(
      (acc, t) => acc + (t.artifact_count ?? 0),
      0,
    );

    const riskLevel = deriveRiskLevel(type, failing);

    const evidenceChain: ScheduleEvidenceStep[] = [
      {
        kind: "schedule",
        label: "Zeitplan",
        detail: sources.length > 0
          ? `${sources.length} aktiver Cron-Eintrag${sources.length === 1 ? "" : "e"}`
          : "Kein automatischer Lauf geplant",
      },
      {
        kind: "trigger",
        label: "Auslöser",
        detail: "admin_background_agent_dispatch_action (source_type=workflow)",
      },
      {
        kind: "task",
        label: "Arbeitseinheit",
        detail: latestTask
          ? `${latestTask.source_type} · ${latestTask.status ?? "—"}`
          : "Noch kein Lauf im 14-Tage-Fenster",
      },
      {
        kind: "artifact",
        label: "Artefakte",
        detail: latestArtifactCount > 0
          ? `${latestArtifactCount} Ergebnis-Artefakt${latestArtifactCount === 1 ? "" : "e"}`
          : "Noch kein Artefakt veröffentlicht",
      },
      {
        kind: "audit",
        label: "Audit",
        detail: "auto_heal_log · background_agent_action_dispatched",
      },
    ];

    return {
      type,
      label: CUSTOMER_LABELS[type],
      description: descriptor.confirmDescription,
      capabilityKey: descriptor.capabilityKey,
      active,
      scheduleCount: sources.length,
      riskLevel,
      lastRunAt,
      lastStatus,
      intentCount24h: intent24h,
      latestArtifactCount,
      latestTask,
      evidenceChain,
      sources,
    };
  });
}

/**
 * Returns whether enable/disable controls should be exposed.
 *
 * P72 invariant: there is NO existing admin RPC/dispatcher that toggles a
 * `cron.job` row. The UI must therefore render the control as disabled with
 * an explanatory reason. Returning `false` here is intentional — it documents
 * the missing capability rather than silently hiding it.
 */
export function canToggleSchedule(): {
  enabled: false;
  reason: string;
} {
  return {
    enabled: false,
    reason:
      "Direkte Cron-Mutation ist nicht erlaubt. Aktivierung/Deaktivierung erfordert einen bestehenden Admin-Dispatcher (noch nicht vorhanden).",
  };
}
