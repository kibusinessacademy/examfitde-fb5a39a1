// FördermittelOS — Cut 6: Conversion & Lead Capture OS (SSOT)
// Pure, deterministic, client-safe. No AI, no network.
// Single source of truth for lead intent classification, lead quality scoring,
// funding report assembly, cross-OS upsell, payload sanitization, consent copy.
import type { CompanyProfile, ProgramMatch } from "./types";
import {
  computeApplicationReadiness,
  type ApplicationReadiness,
  type BridgeOS,
} from "./execution";
import { classifyFreshness } from "./freshness";

// ---------- Public types ----------

export type ConversionIntent =
  | "funding_check_started"
  | "funding_check_completed"
  | "report_requested"
  | "report_downloaded"
  | "copilot_action_clicked"
  | "application_roadmap_opened"
  | "cross_os_upsell_clicked"
  | "unknown";

export interface ConversionEvent {
  name: string;
  /** raw event payload — must already be sanitized */
  metadata?: Record<string, unknown>;
}

export type LeadSourcePage =
  | "hub"
  | "cluster_state"
  | "cluster_topic"
  | "cluster_industry"
  | "cluster_combination"
  | "cluster_current"
  | "checklist"
  | "program_detail"
  | "report_share";

export interface LeadCapturePayload {
  /** Business email — only @ allowed, max 254 chars */
  email: string;
  companyName?: string;
  companySize?: CompanyProfile["size"];
  region?: CompanyProfile["region"];
  industry?: string;
  goal?: string;
  consentMarketing: boolean;
  source: LeadSourcePage;
  /** opaque, anonymous client-generated request id (no PII) */
  requestId: string;
  /** optional context snapshot — already sanitized */
  reportContext?: SanitizedReportContext;
}

export interface SanitizedReportContext {
  topProgramSlugs: string[];
  averageFit: number;
  averageProbability: number;
  freshnessRiskCount: number;
  readinessVerdict?: ApplicationReadiness["verdict"];
}

export interface CrossOsRecommendation {
  os: BridgeOS;
  label: string;
  reason: string;
  cta: string;
  priority: "now" | "soon" | "later";
}

export interface FundingReportSummary {
  /** stable hash-like report key (no PII) — safe for URLs */
  reportKey: string;
  generatedAtIso: string;
  topMatches: Array<{
    slug: string;
    name: string;
    fit: number;
    probability: number;
    freshness: ReturnType<typeof classifyFreshness>;
  }>;
  estimatedTotalEur: { min: number; max: number };
  freshnessRisks: Array<{ slug: string; reason: string }>;
  missingDocumentsTop: string[];
  nextBestActions: string[];
  crossOsRecommendations: CrossOsRecommendation[];
  warnings: string[];
}

export interface ConsentCopy {
  headline: string;
  body: string;
  checkboxLabel: string;
  privacyLine: string;
}

export interface LeadMagnetOffer {
  headline: string;
  subline: string;
  bullets: string[];
  ctaLabel: string;
  trustLine: string;
}

// ---------- Lead Magnet Offer ----------

export function buildLeadMagnetOffer(context: {
  hasMatches: boolean;
  topCount: number;
  staleCount: number;
  source: LeadSourcePage;
}): LeadMagnetOffer {
  if (!context.hasMatches) {
    return {
      headline: "Fördermittel-Check für Ihr Unternehmen",
      subline:
        "Profil eingeben, in 60 Sekunden passende Programme + Bewilligungs­wahrscheinlichkeit erhalten.",
      bullets: [
        "Top-Programme aus Bund, Ländern, EU",
        "Bewilligungs­wahrscheinlichkeit pro Programm",
        "Aktualitäts- und Fristen-Check",
      ],
      ctaLabel: "Kostenlosen Fördermittel-Report anfordern",
      trustLine: "DSGVO-konform · keine Daten an Dritte · jederzeit widerrufbar",
    };
  }
  const urgent = context.staleCount > 0;
  return {
    headline: urgent
      ? `Report sichern — ${context.topCount} passende Programme, ${context.staleCount} mit Aktualitätsrisiko`
      : `Ihren persönlichen Fördermittel-Report sichern (${context.topCount} Matches)`,
    subline:
      "Konsolidierter PDF-ready Förderreport mit Antragsfahrplan, Cross-OS-Empfehlungen und Risiko-Hinweisen.",
    bullets: [
      "Top-Förderungen mit Fit-Score und Bewilligungs­wahrscheinlichkeit",
      "Pflichtdokumente und Antragsfahrplan pro Programm",
      "Aktualitätsrisiken und Fristen-Warnungen",
      "Cross-OS-Empfehlungen (VertragscheckerOS, AngebotsvergleichOS, ComplianceOS, FristenOS, WissensOS)",
    ],
    ctaLabel: "Kostenlosen Fördermittel-Report erhalten",
    trustLine: "DSGVO-konform · kein Spam · jederzeit widerrufbar · Report bleibt unter Ihrer Kontrolle",
  };
}

// ---------- Lead Quality Score ----------

const SIZE_WEIGHT: Record<CompanyProfile["size"], number> = {
  solo: 10,
  micro: 14,
  small: 18,
  medium: 20,
  large: 20,
};

const SOURCE_WEIGHT: Record<LeadSourcePage, number> = {
  hub: 12,
  cluster_state: 14,
  cluster_topic: 14,
  cluster_industry: 16,
  cluster_combination: 18,
  cluster_current: 10,
  checklist: 18,
  program_detail: 20,
  report_share: 16,
};

/**
 * Deterministic 0..100 lead quality score.
 * Combines match quality, profile completeness, source intent.
 */
export function computeLeadQualityScore(
  matchResults: ReadonlyArray<ProgramMatch>,
  companyProfile: Partial<CompanyProfile> | null | undefined,
  sourcePage: LeadSourcePage,
): { score: number; tier: "cold" | "warm" | "hot"; reasons: string[] } {
  const reasons: string[] = [];

  // Match quality (max 40)
  const top = matchResults.slice(0, 3);
  const avgFit =
    top.length === 0 ? 0 : top.reduce((s, m) => s + m.fit, 0) / top.length;
  const avgProb =
    top.length === 0 ? 0 : top.reduce((s, m) => s + m.probability, 0) / top.length;
  const matchScore = Math.round((avgFit * 0.6 + avgProb * 0.4) * 0.4);
  if (top.length >= 1) reasons.push(`${top.length} passende Programme (Ø Fit ${avgFit.toFixed(0)})`);

  // Profile completeness (max 30)
  let profileScore = 0;
  if (companyProfile?.region) profileScore += 6;
  if (companyProfile?.size) profileScore += SIZE_WEIGHT[companyProfile.size] ?? 0;
  if (companyProfile?.industry) profileScore += 4;
  if (companyProfile?.topics && companyProfile.topics.length > 0) profileScore += 4;
  profileScore = Math.min(30, profileScore);
  if (profileScore >= 20) reasons.push("Vollständiges Unternehmensprofil");

  // Source intent (max 20)
  const sourceScore = SOURCE_WEIGHT[sourcePage] ?? 10;
  reasons.push(`Intent-Quelle: ${sourcePage}`);

  // Urgency bonus (max 10)
  let urgency = 0;
  for (const m of top) {
    if (m.warnings.some((w) => w.toLowerCase().includes("frist") || w.toLowerCase().includes("budget"))) {
      urgency = 10;
      reasons.push("Hohe Dringlichkeit (Frist/Budget)");
      break;
    }
  }

  const score = Math.min(100, matchScore + profileScore + sourceScore + urgency);
  const tier: "cold" | "warm" | "hot" =
    score >= 70 ? "hot" : score >= 45 ? "warm" : "cold";
  return { score, tier, reasons };
}

// ---------- Funding Report Summary ----------

export function buildFundingReportSummary(args: {
  matchResults: ReadonlyArray<ProgramMatch>;
  profile?: Partial<CompanyProfile> | null;
  reportKey: string;
  now?: Date;
}): FundingReportSummary {
  const now = args.now ?? new Date();
  const top = args.matchResults.slice(0, 5);

  const topMatches = top.map((m) => ({
    slug: m.program.slug,
    name: m.program.name,
    fit: m.fit,
    probability: m.probability,
    freshness: classifyFreshness(m.program, now),
  }));

  const minTotal = top.reduce((s, m) => s + (m.program.funding.amountEurMin ?? 0), 0);
  const maxTotal = top.reduce((s, m) => s + (m.program.funding.amountEurMax ?? 0), 0);

  const freshnessRisks = top
    .filter((m) => {
      const s = classifyFreshness(m.program, now);
      return s === "stale" || s === "unknown";
    })
    .map((m) => ({
      slug: m.program.slug,
      reason:
        classifyFreshness(m.program, now) === "stale"
          ? "Datenstand überfällig — vor Antrag Quelle prüfen"
          : "Kein verifiziertes Datum — vor Antrag Quelle prüfen",
    }));

  // Missing documents from top match readiness
  let missingDocumentsTop: string[] = [];
  let readinessVerdict: ApplicationReadiness["verdict"] | undefined;
  if (top[0]) {
    const readiness = computeApplicationReadiness(top[0].program, undefined, undefined, now);
    readinessVerdict = readiness.verdict;
    // Best-effort surface — first 5 critical docs
    missingDocumentsTop = top[0].program.documentsNeeded.slice(0, 5);
  }

  const warnings: string[] = [];
  if (top.length === 0) warnings.push("Keine passenden Programme — Profil verfeinern.");
  if (freshnessRisks.length > 0) warnings.push(`${freshnessRisks.length} Programm(e) mit Aktualitätsrisiko.`);
  if (readinessVerdict === "blocked") warnings.push("Top-Programm aktuell blockiert — Pflichtkriterien prüfen.");

  const nextBestActions = buildReportNextBestActions(top, freshnessRisks.length, readinessVerdict);
  const crossOsRecommendations = buildCrossOsUpsellRecommendations({
    topMatches,
    freshnessRisks,
    readinessVerdict,
  });

  return {
    reportKey: args.reportKey,
    generatedAtIso: now.toISOString(),
    topMatches,
    estimatedTotalEur: { min: minTotal, max: maxTotal },
    freshnessRisks,
    missingDocumentsTop,
    nextBestActions,
    crossOsRecommendations,
    warnings,
  };
}

function buildReportNextBestActions(
  top: ReadonlyArray<ProgramMatch>,
  staleCount: number,
  verdict?: ApplicationReadiness["verdict"],
): string[] {
  const out: string[] = [];
  if (top[0]) out.push(`Antragsfahrplan für ${top[0].program.name} öffnen`);
  if (staleCount > 0) out.push("Aktualitätsrisiken in den Quellen verifizieren");
  if (verdict === "gaps" || verdict === "blocked") {
    out.push("Pflichtdokumente sammeln (siehe Checkliste)");
  }
  if (top.length >= 2) out.push("Kombinationsmöglichkeiten Bund + Land prüfen");
  out.push("Persönlichen Förderreport speichern und mit Team teilen");
  return out.slice(0, 5);
}

// ---------- Cross-OS Upsell ----------

export function buildCrossOsUpsellRecommendations(input: {
  topMatches: FundingReportSummary["topMatches"];
  freshnessRisks: FundingReportSummary["freshnessRisks"];
  readinessVerdict?: ApplicationReadiness["verdict"];
}): CrossOsRecommendation[] {
  const recs: CrossOsRecommendation[] = [];

  if (input.topMatches.length > 0) {
    recs.push({
      os: "FristenOS",
      label: "Fristen automatisch tracken",
      reason: "Förderfristen und Nachweisfristen ohne manuelle Tabellen",
      cta: "Fristen in FristenOS anlegen",
      priority: "now",
    });
  }
  if (input.topMatches.length >= 2) {
    recs.push({
      os: "AngebotsvergleichOS",
      label: "Anbieter-Angebote vergleichen",
      reason: "Projektkosten plausibilisieren bevor der Antrag rausgeht",
      cta: "Angebote in AngebotsvergleichOS bewerten",
      priority: "soon",
    });
  }
  if (input.topMatches.some((m) => /vertrag|beratung|dienst/i.test(m.name))) {
    recs.push({
      os: "VertragscheckerOS",
      label: "Förder- und Dienstleisterverträge prüfen",
      reason: "Konformität mit Fördervoraussetzungen sicherstellen",
      cta: "Verträge in VertragscheckerOS prüfen",
      priority: "soon",
    });
  }
  if (input.freshnessRisks.length > 0 || input.readinessVerdict === "blocked") {
    recs.push({
      os: "ComplianceOS",
      label: "Datenschutz-, AI- und Beihilfe-Risiken klären",
      reason: "EU-AI-Act und De-minimis Themen vor Antragstellung adressieren",
      cta: "Compliance-Check starten",
      priority: input.readinessVerdict === "blocked" ? "now" : "later",
    });
  }
  recs.push({
    os: "WissensOS",
    label: "Antragsentscheidungen als Knowledge-Note sichern",
    reason: "Begründungen, Quellen und Verantwortliche zentral dokumentieren",
    cta: "Notiz in WissensOS anlegen",
    priority: "later",
  });
  return recs;
}

// ---------- Conversion Intent Classification ----------

export function classifyConversionIntent(event: ConversionEvent): ConversionIntent {
  const n = event.name.toLowerCase();
  if (n.includes("funding_check_started") || n === "matching_started") return "funding_check_started";
  if (n.includes("funding_check_completed") || n === "matching_completed") return "funding_check_completed";
  if (n.includes("report_requested") || n.includes("lead_capture_submitted")) return "report_requested";
  if (n.includes("report_downloaded") || n.includes("report_generated")) return "report_downloaded";
  if (n.includes("copilot")) return "copilot_action_clicked";
  if (n.includes("roadmap")) return "application_roadmap_opened";
  if (n.includes("cross_os") || n.includes("upsell")) return "cross_os_upsell_clicked";
  return "unknown";
}

// ---------- Payload Sanitization ----------

const PII_PATTERNS: RegExp[] = [
  /\b\d{2,3}[-.\s]?\d{3,}[-.\s]?\d{2,}\b/, // phone-like
  /\b\d{10,}\b/, // long numeric ids
  /\b[A-Z]{2}\d{2}[ ]?\d{4}[ ]?\d{4}[ ]?\d{2,}\b/, // IBAN-like
];

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.de",
  "outlook.com",
  "hotmail.com",
  "hotmail.de",
  "gmx.de",
  "gmx.net",
  "web.de",
  "t-online.de",
  "icloud.com",
  "me.com",
  "mail.com",
  "freenet.de",
]);

const MAX_STR = 254;

export interface SanitizationResult {
  ok: boolean;
  cleaned?: LeadCapturePayload;
  errors: string[];
  warnings: string[];
}

function safeStr(v: unknown, max = MAX_STR): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim().slice(0, max);
  if (!t) return undefined;
  for (const re of PII_PATTERNS) if (re.test(t)) return undefined;
  return t;
}

export function isBusinessEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at <= 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return !FREE_EMAIL_DOMAINS.has(domain);
}

export function sanitizeLeadPayload(payload: Partial<LeadCapturePayload>): SanitizationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const rawEmail = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  // RFC-lite email check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(rawEmail) || rawEmail.length > MAX_STR) {
    errors.push("invalid_email");
  }
  if (!payload.consentMarketing) errors.push("consent_required");
  if (!payload.source) errors.push("source_required");
  if (!payload.requestId || typeof payload.requestId !== "string") errors.push("request_id_required");

  if (rawEmail && !isBusinessEmail(rawEmail)) {
    warnings.push("non_business_email");
  }

  if (errors.length > 0) return { ok: false, errors, warnings };

  const cleaned: LeadCapturePayload = {
    email: rawEmail,
    companyName: safeStr(payload.companyName, 120),
    companySize: payload.companySize,
    region: payload.region,
    industry: safeStr(payload.industry, 60),
    goal: safeStr(payload.goal, 240),
    consentMarketing: true,
    source: payload.source!,
    requestId: payload.requestId!.slice(0, 64),
    reportContext: sanitizeReportContext(payload.reportContext),
  };
  return { ok: true, cleaned, errors: [], warnings };
}

function sanitizeReportContext(
  ctx?: SanitizedReportContext,
): SanitizedReportContext | undefined {
  if (!ctx) return undefined;
  return {
    topProgramSlugs: (ctx.topProgramSlugs ?? []).filter((s) => typeof s === "string").slice(0, 10),
    averageFit: clampNum(ctx.averageFit, 0, 100),
    averageProbability: clampNum(ctx.averageProbability, 0, 100),
    freshnessRiskCount: clampNum(ctx.freshnessRiskCount, 0, 100),
    readinessVerdict: ctx.readinessVerdict,
  };
}

function clampNum(v: unknown, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(min, Math.min(max, Math.round(n)));
}

// ---------- Consent copy ----------

export function buildConsentCopy(source: LeadSourcePage): ConsentCopy {
  return {
    headline: "DSGVO-konform und transparent",
    body:
      "Wir senden Ihnen den Fördermittel-Report per E-Mail und nehmen optional einmalig Kontakt für eine kurze Einschätzung auf. Keine Weitergabe an Dritte.",
    checkboxLabel:
      "Ich willige ein, dass meine Angaben zur Erstellung des Fördermittel-Reports und für eine optionale Beratungsanfrage verarbeitet werden.",
    privacyLine:
      "Verarbeitung nach Art. 6 Abs. 1 lit. a DSGVO. Widerruf jederzeit per E-Mail an datenschutz@berufos.com möglich. Quelle: " +
      source,
  };
}

// ---------- Helpers exposed for UI ----------

export function buildReportKey(seed: string, now: Date = new Date()): string {
  // Stable, opaque, no PII: timestamp(base36) + 6-char hash of seed
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const hash = Math.abs(h).toString(36).padStart(6, "0").slice(0, 6);
  return `r_${now.getTime().toString(36)}_${hash}`;
}

/** Report URL must NEVER contain PII. Only the opaque key. */
export function buildReportPath(reportKey: string): string {
  if (!/^r_[a-z0-9_]+$/.test(reportKey)) {
    throw new Error("invalid report key format");
  }
  return `/foerdermittel/report/${reportKey}`;
}
