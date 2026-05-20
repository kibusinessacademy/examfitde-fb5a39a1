import { motion } from "framer-motion";
import { FileSearch, ShieldAlert } from "lucide-react";
import { useExaminerConsciousness } from "@/lib/examiner";
import { riskToneClasses } from "@/lib/system/SystemConsciousness";

/**
 * Phase 7.7 — Examiner Evidence Card.
 *
 * Ruhig, sachlich, prüferisch. Zeigt die Evidence-Kette, auf der das
 * aktuelle Verdict beruht. Niemals motivational, niemals generisch.
 */
export function ExaminerEvidenceCard({
  elapsedRatio = 0,
  className = "",
}: {
  elapsedRatio?: number;
  className?: string;
}) {
  const c = useExaminerConsciousness(elapsedRatio);
  const tones = riskToneClasses(c.verdictEvidence.tone);

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-2xl border border-border/60 bg-card/70 p-4 backdrop-blur ${className}`}
      aria-label="Belegende Beobachtungen zur prüferischen Einschätzung"
    >
      <div className={`mb-3 rounded-xl border px-3 py-2 ${tones}`}>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] opacity-70">
          <FileSearch className="h-3 w-3" aria-hidden /> Belegende Beobachtungen
        </div>
        <p className="mt-1 text-sm font-medium">{c.verdictEvidence.claim}</p>
        <p className="mt-0.5 text-[11px] opacity-80">
          Confidence {(c.verdictEvidence.confidence * 100).toFixed(0)}% · Severity {c.verdictEvidence.severity}
        </p>
      </div>

      <ul className="space-y-2">
        {c.verdictEvidence.evidence.map((e) => (
          <li
            key={e.id}
            className="rounded-lg border border-border/40 bg-background/40 px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <ShieldAlert className="h-3 w-3" aria-hidden />
                {e.source_type.replace(/_/g, " ")}
              </span>
              <span className="opacity-70">{(e.confidence * 100).toFixed(0)}%</span>
            </div>
            <p className="mt-0.5 text-xs text-foreground">{e.observation}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {e.detected_pattern} · Relevanz {e.exam_relevance} · Severity {e.severity}
            </p>
          </li>
        ))}
      </ul>
    </motion.section>
  );
}
