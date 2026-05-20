import { useExaminerConsciousness } from "@/lib/examiner";
import { riskToneClasses } from "@/lib/system/SystemConsciousness";

/**
 * Phase 7.7 — Listet Top-Risiken inkl. ihrer Evidence-Items.
 * Ruhig, sachlich. Keine Empfehlungen, keine Coaches.
 */
export function RiskEvidenceList({
  elapsedRatio = 0,
  className = "",
}: {
  elapsedRatio?: number;
  className?: string;
}) {
  const c = useExaminerConsciousness(elapsedRatio);
  return (
    <section
      className={`rounded-2xl border border-border/60 bg-card/70 p-4 backdrop-blur ${className}`}
      aria-label="Risikomuster mit belegenden Beobachtungen"
    >
      <div className="mb-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        Risikomuster · belegt
      </div>
      <ul className="space-y-2">
        {c.topRiskEvidence.map((chain, i) => {
          const tones = riskToneClasses(chain.tone);
          return (
            <li key={i} className={`rounded-lg border px-3 py-2 ${tones}`}>
              <p className="text-xs font-medium">{chain.claim}</p>
              <p className="mt-0.5 text-[10px] opacity-75">
                Confidence {(chain.confidence * 100).toFixed(0)}% · {chain.evidence.length} Beleg
                {chain.evidence.length === 1 ? "" : "e"}
              </p>
              <ul className="mt-1.5 space-y-1 border-t border-border/30 pt-1.5">
                {chain.evidence.map((e) => (
                  <li key={e.id} className="text-[11px] leading-snug opacity-90">
                    · {e.observation}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
