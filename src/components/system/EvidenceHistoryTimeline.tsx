/**
 * Phase 8.5 — Evidence-Historie (sachlich, zurückhaltend).
 */
import type { EvidenceChain } from "@/lib/examiner/ExaminerEvidence";

interface Props {
  chains: EvidenceChain[];
}

export function EvidenceHistoryTimeline({ chains }: Props) {
  const items = chains.flatMap((c) => c.evidence.map((e) => ({ ...e, claim: c.claim })));
  if (items.length === 0) {
    return (
      <section>
        <h3 className="text-sm font-semibold text-text-primary mb-2">Evidence</h3>
        <p className="text-xs text-text-tertiary">Keine Evidenz erfasst.</p>
      </section>
    );
  }
  return (
    <section aria-labelledby="evidence-h">
      <h3 id="evidence-h" className="text-sm font-semibold text-text-primary mb-2">
        Evidence-Kette
      </h3>
      <ol className="space-y-1.5">
        {items.slice(0, 8).map((it, i) => (
          <li
            key={`${it.id}-${i}`}
            className="flex items-start gap-2 text-xs text-text-secondary border-l-2 border-border-subtle pl-3"
          >
            <span className="font-mono text-[10px] text-text-tertiary mt-0.5 shrink-0">
              {it.severity}
            </span>
            <span className="min-w-0">{it.observation}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
