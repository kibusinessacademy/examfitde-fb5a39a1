/**
 * Executive Briefing Export (Markdown + Plain-Text).
 * Frontend-only, copy/download. Server-side PDF Pipeline later.
 */
import type { Project, RiskFinding } from "./types";
import { scoreProject, LABEL_META } from "./scoring";
import { buildExecutiveSummary, calcReadiness } from "./decision-readiness";

const fmtEur = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

export function buildExecutiveBriefing(project: Project, risks: RiskFinding[]): string {
  const scored = scoreProject(project);
  const sorted = [...scored].sort((a, b) => b.score.overall - a.score.overall);
  const summary = buildExecutiveSummary(project, risks);
  const readiness = calcReadiness(project, risks);

  const lines: string[] = [];
  lines.push(`EXECUTIVE BRIEFING — ${project.name}`);
  lines.push("=".repeat(60));
  lines.push(`Kategorie: ${project.category}   ·   Budget: ${fmtEur(project.budgetEur)}`);
  lines.push(`Owner: ${project.owner}   ·   Erstellt: ${project.createdAt.split("T")[0]}`);
  lines.push("");
  lines.push("AI EXECUTIVE SUMMARY");
  lines.push("-".repeat(60));
  lines.push(summary.headline);
  summary.body.forEach((l) => lines.push(`  • ${l}`));
  lines.push("");
  if (summary.watchouts.length) {
    lines.push("WATCHOUTS");
    summary.watchouts.forEach((w) => lines.push(`  ! ${w}`));
    lines.push("");
  }
  lines.push("ANBIETER-RANKING");
  lines.push("-".repeat(60));
  sorted.forEach((s, i) => {
    const labels = s.score.labels.map((l) => LABEL_META[l].label).join(", ") || "—";
    lines.push(
      `${i + 1}. ${s.offer.vendor} · ${s.offer.productName}\n   Score ${s.score.overall}/100 · TCO ${fmtEur(
        s.offer.totalCostEur,
      )} · Laufzeit ${s.offer.termMonths} Mon.\n   Labels: ${labels}`,
    );
  });
  lines.push("");
  lines.push("RISIKO-CLUSTER");
  lines.push("-".repeat(60));
  const byLevel = ["critical", "high", "medium", "low", "info"] as const;
  for (const lvl of byLevel) {
    const items = risks.filter((r) => r.level === lvl);
    if (items.length === 0) continue;
    lines.push(`[${lvl.toUpperCase()}] ${items.length}`);
    items.slice(0, 5).forEach((r) => {
      const offer = project.offers.find((o) => o.id === r.offerId);
      lines.push(`  - ${offer?.vendor}: ${r.title} — ${r.detail}`);
    });
  }
  lines.push("");
  lines.push(`DECISION-READINESS: ${readiness.score}%`);
  readiness.factors.forEach((f) => lines.push(`  [${f.done ? "x" : " "}] ${f.label} (Gewicht ${f.weight})`));
  lines.push("");
  lines.push("Disclaimer: Diese AI-gestützte Analyse dient der Entscheidungsvorbereitung");
  lines.push("und ersetzt keine anwaltliche oder steuerliche Beratung.");
  return lines.join("\n");
}

export function downloadBriefing(project: Project, risks: RiskFinding[]) {
  const text = buildExecutiveBriefing(project, risks);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `executive-briefing-${project.slug}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
