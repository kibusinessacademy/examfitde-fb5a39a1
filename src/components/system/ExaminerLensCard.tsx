import { motion } from "framer-motion";
import { Brain, Compass, Gauge, LineChart, ShieldCheck, Sparkles } from "lucide-react";
import { useExaminationConsciousness } from "@/lib/system/ExaminationConsciousness";
import { riskToneClasses } from "@/lib/system/SystemConsciousness";
import { fatigueLabel } from "@/lib/system/CognitiveFatigue";

/**
 * Phase 7.0 — Cross-Surface Examiner-Lens.
 *
 * Liest EXCLUSIV aus der Examination-Consciousness-Facade. Ruhig,
 * prüferisch, niemals dashboardig. Erscheint in /app/tutor, /app/lernpfad
 * und optional an Prüfungsreife-Ergebnisseiten.
 */
export function ExaminerLensCard({ elapsedRatio = 0, className = "" }: { elapsedRatio?: number; className?: string }) {
  const c = useExaminationConsciousness(elapsedRatio);
  const tones = riskToneClasses(c.verdict.tone);

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-2xl border border-border/60 bg-card/70 p-4 backdrop-blur ${className}`}
      aria-label="Prüferische Gesamteinschätzung"
    >
      {/* Verdict */}
      <div className={`mb-3 rounded-xl border px-3 py-2 ${tones}`}>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] opacity-70">
          <Brain className="h-3 w-3" aria-hidden /> Prüferische Einschätzung
        </div>
        <p className="mt-1 text-sm font-medium">{c.verdict.headline}</p>
        <p className="mt-0.5 text-xs opacity-80">{c.verdict.detail}</p>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <LensRow
          icon={<Compass className="h-3.5 w-3.5" />}
          label="Prüfer-Haltung"
          value={c.personality.label}
          sub={c.personality.intent}
        />
        <LensRow
          icon={<Sparkles className="h-3.5 w-3.5" />}
          label="Transferkomplexität"
          value={c.transfer.level}
          sub={c.transfer.diagnoses}
        />
        <LensRow
          icon={<Gauge className="h-3.5 w-3.5" />}
          label="Belastung"
          value={fatigueLabel(c.fatigue.level)}
          sub={c.fatigue.drivers.length ? c.fatigue.drivers.join(" · ") : "Keine Belastungstreiber aktiv."}
        />
        <LensRow
          icon={<ShieldCheck className="h-3.5 w-3.5" />}
          label="Stabilisierung"
          value={`${c.recovery.index} / 100`}
          sub={c.recovery.reflection}
        />
        <LensRow
          icon={<LineChart className="h-3.5 w-3.5" />}
          label="Prognose · 14 Tage"
          value={`${c.forecast.projections[2].projected} (${c.forecast.projections[2].low}–${c.forecast.projections[2].high})`}
          sub={c.forecast.strategicSuggestion}
        />
        <LensRow
          icon={<Brain className="h-3.5 w-3.5" />}
          label="Längsbeobachtung"
          value={`Ø ${c.examinerMemory.averageRiskAgeDays} Tage`}
          sub={c.examinerMemory.longitudinalSummary}
        />
      </div>

      {/* Footer — Selbstwirksamkeit ruhig spiegeln */}
      <div className="mt-3 border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">Stabilität {c.efficacy.stabilityIndex}/100</span>
        <span className="opacity-60"> · </span>
        <span>{c.efficacy.reflections[0]?.statement ?? c.efficacy.nextLikely}</span>
      </div>
    </motion.section>
  );
}

function LensRow({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-background/40 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="opacity-70">{icon}</span>
        {label}
      </div>
      <p className="mt-0.5 text-xs font-medium text-foreground">{value}</p>
      <p className="text-[11px] leading-snug text-muted-foreground">{sub}</p>
    </div>
  );
}
