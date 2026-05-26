/**
 * P73 — Background Agent Business Value Layer
 *
 * Pure resolver that turns P70.1 task rows + P71 artifact classification into
 * customer-facing **value cards** (Opportunities, Risiken, Reports, geschätzte
 * Zeitersparnis), a latest-outcome summary, and a Workflow-Health verdict.
 *
 * INVARIANTS:
 *  - NO database access, NO RPC, NO fetch, NO Date.now / Math.random.
 *  - Pure & deterministic: same input → same output.
 *  - Customer-safe copy only: never "Curriculum Repair", "Council", "Drift-Heal".
 *  - Reuses P70.3 WorkUnit classifier and P71 ArtifactType classifier.
 *  - No new tables / queues / runtime / agents.
 */
import type { BackgroundTaskLike } from "@/lib/governance/backgroundAgentActions";
import { classifyWorkUnit, type WorkUnitType } from "@/lib/governance/backgroundAgentWorkUnits";
import { classifyArtifact, type ArtifactType } from "@/lib/governance/backgroundAgentArtifacts";

export type WorkflowHealth = "running" | "stale" | "failed" | "no_artifacts_yet" | "healthy";

export type CustomerWorkflowType = Exclude<WorkUnitType, "other">;

export interface WorkflowValueCard {
  type: CustomerWorkflowType;
  /** Customer-safe headline. Never internal jargon. */
  headline: string;
  /** Customer-safe one-line outcome promise. */
  promise: string;
  /** Aggregated value metrics. */
  metrics: {
    opportunitiesFound: number;
    risksAvoided: number;
    reportsGenerated: number;
    checksCompleted: number;
    estimatedMinutesSaved: number;
  };
  health: WorkflowHealth;
  /** Customer-safe health line. */
  healthLabel: string;
  /** Most recent finished task (deterministic by last_event_at desc, source_id tiebreak). */
  latestOutcome: LatestOutcome | null;
  /** Snapshot inputs for traceability — never invented. */
  totals: {
    completed: number;
    running: number;
    failed: number;
    artifactCount: number;
  };
}

export interface LatestOutcome {
  source_type: string;
  source_id: string;
  artifactType: ArtifactType;
  /** Customer-safe outcome line. */
  summary: string;
  lastEventAt: string | null;
}

/**
 * Deterministic minutes-per-artifact estimate. Conservative anchors that we
 * stand behind in customer conversations. Unknown artifacts contribute 0.
 */
export const MINUTES_PER_ARTIFACT: Record<ArtifactType, number> = {
  seo_brief: 90,
  compliance_evidence: 120,
  quality_plan: 45,
  diff_plan: 30,
  report: 30,
  checklist: 15,
  finding: 10,
  unknown: 0,
};

const CUSTOMER_COPY: Record<CustomerWorkflowType, { headline: string; promise: string }> = {
  seo_opportunity: {
    headline: "SEO-Chancen automatisch gesammelt",
    promise: "Die KI findet Content- und Keyword-Lücken und liefert fertige SEO-Briefs.",
  },
  compliance_drift: {
    headline: "Compliance-Risiken frühzeitig erkannt",
    promise: "Laufende Prüfungen auf Provider-, DSGVO- und AI-Act-Drift mit Evidence-Report.",
  },
  operational_quality: {
    // Customer-safe label, never "Curriculum Repair" / "Council".
    headline: "KI erledigt wiederkehrende Prüfungen",
    promise: "Kontinuierliche Qualitäts- und Konsistenzprüfungen laufen automatisch im Hintergrund.",
  },
};

const VISIBLE_ORDER: CustomerWorkflowType[] = [
  "seo_opportunity",
  "compliance_drift",
  "operational_quality",
];

/** Pure stale check: caller provides nowIso so the function stays deterministic. */
export function isStale(lastEventAt: string | null, nowIso: string, hours = 24): boolean {
  if (!lastEventAt) return false;
  const last = Date.parse(lastEventAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(last) || !Number.isFinite(now)) return false;
  return now - last > hours * 3_600_000;
}

function statusOf(t: BackgroundTaskLike): string {
  return (t.status ?? "").toLowerCase();
}

function metricsForArtifact(type: ArtifactType): {
  opp: number; risk: number; report: number; check: number;
} {
  switch (type) {
    case "seo_brief":
      return { opp: 1, risk: 0, report: 1, check: 0 };
    case "compliance_evidence":
      return { opp: 0, risk: 1, report: 1, check: 1 };
    case "quality_plan":
      return { opp: 0, risk: 0, report: 1, check: 1 };
    case "diff_plan":
      return { opp: 0, risk: 0, report: 1, check: 0 };
    case "report":
      return { opp: 0, risk: 0, report: 1, check: 0 };
    case "checklist":
      return { opp: 0, risk: 0, report: 0, check: 1 };
    case "finding":
      return { opp: 0, risk: 1, report: 0, check: 0 };
    default:
      return { opp: 0, risk: 0, report: 0, check: 0 };
  }
}

function latestSummaryLine(type: CustomerWorkflowType, artifactType: ArtifactType): string {
  if (type === "seo_opportunity") return "Neue SEO-Chance identifiziert.";
  if (type === "compliance_drift") {
    return artifactType === "finding"
      ? "Compliance-Beobachtung mit Hinweis dokumentiert."
      : "Compliance-Prüfung abgeschlossen.";
  }
  return "Qualitätsprüfung abgeschlossen.";
}

function pickLatest<T extends BackgroundTaskLike>(tasks: T[]): T | null {
  let best: T | null = null;
  for (const t of tasks) {
    if (statusOf(t) !== "completed") continue;
    if (!best) { best = t; continue; }
    const a = t.last_event_at ?? "";
    const b = best.last_event_at ?? "";
    if (a > b) best = t;
    else if (a === b && t.source_id > best.source_id) best = t;
  }
  return best;
}

export interface BuildValueCardsOptions {
  /** Caller-supplied "now" so the resolver stays pure. */
  nowIso: string;
  staleAfterHours?: number;
}

export function buildWorkflowValueCards<T extends BackgroundTaskLike>(
  tasks: T[],
  opts: BuildValueCardsOptions,
): WorkflowValueCard[] {
  const staleHours = opts.staleAfterHours ?? 24;

  // Bucket tasks per visible workflow type only.
  const buckets = new Map<CustomerWorkflowType, T[]>();
  for (const w of VISIBLE_ORDER) buckets.set(w, []);
  for (const t of tasks) {
    const w = classifyWorkUnit(t);
    if (w === "other") continue;
    buckets.get(w)!.push(t);
  }

  return VISIBLE_ORDER.map((type) => {
    const items = buckets.get(type) ?? [];
    let opportunitiesFound = 0;
    let risksAvoided = 0;
    let reportsGenerated = 0;
    let checksCompleted = 0;
    let estimatedMinutesSaved = 0;
    let completed = 0;
    let running = 0;
    let failed = 0;
    let artifactCount = 0;

    for (const t of items) {
      const s = statusOf(t);
      if (s === "completed") completed += 1;
      if (s === "running") running += 1;
      if (s === "failed" || s === "rejected") failed += 1;
      const arts = t.artifact_count ?? 0;
      artifactCount += arts;
      if (s !== "completed" || arts <= 0) continue;
      const at = classifyArtifact(t);
      const m = metricsForArtifact(at);
      opportunitiesFound += m.opp * arts;
      risksAvoided += m.risk * arts;
      reportsGenerated += m.report * arts;
      checksCompleted += m.check * arts;
      estimatedMinutesSaved += MINUTES_PER_ARTIFACT[at] * arts;
    }

    const latestTask = pickLatest(items);
    const latestOutcome: LatestOutcome | null = latestTask
      ? {
          source_type: latestTask.source_type,
          source_id: latestTask.source_id,
          artifactType: classifyArtifact(latestTask),
          summary: latestSummaryLine(type, classifyArtifact(latestTask)),
          lastEventAt: latestTask.last_event_at ?? null,
        }
      : null;

    const lastSeen = latestTask?.last_event_at ?? null;
    let health: WorkflowHealth = "healthy";
    let healthLabel = "Läuft planmäßig.";
    if (failed > 0 && completed === 0) {
      health = "failed";
      healthLabel = "Aktuell keine erfolgreichen Läufe — Team prüft die Ursache.";
    } else if (running > 0) {
      health = "running";
      healthLabel = "Workflow läuft gerade — neue Ergebnisse folgen.";
    } else if (artifactCount === 0 && items.length > 0) {
      health = "no_artifacts_yet";
      healthLabel = "Workflow gestartet — Ergebnis erscheint nach Abschluss.";
    } else if (items.length === 0) {
      health = "no_artifacts_yet";
      healthLabel = "Noch keine Ergebnisse im Beobachtungszeitraum.";
    } else if (isStale(lastSeen, opts.nowIso, staleHours)) {
      health = "stale";
      healthLabel = "Längere Pause — nächster geplanter Lauf folgt automatisch.";
    }

    const copy = CUSTOMER_COPY[type];
    return {
      type,
      headline: copy.headline,
      promise: copy.promise,
      metrics: {
        opportunitiesFound,
        risksAvoided,
        reportsGenerated,
        checksCompleted,
        estimatedMinutesSaved,
      },
      health,
      healthLabel,
      latestOutcome,
      totals: { completed, running, failed, artifactCount },
    };
  });
}

/** Human-readable minute → "X Std Y Min" / "Y Min". Pure projection. */
export function formatMinutesSaved(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} Min`;
  if (m === 0) return `${h} Std`;
  return `${h} Std ${m} Min`;
}
