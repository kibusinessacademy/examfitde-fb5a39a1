// FördermittelOS Cut 2 — Freshness Governance SSOT
// Pure, deterministic, client-safe. No network. No AI.
import type {
  Program,
  ProgramFreshness,
  FreshnessStatus,
  ChangeRisk,
  UpdateCadence,
} from "./types";

const DAY = 86_400_000;

const CADENCE_FRESH_DAYS: Record<UpdateCadence, number> = {
  weekly: 14,
  monthly: 45,
  quarterly: 120,
  yearly: 400,
  "ad-hoc": 90,
};

const CADENCE_STALE_DAYS: Record<UpdateCadence, number> = {
  weekly: 30,
  monthly: 90,
  quarterly: 240,
  yearly: 730,
  "ad-hoc": 240,
};

const DEFAULT_CADENCE: UpdateCadence = "quarterly";

function daysBetween(iso: string | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / DAY);
}

/** Deterministic freshness classification. */
export function classifyFreshness(program: Program, now: Date = new Date()): FreshnessStatus {
  const f = program.freshness;
  if (!f || !f.lastVerifiedAt) return "unknown";

  const cadence = f.updateCadence ?? DEFAULT_CADENCE;
  const ageDays = daysBetween(f.lastVerifiedAt, now);
  if (ageDays === null) return "unknown";

  const overdueDays =
    f.nextReviewAt && !Number.isNaN(new Date(f.nextReviewAt).getTime())
      ? Math.floor((now.getTime() - new Date(f.nextReviewAt).getTime()) / DAY)
      : -Infinity;

  if (ageDays <= CADENCE_FRESH_DAYS[cadence] && overdueDays < 0) return "fresh";
  if (ageDays >= CADENCE_STALE_DAYS[cadence] || overdueDays >= 30) return "stale";
  return "watch";
}

/** Deterministic change-risk classification. */
export function classifyChangeRisk(program: Program, now: Date = new Date()): ChangeRisk {
  let score = 0;

  if (program.status === "paused" || program.status === "upcoming") score += 2;
  if (program.status === "depleted") score += 3;

  if ((program.budgetTensionPct ?? 0) >= 85) score += 2;
  else if ((program.budgetTensionPct ?? 0) >= 60) score += 1;

  if (program.deadline) {
    const days = Math.floor((new Date(program.deadline).getTime() - now.getTime()) / DAY);
    if (!Number.isNaN(days)) {
      if (days >= 0 && days <= 30) score += 2;
      else if (days > 30 && days <= 90) score += 1;
    }
  }

  const cadence = program.freshness?.updateCadence ?? DEFAULT_CADENCE;
  if (cadence === "weekly") score += 2;
  else if (cadence === "monthly") score += 1;

  const regional = !["DE", "EU"].includes(program.region);
  if (regional) score += 1;

  if (score >= 4) return "high";
  if (score >= 2) return "medium";
  return "low";
}

/** True when next review is due / overdue OR freshness is stale/unknown. */
export function needsReview(program: Program, now: Date = new Date()): boolean {
  const status = classifyFreshness(program, now);
  if (status === "stale" || status === "unknown") return true;
  const nextReview = program.freshness?.nextReviewAt;
  if (nextReview) {
    const t = new Date(nextReview).getTime();
    if (!Number.isNaN(t) && t <= now.getTime()) return true;
  }
  return false;
}

export interface FreshnessSummary {
  total: number;
  fresh: number;
  watch: number;
  stale: number;
  unknown: number;
  highRisk: number;
  needsReview: number;
}

export function summarizeProgramFreshness(
  programs: Program[],
  now: Date = new Date(),
): FreshnessSummary {
  const s: FreshnessSummary = {
    total: programs.length,
    fresh: 0,
    watch: 0,
    stale: 0,
    unknown: 0,
    highRisk: 0,
    needsReview: 0,
  };
  for (const p of programs) {
    s[classifyFreshness(p, now)] += 1;
    if (classifyChangeRisk(p, now) === "high") s.highRisk += 1;
    if (needsReview(p, now)) s.needsReview += 1;
  }
  return s;
}

export interface ReviewUrgencyEntry {
  program: Program;
  urgency: number;
  status: FreshnessStatus;
  risk: ChangeRisk;
  reason: string;
}

const STATUS_WEIGHT: Record<FreshnessStatus, number> = {
  stale: 50,
  unknown: 35,
  watch: 20,
  fresh: 0,
};
const RISK_WEIGHT: Record<ChangeRisk, number> = { high: 35, medium: 18, low: 0 };

export function rankProgramsByReviewUrgency(
  programs: Program[],
  now: Date = new Date(),
): ReviewUrgencyEntry[] {
  return programs
    .map((p) => {
      const status = classifyFreshness(p, now);
      const risk = classifyChangeRisk(p, now);
      let urgency = STATUS_WEIGHT[status] + RISK_WEIGHT[risk];

      const nr = p.freshness?.nextReviewAt;
      if (nr) {
        const overdueDays = Math.floor((now.getTime() - new Date(nr).getTime()) / DAY);
        if (!Number.isNaN(overdueDays) && overdueDays > 0) {
          urgency += Math.min(15, overdueDays / 14);
        }
      }
      urgency = Math.max(0, Math.min(100, Math.round(urgency)));

      const parts: string[] = [];
      if (status !== "fresh") parts.push(`Aktualität: ${status}`);
      if (risk !== "low") parts.push(`Änderungsrisiko: ${risk}`);
      if (p.status === "paused") parts.push("Programm pausiert");
      if (p.status === "depleted") parts.push("Topf ausgeschöpft");

      return {
        program: p,
        urgency,
        status,
        risk,
        reason: parts.join(" · ") || "Routine-Review",
      };
    })
    .sort((a, b) => b.urgency - a.urgency);
}

export function explainFreshness(program: Program, now: Date = new Date()): string[] {
  const f = program.freshness;
  const status = classifyFreshness(program, now);
  const risk = classifyChangeRisk(program, now);
  const out: string[] = [];

  if (!f || !f.lastVerifiedAt) {
    out.push("Kein verifiziertes Quellen-Datum hinterlegt — Aktualität nicht abschätzbar.");
  } else {
    const days = daysBetween(f.lastVerifiedAt, now);
    out.push(
      `Letzte Quellen-Verifikation vor ${days} Tagen (Rhythmus: ${f.updateCadence ?? DEFAULT_CADENCE}).`,
    );
  }
  out.push(`Aktualitäts-Status: ${status.toUpperCase()}`);
  out.push(`Änderungsrisiko: ${risk.toUpperCase()}`);

  if (f?.nextReviewAt) {
    const d = new Date(f.nextReviewAt);
    if (!Number.isNaN(d.getTime())) {
      out.push(`Nächste empfohlene Prüfung: ${d.toLocaleDateString("de-DE")}`);
    }
  }
  if (f?.officialSourceRequired) {
    out.push("Vor Antragstellung muss die offizielle Quelle der Förderstelle geprüft werden.");
  }
  if (f?.verificationNotes) out.push(f.verificationNotes);

  return out;
}

export const FRESHNESS_LABEL: Record<FreshnessStatus, string> = {
  fresh: "Aktuell",
  watch: "Beobachten",
  stale: "Prüfen",
  unknown: "Unbekannt",
};

export const CHANGE_RISK_LABEL: Record<ChangeRisk, string> = {
  low: "Niedrig",
  medium: "Mittel",
  high: "Hoch",
};

export function effectiveFreshness(program: Program): ProgramFreshness {
  return program.freshness ?? {};
}
