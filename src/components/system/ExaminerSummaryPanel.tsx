/**
 * Phase 8.5 — Prüferische Zusammenfassung.
 * Ruhig, sachlich, ohne motivationale Sprache.
 */
interface Props {
  verdict: string;
  authorityStatus: string;
  confidence: number;
  readiness: number;
}

export function ExaminerSummaryPanel({ verdict, authorityStatus, confidence, readiness }: Props) {
  const confidencePct = Math.round(confidence * 100);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Cell label="Prüfungsreife" value={`${Math.round(readiness)}/100`} />
      <Cell label="Verdict" value={verdict} mono />
      <Cell label="Status" value={authorityStatus} mono />
      <Cell label="Aussagekraft" value={`${confidencePct}%`} />
    </div>
  );
}

function Cell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-sunken px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-text-tertiary">{label}</div>
      <div className={`text-sm font-semibold text-text-primary mt-0.5 ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}
