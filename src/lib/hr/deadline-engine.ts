/**
 * HR Deadline Engine — pure, deterministisch, evidence-basiert.
 * Keine Rechtsberatung. Reine Anwendung der SSOT-Rules.
 */
import {
  DEADLINE_RULES,
  DEADLINE_RULESET_VERSION,
  DEFAULT_WARNINGS,
  type ContractType,
  type DeadlineRule,
  type EmploymentRole,
  type WarningFlag,
} from "./deadline-rules";

export interface DeadlineInput {
  role: EmploymentRole;
  contract: ContractType;
  startDate: string; // YYYY-MM-DD (Beginn Beschäftigung)
  noticeDate: string; // YYYY-MM-DD (Tag des Zugangs)
}

export interface DeadlineResult {
  endDate: string; // YYYY-MM-DD
  endDateFormatted: string;
  rule: DeadlineRule;
  durationLabel: string;
  targetLabel: string;
  tenureMonths: number;
  warnings: WarningFlag[];
  rulesetVersion: string;
}

const MS_PER_DAY = 86_400_000;

function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fmtIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtDe(d: Date): string {
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
}

function monthsBetween(start: Date, end: Date): number {
  const years = end.getUTCFullYear() - start.getUTCFullYear();
  const months = end.getUTCMonth() - start.getUTCMonth();
  const dayAdjust = end.getUTCDate() < start.getUTCDate() ? -1 : 0;
  return years * 12 + months + dayAdjust;
}

function endOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

function findRule(role: EmploymentRole, contract: ContractType, tenureMonths: number): DeadlineRule {
  const matches = DEADLINE_RULES.filter((r) => {
    const a = r.applies;
    if (a.contract !== contract) return false;
    if (a.role && a.role !== role) return false;
    if (tenureMonths < a.minTenureMonths) return false;
    if (a.maxTenureMonths !== undefined && tenureMonths >= a.maxTenureMonths) return false;
    return true;
  });
  // Bei mehreren Treffern (z. B. Grundfrist + AG-Verlängerung): wähle größte Dauer in Monaten-Äquivalent.
  const toMonthsEq = (r: DeadlineRule) =>
    r.unit === "monate" ? r.duration : r.unit === "wochen" ? r.duration / 4.345 : r.duration / 30;
  matches.sort((a, b) => toMonthsEq(b) - toMonthsEq(a));
  if (!matches[0]) throw new Error("Keine passende Frist gefunden — Eingaben prüfen.");
  return matches[0];
}

function addDuration(from: Date, rule: DeadlineRule): Date {
  const next = new Date(from);
  if (rule.unit === "tage") next.setUTCDate(next.getUTCDate() + rule.duration);
  else if (rule.unit === "wochen") next.setUTCDate(next.getUTCDate() + rule.duration * 7);
  else next.setUTCMonth(next.getUTCMonth() + rule.duration);
  return next;
}

function snapToTarget(d: Date, rule: DeadlineRule): Date {
  if (rule.targetRule === "monatsende") return endOfMonth(d);
  if (rule.targetRule === "fuenfzehnter_oder_monatsende") {
    const eom = endOfMonth(d);
    const fifteenth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 15));
    // Nächstes mögliches Ende ≥ d
    if (d.getTime() <= fifteenth.getTime()) return fifteenth;
    return eom;
  }
  return d;
}

function durationLabel(rule: DeadlineRule): string {
  const u = rule.unit === "tage" ? "Tag(e)" : rule.unit === "wochen" ? "Woche(n)" : "Monat(e)";
  return `${rule.duration} ${u}`;
}

function targetLabel(rule: DeadlineRule): string {
  if (rule.targetRule === "monatsende") return "zum Monatsende";
  if (rule.targetRule === "fuenfzehnter_oder_monatsende") return "zum 15. oder Monatsende";
  return "ohne festen Termin";
}

export function calculateDeadline(input: DeadlineInput): DeadlineResult {
  const start = parseDate(input.startDate);
  const notice = parseDate(input.noticeDate);
  if (notice.getTime() < start.getTime()) {
    throw new Error("Zugangsdatum der Kündigung liegt vor Beschäftigungsbeginn.");
  }
  const tenureMonths = monthsBetween(start, notice);
  const rule = findRule(input.role, input.contract, tenureMonths);

  // +1 Tag, damit Zugangstag nicht mitgezählt wird (Frist beginnt am Folgetag).
  const fristStart = new Date(notice.getTime() + MS_PER_DAY);
  const afterDuration = addDuration(fristStart, rule);
  const end = snapToTarget(afterDuration, rule);

  return {
    endDate: fmtIso(end),
    endDateFormatted: fmtDe(end),
    rule,
    durationLabel: durationLabel(rule),
    targetLabel: targetLabel(rule),
    tenureMonths,
    warnings: DEFAULT_WARNINGS,
    rulesetVersion: DEADLINE_RULESET_VERSION,
  };
}
