import { motion } from "framer-motion";
import { Activity } from "lucide-react";
import { riskToneClasses } from "@/lib/system/SystemConsciousness";
import { useExamDramaturgy } from "@/lib/system/ExamDramaturgy";

/**
 * Phase 6.1 — Cross-Surface Dramaturgie-Chip.
 *
 * Ruhige, prüferische Sichtbarkeit der aktuellen dramaturgischen Phase.
 * Bewusst klein, niemals laut. Keine Stress-Animationen, keine Timer.
 */
export function DramaturgyChip({
  elapsedRatio = 0,
  showInterventions = true,
  className = "",
}: {
  elapsedRatio?: number;
  showInterventions?: boolean;
  className?: string;
}) {
  const { phase, interventions, tension } = useExamDramaturgy(elapsedRatio);
  const tones = riskToneClasses(phase.tone);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-xl border bg-card/60 px-3 py-2 backdrop-blur ${tones} ${className}`}
      aria-label={`Prüfungsphase: ${phase.label}`}
    >
      <div className="flex items-center gap-2">
        <span
          className="relative inline-flex h-1.5 w-1.5 rounded-full"
          style={{ background: "currentColor", opacity: 0.6 + tension.level * 0.4 }}
          aria-hidden
        >
          {tension.rhythm === "peak" || tension.rhythm === "rising" ? (
            <motion.span
              className="absolute inset-0 rounded-full"
              style={{ background: "currentColor" }}
              animate={{ opacity: [0.6, 0.15, 0.6] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            />
          ) : null}
        </span>
        <div className="flex flex-col leading-tight">
          <span className="text-[10px] uppercase tracking-[0.22em] opacity-70">Dramaturgie</span>
          <span className="text-xs font-medium">{phase.label}</span>
        </div>
      </div>
      {showInterventions && interventions.length > 0 && (
        <p className="mt-1.5 text-[11px] opacity-80">{interventions[0].rationale}</p>
      )}
    </motion.div>
  );
}

/** Kompakte Inline-Variante für Header-Zeilen. */
export function DramaturgyInline({ elapsedRatio = 0 }: { elapsedRatio?: number }) {
  const { phase, tension } = useExamDramaturgy(elapsedRatio);
  const tones = riskToneClasses(phase.tone);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${tones}`}
      title={phase.intent}
    >
      <Activity className="h-3 w-3" aria-hidden />
      <span className="uppercase tracking-wider">{phase.label}</span>
      <span className="opacity-60" aria-hidden>·</span>
      <span className="opacity-70">Spannung {Math.round(tension.level * 100)}</span>
    </span>
  );
}
