import { motion } from "framer-motion";
import { ClipboardCheck, Gauge } from "lucide-react";
import { useExaminerConsciousness } from "@/lib/examiner";
import { READINESS_STATE_LABEL } from "@/lib/examiner";
import { riskToneClasses } from "@/lib/system/SystemConsciousness";

/**
 * Phase 8.0/8.3 — Erklärungs-Panel: „Warum bewertet der Examiner das so?"
 *
 * Zeigt Readiness-State, Confidence sichtbar (keine Fake-Präzision) und
 * die zentralen Deliberation-Gründe. Cross-surface, ruhig, prüferisch.
 */
export function ReadinessReasonPanel({
  elapsedRatio = 0,
  className = "",
}: {
  elapsedRatio?: number;
  className?: string;
}) {
  const c = useExaminerConsciousness(elapsedRatio);
  const tones = riskToneClasses(c.verdict.tone);

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`rounded-2xl border border-border/60 bg-card/70 p-4 backdrop-blur ${className}`}
      aria-label="Begründung der prüferischen Readiness-Einschätzung"
    >
      <div className={`mb-3 rounded-xl border px-3 py-2 ${tones}`}>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] opacity-70">
          <ClipboardCheck className="h-3 w-3" aria-hidden /> Readiness-Einschätzung
        </div>
        <p className="mt-1 text-sm font-medium">
          {c.authority.label} · {READINESS_STATE_LABEL[c.deliberation.readiness_state]}
        </p>
        <p className="mt-0.5 text-[11px] opacity-80">{c.authority.recommendation}</p>
      </div>

      <div className="mb-2 flex items-center gap-2 rounded-lg border border-border/40 bg-background/40 px-3 py-2">
        <Gauge className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <div className="text-[11px] text-muted-foreground">
          Confidence{" "}
          <span className="font-medium text-foreground">
            {(c.deliberation.confidence * 100).toFixed(0)}%
          </span>
          <span className="opacity-60"> · </span>
          Stabilität {c.stability.index}/100 · {c.stability.reading}
        </div>
      </div>

      <ul className="space-y-1">
        {c.deliberation.deliberation_reasoning.map((r, idx) => (
          <li key={idx} className="text-[12px] leading-snug text-foreground">
            · {r}
          </li>
        ))}
      </ul>
    </motion.section>
  );
}
