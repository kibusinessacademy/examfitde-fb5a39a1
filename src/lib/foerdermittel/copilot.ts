// FördermittelOS Cut 4 — CoPilot SSOT (pure, deterministic, client-safe)
// Grounded on Registry + Matching + Freshness + Execution. No AI here, only
// context/intent/payload/refusal logic. Gateway lives in the edge function.
import type {
  CompanyProfile,
  Program,
  ProgramMatch,
} from "./types";
import {
  classifyFreshness,
  classifyChangeRisk,
  effectiveFreshness,
  FRESHNESS_LABEL,
  CHANGE_RISK_LABEL,
} from "./freshness";
import {
  buildDocumentChecklist,
  computeApplicationReadiness,
  rankApplicationRisks,
  buildNextBestActions,
  buildApplicationTimeline,
  VERDICT_LABEL,
  type ApplicationReadiness,
  type BridgeEvent,
} from "./execution";
import { getProgramBySlug, PROGRAMS } from "./registry";

// ---------- Intents ----------
export type CopilotIntent =
  | "explain_program_fit"
  | "explain_freshness_risk"
  | "explain_application_readiness"
  | "explain_missing_documents"
  | "compare_programs"
  | "suggest_next_step"
  | "prepare_application_outline"
  | "ask_clarifying_question"
  | "unknown";

export interface CopilotAction {
  intent: CopilotIntent;
  label: string;
  description: string;
  requiresProfile?: boolean;
}

// ---------- Context ----------
export interface CopilotContext {
  program: {
    slug: string;
    name: string;
    authority: string;
    region: string;
    status: Program["status"];
    topics: Program["topics"];
    kind: Program["kind"];
    shortDescription: string;
    decisionWeeks?: number;
    deadline?: string | null;
    funding: Program["funding"];
    requirements: Program["requirements"];
    documentsNeeded: string[];
    sources: { url: string; label: string; lastVerifiedAt?: string; official?: boolean }[];
  };
  freshness: {
    status: ReturnType<typeof classifyFreshness>;
    statusLabel: string;
    changeRisk: ReturnType<typeof classifyChangeRisk>;
    changeRiskLabel: string;
    lastVerifiedAt?: string;
    nextReviewAt?: string;
    sourceUrl?: string;
  };
  match?: {
    fit: number;
    probability: number;
    reasons: string[];
    warnings: string[];
    disqualifiers: string[];
  };
  readiness?: {
    score: number;
    verdict: ApplicationReadiness["verdict"];
    verdictLabel: string;
    missingCriticalDocs: number;
    unmetHardRequirements: number;
  };
  risks: { key: string; label: string; severity: string; hint: string }[];
  nextActions: { key: string; label: string; priority: string; reason: string }[];
  bridgeEvents: BridgeEvent[];
  /** Sanitised company profile — NEVER names, NEVER emails, NEVER free text */
  profile?: {
    region: string;
    size: CompanyProfile["size"];
    topics: CompanyProfile["topics"];
  };
}

const PROGRAM_SLUGS = new Set(PROGRAMS.map((p) => p.slug));

/** Build a grounded CoPilot context from existing SSOTs. Pure function. */
export function buildCopilotContext(
  program: Program,
  match?: ProgramMatch,
  profile?: CompanyProfile,
  presentDocKeys: ReadonlySet<string> = new Set(),
  metRequirementKeys: ReadonlySet<string> = new Set(),
  now: Date = new Date(),
): CopilotContext {
  const fresh = classifyFreshness(program, now);
  const risk = classifyChangeRisk(program, now);
  const eff = effectiveFreshness(program);

  const readiness = profile
    ? computeApplicationReadiness(program, profile, presentDocKeys, metRequirementKeys, now)
    : undefined;
  const risks = rankApplicationRisks(program, profile, presentDocKeys, metRequirementKeys, now);
  const next = profile && readiness
    ? buildNextBestActions(program, profile, readiness, presentDocKeys, metRequirementKeys, now)
    : [];

  // Bridge events lazy-load to avoid circular if not ready
  const bridgeEvents: BridgeEvent[] = readiness
    ? // eslint-disable-next-line @typescript-eslint/no-var-requires
      (require("./execution") as typeof import("./execution")).buildBridgeEvents(program, readiness)
    : [];

  return {
    program: {
      slug: program.slug,
      name: program.name,
      authority: program.authority,
      region: program.region,
      status: program.status,
      topics: program.topics,
      kind: program.kind,
      shortDescription: program.shortDescription,
      decisionWeeks: program.decisionWeeks,
      deadline: program.deadline ?? null,
      funding: program.funding,
      requirements: program.requirements,
      documentsNeeded: program.documentsNeeded,
      sources: program.sources.map((s) => ({
        url: s.url,
        label: s.label,
        lastVerifiedAt: s.lastVerifiedAt,
        official: s.official,
      })),
    },
    freshness: {
      status: fresh,
      statusLabel: FRESHNESS_LABEL[fresh],
      changeRisk: risk,
      changeRiskLabel: CHANGE_RISK_LABEL[risk],
      lastVerifiedAt: eff.lastVerifiedAt,
      nextReviewAt: eff.nextReviewAt,
      sourceUrl: eff.sourceUrl,
    },
    match: match
      ? {
          fit: match.fit,
          probability: match.probability,
          reasons: match.reasons,
          warnings: match.warnings,
          disqualifiers: match.disqualifiers,
        }
      : undefined,
    readiness: readiness
      ? {
          score: readiness.score,
          verdict: readiness.verdict,
          verdictLabel: VERDICT_LABEL[readiness.verdict],
          missingCriticalDocs: readiness.missingCriticalDocs,
          unmetHardRequirements: readiness.unmetHardRequirements,
        }
      : undefined,
    risks: risks.map((r) => ({
      key: r.key,
      label: r.label,
      severity: r.severity,
      hint: r.hint,
    })),
    nextActions: next.map((n) => ({
      key: n.key,
      label: n.label,
      priority: n.priority,
      reason: n.reason,
    })),
    bridgeEvents,
    profile: profile
      ? { region: profile.region, size: profile.size, topics: profile.topics }
      : undefined,
  };
}

// ---------- Allowed Actions ----------
const ALL_ACTIONS: CopilotAction[] = [
  {
    intent: "explain_program_fit",
    label: "Warum passt diese Förderung?",
    description: "Erläutert Fit-Score, Wahrscheinlichkeit und Voraussetzungen aus deinem Profil.",
    requiresProfile: true,
  },
  {
    intent: "explain_missing_documents",
    label: "Welche Unterlagen fehlen?",
    description: "Listet fehlende Pflicht- und Bonus-Dokumente aus dem Antragscheck.",
  },
  {
    intent: "suggest_next_step",
    label: "Was ist der nächste Schritt?",
    description: "Priorisiert die nächsten Antragsschritte auf Basis der Readiness-Analyse.",
  },
  {
    intent: "explain_freshness_risk",
    label: "Welche Risiken gibt es?",
    description: "Erklärt Änderungsrisiken, Topf-Auslastung, Fristen und Aktualität der Quellen.",
  },
  {
    intent: "prepare_application_outline",
    label: "Antragsgliederung vorbereiten",
    description: "Strukturierter Entwurf für Projektbeschreibung, Kostenplan, Zielsetzung.",
  },
  {
    intent: "compare_programs",
    label: "Mit ähnlichen Programmen vergleichen",
    description: "Stellt das Programm in den Kontext kombinierbarer Alternativen.",
  },
];

export function buildAllowedCopilotActions(ctx: CopilotContext): CopilotAction[] {
  return ALL_ACTIONS.filter((a) => {
    if (a.requiresProfile && !ctx.profile) return false;
    if (a.intent === "explain_application_readiness" && !ctx.readiness) return false;
    return true;
  });
}

// ---------- Intent Classification (deterministic, keyword-based) ----------
const INTENT_KEYWORDS: Array<[CopilotIntent, RegExp]> = [
  ["explain_program_fit", /\b(passt|fit|warum.*förder|eignet|geeignet|qualif)/i],
  ["explain_missing_documents", /\b(unterlagen|dokument|nachweis|checkliste|papiere)\b/i],
  ["explain_freshness_risk", /\b(risik|aktuell|frist|stale|veraltet|änder|topf|budget)/i],
  ["explain_application_readiness", /\b(bereit|readiness|score|wie weit|status)/i],
  ["prepare_application_outline", /\b(antrag.*(schreiben|entwurf|gliederung|outline|vorberei))|projektbeschreibung|kostenplan/i],
  ["compare_programs", /\b(vergleich|alternative|kombinier|statt|ähnlich)/i],
  ["suggest_next_step", /\b(nächst|next step|weiter|was.*tun|als erstes)/i],
];

export function classifyCopilotIntent(message: string): CopilotIntent {
  if (!message || message.trim().length < 3) return "ask_clarifying_question";
  for (const [intent, rx] of INTENT_KEYWORDS) {
    if (rx.test(message)) return intent;
  }
  return "unknown";
}

// ---------- Grounding Instructions for the model ----------
export function buildGroundingInstructions(ctx: CopilotContext): string {
  const lines: string[] = [
    "Du bist der FördermittelOS CoPilot. Du beantwortest Fragen ausschließlich auf Basis des unten gelieferten JSON-Kontexts.",
    "STRIKTE REGELN:",
    "1. Erfinde keine Programme, Konditionen, Fristen oder Voraussetzungen.",
    "2. Verweise immer auf die mitgelieferten Quellen (sources) und nenne lastVerifiedAt, wenn vorhanden.",
    `3. Aktueller Aktualitätsstatus: ${ctx.freshness.statusLabel} (Änderungsrisiko: ${ctx.freshness.changeRiskLabel}). Bei "Veraltet" oder "Unbekannt" weise klar auf manuelle Prüfung beim Förderträger hin.`,
    "4. Keine Rechtsberatung, keine verbindliche Förderzusage. Markiere Antragstexte explizit als ENTWURF.",
    "5. Wenn der Kontext nicht ausreicht, antworte mit einer präzisen Rückfrage statt zu raten.",
    "6. Antworte in 1–5 kurzen Absätzen, danach optional eine Bullet-Liste. Deutsch, sachlich, premium.",
    "7. Empfehle nur Programme, die im Kontext erscheinen — keine externen Vorschläge.",
  ];
  if (ctx.readiness) {
    lines.push(
      `8. Readiness-Status: ${ctx.readiness.verdictLabel} (${ctx.readiness.score}/100). Pflichtdokumente fehlend: ${ctx.readiness.missingCriticalDocs}, harte Voraussetzungen offen: ${ctx.readiness.unmetHardRequirements}.`,
    );
  }
  if (!ctx.profile) {
    lines.push(
      "9. Es liegt kein Unternehmensprofil vor — frage gezielt nach Region, Größe und Vorhaben, bevor du Fit-Aussagen triffst.",
    );
  }
  return lines.join("\n");
}

// ---------- Payload sanitisation ----------
/**
 * Strips anything personally identifiable / free-text from the payload before it
 * leaves the client. Only whitelisted, structured fields go to the gateway.
 */
export function sanitizeCopilotPayload<T extends { context: CopilotContext; message?: string; intent?: CopilotIntent }>(
  payload: T,
): T {
  const ctx = payload.context;
  // Reject any non-registry program
  if (!PROGRAM_SLUGS.has(ctx.program.slug)) {
    throw new Error("copilot_payload_invalid_program");
  }
  // Trim message
  const message = (payload.message ?? "").slice(0, 800);
  // Drop free-text profile fields if anyone smuggled them in
  const cleanProfile = ctx.profile
    ? { region: ctx.profile.region, size: ctx.profile.size, topics: ctx.profile.topics.slice(0, 10) }
    : undefined;
  return {
    ...payload,
    message,
    context: { ...ctx, profile: cleanProfile },
  };
}

// ---------- Validation of model response ----------
export interface CopilotResponseValidation {
  ok: boolean;
  warnings: string[];
}

export function validateCopilotResponse(
  response: string,
  ctx: CopilotContext,
): CopilotResponseValidation {
  const warnings: string[] = [];
  if (!response || response.trim().length < 10) {
    return { ok: false, warnings: ["empty_response"] };
  }
  // Reject mention of unknown programs (basic heuristic: words that look like a registered slug pattern)
  const matchSlug = response.match(/\b([a-z]{3,}-[a-z0-9-]{2,})\b/g);
  if (matchSlug) {
    for (const slug of matchSlug) {
      if (PROGRAM_SLUGS.has(slug) && slug !== ctx.program.slug) {
        warnings.push(`mentions_other_program:${slug}`);
      }
    }
  }
  // Require freshness disclaimer if stale/unknown
  if (
    (ctx.freshness.status === "stale" || ctx.freshness.status === "unknown") &&
    !/manuell.*prüf|offiziell|förderträger|aktuelle.*richtlinie/i.test(response)
  ) {
    warnings.push("missing_freshness_disclaimer");
  }
  // If outline was requested, ensure "Entwurf" disclaimer
  if (/projektbeschreibung|kostenplan|gliederung/i.test(response) && !/entwurf/i.test(response)) {
    warnings.push("missing_draft_disclaimer");
  }
  return { ok: true, warnings };
}

// ---------- Refusal builder ----------
export type RefusalReason =
  | "missing_program"
  | "missing_profile"
  | "out_of_scope"
  | "stale_source"
  | "ambiguous_question"
  | "model_unavailable";

export function buildRefusal(reason: RefusalReason): { reason: RefusalReason; message: string; suggestion?: string } {
  const map: Record<RefusalReason, { message: string; suggestion?: string }> = {
    missing_program: {
      message: "Diese Frage bezieht sich auf kein konkretes Programm aus FördermittelOS.",
      suggestion: "Öffne eine Programmseite und stelle die Frage dort.",
    },
    missing_profile: {
      message: "Für eine Fit-Aussage benötige ich dein Unternehmensprofil (Region, Größe, Vorhaben).",
      suggestion: "Bitte das Matching im Hub ausfüllen.",
    },
    out_of_scope: {
      message: "Diese Frage liegt außerhalb des Fördermittel-Kontexts. Ich beantworte sie nicht, um Halluzinationen zu vermeiden.",
    },
    stale_source: {
      message: "Die Datenbasis für dieses Programm ist veraltet oder unbekannt. Eine belastbare Antwort ist ohne Re-Verifikation nicht möglich.",
      suggestion: "Bitte beim Förderträger die aktuelle Richtlinie prüfen.",
    },
    ambiguous_question: {
      message: "Die Frage ist nicht eindeutig genug.",
      suggestion: "Wähle bitte eine der vordefinierten Aktionen oder präzisiere deine Frage.",
    },
    model_unavailable: {
      message: "Der CoPilot ist derzeit nicht erreichbar. Bitte später erneut versuchen.",
    },
  };
  return { reason, ...map[reason] };
}

// ---------- Cross-OS Bridge Intent typing ----------
export type CrossOsBridgeIntent =
  | "create_deadline_in_fristen_os"
  | "check_offer_in_angebotsvergleich_os"
  | "check_contract_in_vertragschecker_os"
  | "create_policy_review_in_compliance_os"
  | "save_knowledge_note_in_wissens_os";

export interface PreparedBridgeIntent {
  intent: CrossOsBridgeIntent;
  label: string;
  availability: "available" | "coming_soon";
  payload: Record<string, unknown>;
}

export function buildPreparedBridgeIntents(ctx: CopilotContext): PreparedBridgeIntent[] {
  const out: PreparedBridgeIntent[] = [];
  if (ctx.program.deadline) {
    out.push({
      intent: "create_deadline_in_fristen_os",
      label: `Frist „${ctx.program.name}“ in FristenOS anlegen`,
      availability: "available",
      payload: { programSlug: ctx.program.slug, deadline: ctx.program.deadline },
    });
  }
  out.push({
    intent: "check_offer_in_angebotsvergleich_os",
    label: "Beraterangebote in AngebotsvergleichOS prüfen",
    availability: "available",
    payload: { programSlug: ctx.program.slug },
  });
  out.push({
    intent: "check_contract_in_vertragschecker_os",
    label: "Beratungsvertrag in VertragscheckerOS prüfen",
    availability: "coming_soon",
    payload: { programSlug: ctx.program.slug },
  });
  out.push({
    intent: "create_policy_review_in_compliance_os",
    label: "Compliance-Review für Förderpflichten",
    availability: "coming_soon",
    payload: { programSlug: ctx.program.slug, requirements: ctx.program.requirements.map((r) => r.key) },
  });
  out.push({
    intent: "save_knowledge_note_in_wissens_os",
    label: "Programm als Wissensnotiz speichern",
    availability: "available",
    payload: { programSlug: ctx.program.slug, name: ctx.program.name },
  });
  return out;
}

export function isRegisteredProgramSlug(slug: string): boolean {
  return PROGRAM_SLUGS.has(slug);
}

export { getProgramBySlug };
