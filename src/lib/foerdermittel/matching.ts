// FördermittelOS — Matching & Probability Engine (deterministic, client-safe)
import { PROGRAMS } from "./registry";
import type { CompanyProfile, Program, ProgramMatch } from "./types";
import { classifyFreshness } from "./freshness";


const SIZE_RANK = { solo: 0, micro: 1, small: 2, medium: 3, large: 4 } as const;

function regionMatches(profileRegion: string, programRegion: string): boolean {
  if (programRegion === "DE" || programRegion === "EU") return true;
  return programRegion === profileRegion;
}

function sizeMatches(p: CompanyProfile, prog: Program): boolean {
  return prog.eligibleCompanySizes.includes(p.size);
}

function topicOverlap(p: CompanyProfile, prog: Program): number {
  if (p.topics.length === 0 || prog.topics.length === 0) return 0;
  const overlap = prog.topics.filter((t) => p.topics.includes(t)).length;
  return overlap / Math.max(prog.topics.length, p.topics.length);
}

function statusFactor(prog: Program): number {
  switch (prog.status) {
    case "active":
      return 1;
    case "upcoming":
      return 0.7;
    case "paused":
      return 0.3;
    case "depleted":
      return 0.1;
    case "expired":
      return 0;
  }
}

export function matchPrograms(profile: CompanyProfile): ProgramMatch[] {
  return PROGRAMS.map((program) => scoreMatch(profile, program))
    .filter((m) => m.fit > 5)
    .sort((a, b) => b.fit - a.fit);
}

export function scoreMatch(profile: CompanyProfile, program: Program): ProgramMatch {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const disqualifiers: string[] = [];

  const regionOk = regionMatches(profile.region, program.region);
  const sizeOk = sizeMatches(profile, program);
  const overlap = topicOverlap(profile, program);

  if (!regionOk) disqualifiers.push(`Nicht förderfähig in Region ${profile.region}`);
  if (!sizeOk)
    disqualifiers.push(
      `Unternehmensgröße "${profile.size}" nicht in zulässigem Set (${program.eligibleCompanySizes.join(", ")}).`,
    );

  // Fit base
  let fit = 0;
  if (regionOk) {
    fit += 25;
    reasons.push(program.region === "DE" ? "Bundesweit förderfähig" : `Region passt (${program.region})`);
  }
  if (sizeOk) {
    fit += 20;
    reasons.push(`Unternehmensgröße zulässig`);
  }
  fit += Math.round(overlap * 40);
  if (overlap > 0.4) reasons.push(`Themen-Match (${Math.round(overlap * 100)} %)`);

  // Status modifier
  const sf = statusFactor(program);
  fit = Math.round(fit * sf);
  if (program.status === "paused") warnings.push("Programm aktuell pausiert.");
  if (program.status === "upcoming") warnings.push("Programm in Wiederauflage / noch nicht aktiv.");
  if (program.status === "depleted") warnings.push("Fördertopf ausgeschöpft.");

  // Budget tension
  if ((program.budgetTensionPct ?? 0) >= 85) {
    warnings.push(`Hohe Topf-Auslastung (${program.budgetTensionPct} %).`);
  }

  // Deadline warning
  if (program.deadline) {
    const days = Math.round((new Date(program.deadline).getTime() - Date.now()) / 86_400_000);
    if (days < 30) warnings.push(`Frist in ${days} Tagen.`);
  }

  // Probability estimate
  const base = program.historicalApprovalRate ?? 0.5;
  const sizeBoost = sizeOk ? 0 : -0.25;
  const overlapBoost = (overlap - 0.5) * 0.2;
  const statusPenalty = sf < 1 ? -0.2 * (1 - sf) : 0;
  let probability = Math.round((base + sizeBoost + overlapBoost + statusPenalty) * 100);
  probability = Math.max(0, Math.min(100, probability));

  // Cut 2 — freshness-aware soft penalty (never disqualifies)
  const freshness = classifyFreshness(program);
  if (freshness === "stale") {
    fit = Math.round(fit * 0.9);
    warnings.push("Aktualität: Quellen-Verifikation überfällig — vor Antrag prüfen.");
  } else if (freshness === "unknown") {
    fit = Math.round(fit * 0.93);
    warnings.push("Aktualität: Keine verifizierte Quelle hinterlegt — Fit gut, aber prüfen.");
  } else if (freshness === "watch") {
    warnings.push("Aktualität: Programm aktuell unter Beobachtung.");
  }

  // Cap fit if disqualified
  if (disqualifiers.length > 0) fit = Math.round(fit * 0.4);

  return {
    program,
    fit: Math.max(0, Math.min(100, fit)),
    probability,
    reasons,
    warnings,
    disqualifiers,
  };
}

export function rankNoise(matches: ProgramMatch[]): {
  excellent: ProgramMatch[];
  good: ProgramMatch[];
  watch: ProgramMatch[];
} {
  return {
    excellent: matches.filter((m) => m.fit >= 70 && m.disqualifiers.length === 0),
    good: matches.filter((m) => m.fit >= 45 && m.fit < 70 && m.disqualifiers.length === 0),
    watch: matches.filter((m) => m.fit < 45 || m.disqualifiers.length > 0),
  };
}

export const SIZE_LABEL: Record<CompanyProfile["size"], string> = {
  solo: "Solo / Freiberufler",
  micro: "Kleinstunternehmen (< 10)",
  small: "Klein (10–49)",
  medium: "Mittel (50–249)",
  large: "Groß (250+)",
};

export const REGION_LABEL: Record<string, string> = {
  DE: "Bundesweit",
  EU: "EU-weit",
  BW: "Baden-Württemberg", BY: "Bayern", BE: "Berlin", BB: "Brandenburg",
  HB: "Bremen", HH: "Hamburg", HE: "Hessen", MV: "Mecklenburg-Vorpommern",
  NI: "Niedersachsen", NW: "Nordrhein-Westfalen", RP: "Rheinland-Pfalz",
  SL: "Saarland", SN: "Sachsen", ST: "Sachsen-Anhalt", SH: "Schleswig-Holstein", TH: "Thüringen",
};

export { SIZE_RANK };
