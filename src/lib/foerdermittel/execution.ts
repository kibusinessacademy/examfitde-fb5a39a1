// FördermittelOS Cut 3 — Execution OS
// Pure, deterministic, client-safe. No AI, no network.
// Application Readiness, Missing Documents, Checklist, Timeline, Risks, Next Best Actions.
import type { CompanyProfile, Program, ProgramRequirement } from "./types";
import { classifyFreshness, classifyChangeRisk } from "./freshness";

// ---------- Types ----------

export type DocStatus = "present" | "missing" | "optional" | "critical" | "unclear";

export interface DocumentCheckItem {
  key: string;
  label: string;
  status: DocStatus;
  /** true = blocks application without this document */
  critical: boolean;
  /** explanation shown in UI */
  note?: string;
}

export type TimelinePhase =
  | "pruefung"
  | "unterlagen"
  | "projektbeschreibung"
  | "kostenplan"
  | "antrag"
  | "rueckfragen"
  | "bewilligung"
  | "nachweise";

export interface TimelineStep {
  key: TimelinePhase;
  label: string;
  description: string;
  estimateWeeks: number;
  bridgeOS?: BridgeOS;
}

export type BridgeOS =
  | "FristenOS"
  | "VertragscheckerOS"
  | "AngebotsvergleichOS"
  | "ComplianceOS"
  | "WissensOS";

export interface BridgeEvent {
  os: BridgeOS;
  intent: string;
  payload: Record<string, unknown>;
}

export type RiskSeverity = "low" | "medium" | "high";

export interface ApplicationRisk {
  key: string;
  label: string;
  severity: RiskSeverity;
  hint: string;
}

export type ActionPriority = "now" | "soon" | "later";

export interface NextBestAction {
  key: string;
  label: string;
  priority: ActionPriority;
  reason: string;
  bridge?: BridgeEvent;
}

export interface ApplicationReadiness {
  /** 0..100 */
  score: number;
  /** human-readable verdict */
  verdict: "ready" | "almost" | "gaps" | "blocked";
  /** breakdown 0..100 */
  breakdown: {
    documents: number;
    requirements: number;
    timing: number;
    sourceFreshness: number;
  };
  missingCriticalDocs: number;
  missingOptionalDocs: number;
  unmetHardRequirements: number;
}

// ---------- Document Check ----------

/** Map registry document strings to a structured check, using user-provided present[] keys. */
export function buildDocumentChecklist(
  program: Program,
  presentKeys: ReadonlySet<string> = new Set(),
): DocumentCheckItem[] {
  return program.documentsNeeded.map((label) => {
    const key = toDocKey(label);
    const critical = isCriticalDoc(label);
    const present = presentKeys.has(key);
    return {
      key,
      label,
      status: present ? "present" : critical ? "critical" : "missing",
      critical,
      note: present
        ? undefined
        : critical
          ? "Pflichtdokument — Antrag wird ohne dieses Dokument abgelehnt."
          : "Empfohlenes Dokument — beschleunigt Bewilligung.",
    };
  });
}

export function classifyMissingDocuments(
  program: Program,
  presentKeys: ReadonlySet<string> = new Set(),
): {
  missingCritical: DocumentCheckItem[];
  missingOptional: DocumentCheckItem[];
  present: DocumentCheckItem[];
} {
  const checklist = buildDocumentChecklist(program, presentKeys);
  return {
    missingCritical: checklist.filter((d) => d.status === "critical"),
    missingOptional: checklist.filter((d) => d.status === "missing"),
    present: checklist.filter((d) => d.status === "present"),
  };
}

const CRITICAL_HINTS = [
  "kmu-erklärung",
  "kmu-erklarung",
  "antrag",
  "beratungsvertrag",
  "digitalisierungsplan",
  "projektbeschreibung",
  "kostenplan",
  "finanzierungsplan",
  "businessplan",
  "konzept",
];

function isCriticalDoc(label: string): boolean {
  const norm = label.toLowerCase();
  return CRITICAL_HINTS.some((h) => norm.includes(h));
}

export function toDocKey(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ---------- Application Checklist (requirements + docs combined) ----------

export interface ChecklistItem {
  key: string;
  label: string;
  group: "requirement" | "document";
  critical: boolean;
  satisfied: boolean;
}

export function buildApplicationChecklist(
  program: Program,
  presentDocKeys: ReadonlySet<string> = new Set(),
  metRequirementKeys: ReadonlySet<string> = new Set(),
): ChecklistItem[] {
  const reqs: ChecklistItem[] = program.requirements.map((r: ProgramRequirement) => ({
    key: `req-${r.key}`,
    label: r.label,
    group: "requirement",
    critical: r.hard,
    satisfied: metRequirementKeys.has(r.key),
  }));
  const docs: ChecklistItem[] = buildDocumentChecklist(program, presentDocKeys).map((d) => ({
    key: `doc-${d.key}`,
    label: d.label,
    group: "document",
    critical: d.critical,
    satisfied: d.status === "present",
  }));
  return [...reqs, ...docs];
}

// ---------- Risks ----------

export function rankApplicationRisks(
  program: Program,
  profile?: CompanyProfile,
  presentDocKeys: ReadonlySet<string> = new Set(),
  metRequirementKeys: ReadonlySet<string> = new Set(),
  now: Date = new Date(),
): ApplicationRisk[] {
  const risks: ApplicationRisk[] = [];

  const hardUnmet = program.requirements.filter(
    (r) => r.hard && !metRequirementKeys.has(r.key),
  );
  if (hardUnmet.length > 0) {
    risks.push({
      key: "hard-requirements",
      label: `${hardUnmet.length} harte Voraussetzung(en) unbestätigt`,
      severity: "high",
      hint: "Ohne Bestätigung dieser Punkte ist kein Antrag möglich.",
    });
  }

  const missingCritical = program.documentsNeeded.filter(
    (d) => isCriticalDoc(d) && !presentDocKeys.has(toDocKey(d)),
  );
  if (missingCritical.length > 0) {
    risks.push({
      key: "critical-documents",
      label: `${missingCritical.length} Pflichtdokument(e) fehlen`,
      severity: "high",
      hint: "Diese Dokumente müssen vor Antragstellung bereitliegen.",
    });
  }

  if (program.deadline) {
    const days = Math.round((new Date(program.deadline).getTime() - now.getTime()) / 86_400_000);
    if (days >= 0 && days <= 14) {
      risks.push({
        key: "deadline-imminent",
        label: `Frist in ${days} Tagen`,
        severity: "high",
        hint: "Sofort priorisieren — Antrag in dieser Woche einreichen.",
      });
    } else if (days >= 0 && days <= 60) {
      risks.push({
        key: "deadline-soon",
        label: `Frist in ${days} Tagen`,
        severity: "medium",
        hint: "Vorbereitung dieser Woche starten.",
      });
    }
  }

  if ((program.budgetTensionPct ?? 0) >= 85) {
    risks.push({
      key: "budget-tension",
      label: `Fördertopf zu ${program.budgetTensionPct}% ausgeschöpft`,
      severity: "medium",
      hint: "Schnell einreichen — Mittel könnten bald enden.",
    });
  }

  if (program.status === "paused") {
    risks.push({
      key: "status-paused",
      label: "Programm aktuell pausiert",
      severity: "medium",
      hint: "Wiederauflage abwarten oder Alternative wählen.",
    });
  }

  const fresh = classifyFreshness(program, now);
  if (fresh === "stale" || fresh === "unknown") {
    risks.push({
      key: "source-freshness",
      label: "Quellen-Verifikation überfällig",
      severity: fresh === "stale" ? "medium" : "low",
      hint: "Konditionen vor Antrag auf der offiziellen Quelle gegenprüfen.",
    });
  }

  const changeRisk = classifyChangeRisk(program, now);
  if (changeRisk === "high") {
    risks.push({
      key: "change-risk",
      label: "Hohes Änderungsrisiko",
      severity: "medium",
      hint: "Programm wird oft angepasst — Status kurzfristig prüfen.",
    });
  }

  if (profile && !program.eligibleCompanySizes.includes(profile.size)) {
    risks.push({
      key: "size-mismatch",
      label: `Unternehmensgröße "${profile.size}" außerhalb des Sets`,
      severity: "high",
      hint: "Programm wird höchstwahrscheinlich nicht bewilligt.",
    });
  }

  return risks.sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity));
}

function severityWeight(s: RiskSeverity): number {
  return s === "high" ? 3 : s === "medium" ? 2 : 1;
}

// ---------- Readiness ----------

export function computeApplicationReadiness(
  program: Program,
  profile?: CompanyProfile,
  presentDocKeys: ReadonlySet<string> = new Set(),
  metRequirementKeys: ReadonlySet<string> = new Set(),
  now: Date = new Date(),
): ApplicationReadiness {
  const docs = classifyMissingDocuments(program, presentDocKeys);
  const totalDocs = program.documentsNeeded.length || 1;
  const docsScore = Math.round((docs.present.length / totalDocs) * 100);

  const totalReq = program.requirements.length || 1;
  const metReq = program.requirements.filter((r) => metRequirementKeys.has(r.key)).length;
  const reqScore = Math.round((metReq / totalReq) * 100);

  let timingScore = 100;
  if (program.deadline) {
    const days = Math.round((new Date(program.deadline).getTime() - now.getTime()) / 86_400_000);
    if (days < 0) timingScore = 0;
    else if (days <= 7) timingScore = 30;
    else if (days <= 30) timingScore = 60;
    else if (days <= 90) timingScore = 85;
  }
  if (program.status === "paused") timingScore = Math.min(timingScore, 40);
  if (program.status === "depleted") timingScore = Math.min(timingScore, 15);
  if (program.status === "expired") timingScore = 0;

  const fresh = classifyFreshness(program, now);
  const freshScore = fresh === "fresh" ? 100 : fresh === "watch" ? 80 : fresh === "stale" ? 55 : 65;

  // Weighted aggregate
  const score = Math.round(docsScore * 0.35 + reqScore * 0.35 + timingScore * 0.2 + freshScore * 0.1);

  const verdict: ApplicationReadiness["verdict"] =
    score >= 85 ? "ready" : score >= 65 ? "almost" : score >= 40 ? "gaps" : "blocked";

  return {
    score: Math.max(0, Math.min(100, score)),
    verdict,
    breakdown: {
      documents: docsScore,
      requirements: reqScore,
      timing: timingScore,
      sourceFreshness: freshScore,
    },
    missingCriticalDocs: docs.missingCritical.length,
    missingOptionalDocs: docs.missingOptional.length,
    unmetHardRequirements: program.requirements.filter(
      (r) => r.hard && !metRequirementKeys.has(r.key),
    ).length,
  };
}

// ---------- Timeline ----------

export function buildApplicationTimeline(program: Program): TimelineStep[] {
  const dw = program.decisionWeeks ?? 8;
  return [
    {
      key: "pruefung",
      label: "Prüfung & Eignung",
      description: "Förderfähigkeit prüfen, Voraussetzungen abgleichen, KMU-Status klären.",
      estimateWeeks: 1,
      bridgeOS: "ComplianceOS",
    },
    {
      key: "unterlagen",
      label: "Unterlagen sammeln",
      description: "KMU-Erklärung, Nachweise, Vorlagen und Konzepte zusammenstellen.",
      estimateWeeks: 1,
      bridgeOS: "WissensOS",
    },
    {
      key: "projektbeschreibung",
      label: "Projektbeschreibung erstellen",
      description: "Ziele, Maßnahmen, Wirkung und Indikatoren beschreiben.",
      estimateWeeks: 1,
    },
    {
      key: "kostenplan",
      label: "Kostenplan & Angebote",
      description: "Förderfähige Kosten kalkulieren, Vergleichsangebote einholen.",
      estimateWeeks: 1,
      bridgeOS: "AngebotsvergleichOS",
    },
    {
      key: "antrag",
      label: "Antrag einreichen",
      description: `Antrag stellen — Frist${program.deadline ? `: ${new Date(program.deadline).toLocaleDateString("de-DE")}` : " offen"}.`,
      estimateWeeks: 1,
      bridgeOS: "FristenOS",
    },
    {
      key: "rueckfragen",
      label: "Rückfragen beantworten",
      description: "Nachforderungen der Förderstelle prüfen und fristgerecht beantworten.",
      estimateWeeks: Math.max(1, Math.round(dw / 3)),
    },
    {
      key: "bewilligung",
      label: "Bewilligung prüfen",
      description: "Förderbescheid sichten, Auflagen und Verträge prüfen.",
      estimateWeeks: Math.max(1, Math.round(dw / 2)),
      bridgeOS: "VertragscheckerOS",
    },
    {
      key: "nachweise",
      label: "Nachweise einreichen",
      description: "Verwendungsnachweis und Belege fristgerecht einreichen.",
      estimateWeeks: 2,
    },
  ];
}

// ---------- Next Best Actions ----------

export function buildNextBestActions(
  program: Program,
  readiness: ApplicationReadiness,
  presentDocKeys: ReadonlySet<string> = new Set(),
): NextBestAction[] {
  const out: NextBestAction[] = [];
  const docs = classifyMissingDocuments(program, presentDocKeys);

  if (readiness.unmetHardRequirements > 0) {
    out.push({
      key: "confirm-hard-requirements",
      label: "Harte Voraussetzungen bestätigen",
      priority: "now",
      reason: `${readiness.unmetHardRequirements} Voraussetzung(en) noch unbestätigt.`,
      bridge: { os: "ComplianceOS", intent: "verify_eligibility", payload: { programSlug: program.slug } },
    });
  }

  for (const d of docs.missingCritical.slice(0, 2)) {
    out.push({
      key: `doc-${d.key}`,
      label: `Pflichtdokument vorbereiten: ${d.label}`,
      priority: "now",
      reason: "Ohne dieses Dokument keine Antragsannahme.",
      bridge: { os: "WissensOS", intent: "fetch_template", payload: { document: d.label } },
    });
  }

  if (program.deadline) {
    const days = Math.round((new Date(program.deadline).getTime() - Date.now()) / 86_400_000);
    if (days >= 0 && days <= 30) {
      out.push({
        key: "track-deadline",
        label: `Frist ${days} Tage — in FristenOS sichern`,
        priority: "now",
        reason: "Frist kritisch, automatische Erinnerung anlegen.",
        bridge: {
          os: "FristenOS",
          intent: "create_deadline",
          payload: { programSlug: program.slug, due: program.deadline, label: program.name },
        },
      });
    }
  }

  if (docs.missingOptional.length > 0 && readiness.score < 85) {
    out.push({
      key: "improve-optional",
      label: `Empfohlene Unterlagen ergänzen (${docs.missingOptional.length})`,
      priority: "soon",
      reason: "Erhöht Bewilligungs­wahrscheinlichkeit messbar.",
    });
  }

  if (readiness.breakdown.sourceFreshness < 80) {
    out.push({
      key: "verify-source",
      label: "Konditionen auf offizieller Quelle prüfen",
      priority: "soon",
      reason: "Aktualität der hinterlegten Daten überfällig.",
    });
  }

  if (program.combinableWith && program.combinableWith.length > 0) {
    out.push({
      key: "check-combinability",
      label: `Kombinationen prüfen (${program.combinableWith.length})`,
      priority: "later",
      reason: "Mehrere Programme können gleichzeitig genutzt werden.",
    });
  }

  return out;
}

// ---------- Bridge Events (cross-OS contract) ----------

export function buildBridgeEvents(program: Program, readiness: ApplicationReadiness): BridgeEvent[] {
  const events: BridgeEvent[] = [];
  if (program.deadline) {
    events.push({
      os: "FristenOS",
      intent: "create_deadline",
      payload: { programSlug: program.slug, due: program.deadline, label: program.name },
    });
  }
  events.push({
    os: "WissensOS",
    intent: "open_program_kit",
    payload: { programSlug: program.slug, documents: program.documentsNeeded },
  });
  if (readiness.verdict !== "ready") {
    events.push({
      os: "ComplianceOS",
      intent: "verify_eligibility",
      payload: { programSlug: program.slug, requirements: program.requirements.map((r) => r.key) },
    });
  }
  return events;
}

// ---------- Labels ----------

export const VERDICT_LABEL: Record<ApplicationReadiness["verdict"], string> = {
  ready: "Antragsreif",
  almost: "Fast bereit",
  gaps: "Lücken schließen",
  blocked: "Blockiert",
};

export const VERDICT_TONE: Record<ApplicationReadiness["verdict"], string> = {
  ready: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  almost: "bg-primary/15 text-primary border-primary/30",
  gaps: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  blocked: "bg-destructive/15 text-destructive border-destructive/30",
};

export const PRIORITY_LABEL: Record<ActionPriority, string> = {
  now: "Sofort",
  soon: "Diese Woche",
  later: "Später",
};
