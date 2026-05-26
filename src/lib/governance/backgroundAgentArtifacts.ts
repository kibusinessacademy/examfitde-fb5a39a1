/**
 * P71 — Agent Artifact Premium Layer
 *
 * Pure resolver + normalizer over the P70.1 Unification-Bridge view rows.
 * Maps raw task metadata to product-facing artifact previews (report,
 * checklist, finding, diff_plan, seo_brief, compliance_evidence, quality_plan)
 * and renders an Evidence Chain (source → action → artifact → audit).
 *
 * INVARIANTS (P71):
 *  - NO new tables / NO new queue / NO new runtime / NO new agents.
 *  - NO database mutations from this layer.
 *  - NO direct table reads — Drawer consumes pre-loaded task rows from
 *    existing P70.1 RPCs only.
 *  - Pure & deterministic: same input -> same artifact shape.
 *  - Customer-safe wording (never internal jargon in external labels).
 */
import type { BackgroundTaskLike } from "@/lib/governance/backgroundAgentActions";

export type ArtifactType =
  | "report"
  | "checklist"
  | "finding"
  | "diff_plan"
  | "seo_brief"
  | "compliance_evidence"
  | "quality_plan"
  | "unknown";

export interface ArtifactDescriptor {
  type: ArtifactType;
  label: string;
  /** Customer-safe one-liner. Never internal jargon. */
  description: string;
  /** True if surface is meant for customer/stakeholder review. */
  customerVisible: boolean;
}

export const ARTIFACT_REGISTRY: Record<ArtifactType, ArtifactDescriptor> = {
  report: {
    type: "report",
    label: "Report",
    description: "Strukturierter Bericht mit Kernergebnissen und Empfehlungen.",
    customerVisible: true,
  },
  checklist: {
    type: "checklist",
    label: "Checkliste",
    description: "Abarbeitbare Maßnahmenliste mit Status pro Eintrag.",
    customerVisible: true,
  },
  finding: {
    type: "finding",
    label: "Finding",
    description: "Einzelne identifizierte Beobachtung mit Severity und Hinweis.",
    customerVisible: true,
  },
  diff_plan: {
    type: "diff_plan",
    label: "Diff-Plan",
    description: "Vorgeschlagene Änderungen vor Ausführung — Vorher/Nachher.",
    customerVisible: true,
  },
  seo_brief: {
    type: "seo_brief",
    label: "SEO Brief",
    description: "Content-/Keyword-/Link-Maßnahmen mit Priorisierung.",
    customerVisible: true,
  },
  compliance_evidence: {
    type: "compliance_evidence",
    label: "Compliance Evidence",
    description: "Audit-fester Nachweis für DSGVO/AI-Act/AZAV-relevante Prüfung.",
    customerVisible: true,
  },
  quality_plan: {
    type: "quality_plan",
    label: "Qualitätsplan",
    // Customer-safe synonym for internal curriculum/heal work.
    description: "Plan zur kontinuierlichen Qualitätsoptimierung über Lerninhalte.",
    customerVisible: true,
  },
  unknown: {
    type: "unknown",
    label: "Artefakt",
    description: "Ergebnis ohne erkannte Vorlage.",
    customerVisible: false,
  },
};

// --- Classifier ---

const SEO_BRIEF_RE = /seo|sitemap|cluster|keyword|internal[\s_-]?link|content[\s_-]?brief|persona[\s_-]?landing|cert[\s_-]?pillar|backlink|llm[\s_-]?visibility|gsc|serp/i;
const COMPLIANCE_RE = /compliance|dsgvo|gdpr|ai[\s_-]?act|azav|evidence|audit[\s_-]?export|policy[\s_-]?check|secdef|\brls\b/i;
const DIFF_RE = /\bdiff\b|preview|dry[\s_-]?run|proposed[\s_-]?change|\bpatch\b/i;
const CHECKLIST_RE = /checklist|action[\s_-]?list|todo|maßnahmen|massnahmen|tasks?[\s_-]?list/i;
const FINDING_RE = /finding|\bissue\b|drift|anomaly|alert|violation|\bgap\b/i;
const QUALITY_RE = /quality[\s_-]?plan|repair[\s_-]?plan|heal[\s_-]?plan|integrity|council|curriculum|tutor|minicheck|blueprint|publish[\s_-]?ready/i;

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

export function classifyArtifact(task: BackgroundTaskLike): ArtifactType {
  // Explicit hint in meta wins (forward-compat for future producers).
  const metaHint =
    ((task as unknown as { meta?: Record<string, unknown> | null }).meta?.artifact_type as string | undefined) ?? "";
  const explicit = metaHint.toLowerCase();
  if (explicit && explicit in ARTIFACT_REGISTRY && explicit !== "unknown") {
    return explicit as ArtifactType;
  }

  // No artifact available at all → unknown (Drawer renders empty state).
  if ((task.artifact_count ?? 0) <= 0 && !metaHint) {
    // Still classify based on capability so the empty state can hint at the expected type.
  }

  const hay = probe(task);

  // Strongest specificity first.
  if (COMPLIANCE_RE.test(hay)) return "compliance_evidence";
  if (SEO_BRIEF_RE.test(hay)) return "seo_brief";
  if (QUALITY_RE.test(hay)) return "quality_plan";
  if (CHECKLIST_RE.test(hay)) return "checklist";
  if (DIFF_RE.test(hay)) return "diff_plan";
  if (FINDING_RE.test(hay)) return "finding";
  // Sensible fallback: a generic report when we have any artifact at all.
  return (task.artifact_count ?? 0) > 0 ? "report" : "unknown";
}

export function describeArtifact(type: ArtifactType): ArtifactDescriptor {
  return ARTIFACT_REGISTRY[type];
}

// --- Artifact preview shape (deterministic, pure projection of task) ---

export interface ArtifactSection {
  heading: string;
  /** Human-readable value or a list of bullets. */
  body: string | string[];
}

export interface ArtifactPreview {
  type: ArtifactType;
  descriptor: ArtifactDescriptor;
  title: string;
  summary: string;
  sections: ArtifactSection[];
  /** True if no real artifact payload could be projected — Drawer shows empty state. */
  isEmpty: boolean;
}

const STATUS_RUNNING = new Set(["pending", "queued", "processing", "running"]);

function statusHint(status: string | null | undefined): string {
  const s = (status ?? "").toLowerCase();
  if (STATUS_RUNNING.has(s)) return "Workflow läuft — Ergebnis erscheint nach Abschluss.";
  if (s === "awaiting_approval") return "Wartet auf Approval. Ergebnis ist vorbereitet.";
  if (s === "failed" || s === "rejected") return "Workflow ohne verwertbares Ergebnis abgeschlossen.";
  return "Workflow gestartet — Ergebnis erscheint nach Abschluss.";
}

export function buildArtifactPreview(task: BackgroundTaskLike): ArtifactPreview {
  const type = classifyArtifact(task);
  const descriptor = ARTIFACT_REGISTRY[type];
  const meta = (task as unknown as { meta?: Record<string, unknown> | null }).meta ?? null;

  const baseTitle = task.capability_summary ?? descriptor.label;
  const hasArtifact = (task.artifact_count ?? 0) > 0 || (meta && Object.keys(meta).length > 0);

  if (!hasArtifact) {
    return {
      type,
      descriptor,
      title: baseTitle,
      summary: statusHint(task.status),
      sections: [],
      isEmpty: true,
    };
  }

  const sections: ArtifactSection[] = [];
  if (meta) {
    // Stable, deterministic projection: sort keys alphabetically, redact obvious secrets.
    const SECRET_KEYS = /token|secret|api[_-]?key|password|cookie|bearer/i;
    const keys = Object.keys(meta).sort();
    for (const k of keys) {
      if (SECRET_KEYS.test(k)) {
        sections.push({ heading: k, body: "[redacted]" });
        continue;
      }
      const v = meta[k];
      if (v == null) continue;
      if (Array.isArray(v)) {
        sections.push({
          heading: k,
          body: v.slice(0, 20).map((x) => (typeof x === "string" ? x : JSON.stringify(x))),
        });
      } else if (typeof v === "object") {
        sections.push({ heading: k, body: JSON.stringify(v, null, 2) });
      } else {
        sections.push({ heading: k, body: String(v) });
      }
    }
  }

  return {
    type,
    descriptor,
    title: baseTitle,
    summary: descriptor.description,
    sections,
    isEmpty: sections.length === 0,
  };
}

// --- Evidence Chain: source → action → artifact → audit ---

export type EvidenceStepKind = "source" | "action" | "artifact" | "audit";

export interface EvidenceStep {
  kind: EvidenceStepKind;
  label: string;
  detail: string;
  reference?: string;
}

export function buildEvidenceChain(task: BackgroundTaskLike): EvidenceStep[] {
  const steps: EvidenceStep[] = [];

  // 1. Source (always)
  steps.push({
    kind: "source",
    label: "Quelle",
    detail: task.source_type,
    reference: task.source_id,
  });

  // 2. Action (always — even pending counts as queued action)
  steps.push({
    kind: "action",
    label: "Aktion",
    detail: task.capability_summary ?? "(keine Beschreibung)",
    reference: task.status ?? undefined,
  });

  // 3. Artifact (only if produced)
  const artifactCount = task.artifact_count ?? 0;
  const type = classifyArtifact(task);
  steps.push({
    kind: "artifact",
    label: "Artefakt",
    detail:
      artifactCount > 0
        ? `${ARTIFACT_REGISTRY[type].label} (${artifactCount})`
        : "Noch kein Artefakt — wird nach Abschluss erzeugt.",
    reference: artifactCount > 0 ? String(artifactCount) : undefined,
  });

  // 4. Audit (always — every dispatch lands in auto_heal_log via fn_emit_audit)
  steps.push({
    kind: "audit",
    label: "Audit",
    detail: "auto_heal_log · background_agent_action_dispatched",
    reference: task.source_id,
  });

  return steps;
}

// --- Export helpers (clipboard / markdown / json) ---

export function exportArtifactAsJson(preview: ArtifactPreview, task: BackgroundTaskLike): string {
  return JSON.stringify(
    {
      artifact_type: preview.type,
      title: preview.title,
      summary: preview.summary,
      source_type: task.source_type,
      source_id: task.source_id,
      status: task.status,
      sections: preview.sections,
    },
    null,
    2,
  );
}

export function exportArtifactAsMarkdown(preview: ArtifactPreview, task: BackgroundTaskLike): string {
  const lines: string[] = [];
  lines.push(`# ${preview.title}`);
  lines.push("");
  lines.push(`**Typ:** ${preview.descriptor.label}  `);
  lines.push(`**Quelle:** \`${task.source_type}\` · \`${task.source_id}\`  `);
  lines.push(`**Status:** ${task.status ?? "—"}`);
  lines.push("");
  lines.push(preview.summary);
  lines.push("");
  for (const s of preview.sections) {
    lines.push(`## ${s.heading}`);
    if (Array.isArray(s.body)) {
      for (const b of s.body) lines.push(`- ${b}`);
    } else {
      lines.push(s.body);
    }
    lines.push("");
  }
  return lines.join("\n");
}
