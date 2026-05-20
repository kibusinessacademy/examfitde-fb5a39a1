/**
 * Phase 8.5 — Kompetenz-Risikokarte.
 */
import type { RiskState } from "@/lib/system/SystemConsciousness";
import type { RecurringWeakness } from "@/lib/examiner/ExaminerLongitudinal";

interface Props {
  risks: RiskState[];
  recurring: RecurringWeakness[];
}

export function CompetencyRiskMap({ risks, recurring }: Props) {
  const recurringKeys = new Set(recurring.map((r) => r.riskKey));
  return (
    <section aria-labelledby="risk-map-h">
      <header className="mb-2">
        <h3 id="risk-map-h" className="text-sm font-semibold text-text-primary">
          Kritische Kompetenzbereiche
        </h3>
      </header>
      {risks.length === 0 ? (
        <p className="text-xs text-text-tertiary">Aktuell keine erhöhten Risiken erfasst.</p>
      ) : (
        <ul className="space-y-1.5">
          {risks.slice(0, 5).map((r) => (
            <li
              key={r.key}
              className="flex items-center justify-between rounded-md border border-border-subtle bg-surface-sunken px-3 py-2"
            >
              <div className="min-w-0">
                <div className="text-sm text-text-primary truncate">{r.label}</div>
                <div className="text-[11px] text-text-tertiary">
                  Tone: {r.tone}
                  {recurringKeys.has(r.key) && " · wiederkehrend"}
                </div>
              </div>
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full border ${
                  r.tone === "critical"
                    ? "border-destructive/40 text-destructive bg-destructive-bg-subtle"
                    : r.tone === "watch"
                    ? "border-warning/40 text-warning bg-warning-bg-subtle"
                    : "border-border-subtle text-text-secondary bg-surface-raised"
                }`}
              >
                {r.tone}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
