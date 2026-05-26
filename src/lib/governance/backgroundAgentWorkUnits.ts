/**
 * P70.3 — First Visible Background Workflows
 *
 * Pure resolver/normalizer layer on top of the P70.1 Unification-Bridge view.
 * Maps raw (source_type, task_kind, capability_summary, meta) rows from
 * v_background_agent_runtime to product-facing **work units**.
 *
 * NO database mutations. NO new tables. NO new runtime/queue.
 * Source IDs stay fully traceable — work units are a UI grouping only.
 *
 * Three customer/stakeholder-visible outcomes:
 *   1. seo_opportunity      — "SEO Opportunities finden"
 *   2. compliance_drift     — "Compliance Drift prüfen"
 *   3. operational_quality  — "Produktqualität prüfen"   (internal: curriculum/heal/quality)
 *
 * Everything that does not classify cleanly stays "other" and is hidden from
 * the Workflows tab (it remains visible in the raw Tasks tab).
 */
import type { BackgroundTaskLike } from "@/lib/governance/backgroundAgentActions";

export type WorkUnitType =
  | "seo_opportunity"
  | "compliance_drift"
  | "operational_quality"
  | "other";

export interface WorkUnitDescriptor {
  type: WorkUnitType;
  /** Customer-facing outcome label. Never expose internal job names here. */
  outcomeLabel: string;
  /** Short product-facing one-liner. */
  description: string;
  /** Visible to customers/stakeholders or strictly internal? */
  visibility: "customer_visible" | "internal_only_quality";
  /** Customer-safe synonym for internal_only_quality units. */
  externalLabel: string;
}

export const WORK_UNIT_REGISTRY: Record<Exclude<WorkUnitType, "other">, WorkUnitDescriptor> = {
  seo_opportunity: {
    type: "seo_opportunity",
    outcomeLabel: "SEO Opportunities finden",
    description:
      "Findet Content-, Keyword- und Internal-Link-Lücken und erzeugt einen SEO-Brief mit Maßnahmenliste.",
    visibility: "customer_visible",
    externalLabel: "SEO Opportunities finden",
  },
  compliance_drift: {
    type: "compliance_drift",
    outcomeLabel: "Compliance Drift prüfen",
    description:
      "Prüft Provider, Datenflüsse und AI-Act/DSGVO-Drift. Erzeugt Enterprise Evidence Reports.",
    visibility: "customer_visible",
    externalLabel: "Compliance Drift prüfen",
  },
  operational_quality: {
    type: "operational_quality",
    // Internal label — not for customer surfaces.
    outcomeLabel: "Produktqualität prüfen",
    description:
      "Kontinuierliche Qualitätsoptimierung über Inhalte, Blueprints, Tutor, MiniCheck und Pipeline.",
    visibility: "internal_only_quality",
    // What we say to customers/stakeholders if we surface it externally.
    externalLabel: "Kontinuierliche Qualitätsoptimierung",
  },
};

// --- Classifier patterns. Pure, deterministic, no side effects. ---

const SEO_RE =
  /seo|sitemap|cluster|intent[_-]?page|persona[_-]?landing|cert[_-]?pillar|keyword|internal[_-]?link|content[_-]?brief|landing|backlink|llm[_-]?visibility|gsc|serp/i;

const COMPLIANCE_RE =
  /compliance|dsgvo|gdpr|ai[_-]?act|provider[_-]?drift|trust|evidence|audit[_-]?export|policy[_-]?check|security|rls|secdef|consent|dpa|data[_-]?export|retention/i;

const QUALITY_RE =
  /heal|repair|integrity|council|quality|tutor|minicheck|blueprint|curriculum|exam[_-]?pool|pipeline|validate|publish[_-]?ready|orchestr|reconcil|stale|drift[_-]?detect|gap[_-]?sync|bronze|tail/i;

function probe(task: BackgroundTaskLike): string {
  const meta = task as unknown as { meta?: Record<string, unknown> | null };
  const metaText = meta.meta ? JSON.stringify(meta.meta) : "";
  return [
    task.capability_summary ?? "",
    (task as unknown as { task_kind?: string | null }).task_kind ?? "",
    metaText,
  ]
    .join(" ")
    .toLowerCase();
}

export function classifyWorkUnit(task: BackgroundTaskLike): WorkUnitType {
  const haystack = probe(task);

  // heal_permanent_fix_tasks is by definition operational quality follow-up.
  if (task.source_type === "heal_permanent_fix_tasks") return "operational_quality";

  // Order matters: compliance has the strongest specificity; SEO is broad in scope.
  if (COMPLIANCE_RE.test(haystack)) return "compliance_drift";
  if (SEO_RE.test(haystack)) return "seo_opportunity";
  if (QUALITY_RE.test(haystack)) return "operational_quality";

  return "other";
}

export function describeWorkUnit(type: WorkUnitType): WorkUnitDescriptor | null {
  if (type === "other") return null;
  return WORK_UNIT_REGISTRY[type];
}

// --- Aggregation for Workflows tab ---

export interface WorkUnitGroup {
  type: Exclude<WorkUnitType, "other">;
  descriptor: WorkUnitDescriptor;
  total: number;
  pending: number;
  running: number;
  awaitingApproval: number;
  failed: number;
  artifactCount: number;
  highRisk: number;
  /** Sample tasks (preserve full source_type+source_id traceability). */
  sample: BackgroundTaskLike[];
}

const VISIBLE_ORDER: Array<Exclude<WorkUnitType, "other">> = [
  "seo_opportunity",
  "compliance_drift",
  "operational_quality",
];

export function groupTasksByWorkUnit(
  tasks: BackgroundTaskLike[],
  sampleSize = 8,
): WorkUnitGroup[] {
  const buckets = new Map<Exclude<WorkUnitType, "other">, WorkUnitGroup>();

  for (const t of tasks) {
    const type = classifyWorkUnit(t);
    if (type === "other") continue;
    let g = buckets.get(type);
    if (!g) {
      g = {
        type,
        descriptor: WORK_UNIT_REGISTRY[type],
        total: 0,
        pending: 0,
        running: 0,
        awaitingApproval: 0,
        failed: 0,
        artifactCount: 0,
        highRisk: 0,
        sample: [],
      };
      buckets.set(type, g);
    }
    g.total += 1;
    const status = (t.status ?? "").toLowerCase();
    if (status === "pending") g.pending += 1;
    else if (status === "running") g.running += 1;
    else if (status === "failed" || status === "rejected") g.failed += 1;
    if ((t.approval_state ?? "").toLowerCase() === "pending") g.awaitingApproval += 1;
    if ((t.risk_level ?? "").toLowerCase() === "high") g.highRisk += 1;
    g.artifactCount += t.artifact_count ?? 0;
    if (g.sample.length < sampleSize) g.sample.push(t);
  }

  return VISIBLE_ORDER.filter((k) => buckets.has(k)).map((k) => buckets.get(k)!);
}
