import { motion } from "framer-motion";
import { BookMarked, Quote, Sparkles } from "lucide-react";
import { useExaminationConsciousness } from "@/lib/system/ExaminationConsciousness";
import { riskToneClasses } from "@/lib/system/SystemConsciousness";
import type { BiographyTrend } from "@/lib/system/ExaminerBiography";

/**
 * Phase 7.x — Adaptive Prüfungsbiographie + Deliberative Prüferstimme.
 *
 * Cross-Surface-Komponente. Liest ausschliesslich aus der Examination-
 * Consciousness-Facade. Verdichtet, ruhig, longitudinal — niemals KPI-Wand,
 * niemals Coaching, niemals Aktivitäts-Feed.
 */
const TREND_LABEL: Record<BiographyTrend, string> = {
  stabilisierend: "stabilisierend",
  verfestigt: "verfestigt",
  uneinheitlich: "uneinheitlich",
  neu: "neu beobachtet",
};

export function ExaminerBiographyCard({
  elapsedRatio = 0,
  className = "",
}: {
  elapsedRatio?: number;
  className?: string;
}) {
  const c = useExaminationConsciousness(elapsedRatio);
  const { profile, chapters, voice } = c.biography;
  const profileTone = riskToneClasses(profile.tone);

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-2xl border border-border/60 bg-card/70 p-4 backdrop-blur ${className}`}
      aria-label="Prüfungsbiographie und prüferische Einschätzung"
    >
      {/* Profil — strategische Prüfungsidentität, keine Typenlabel */}
      <div className={`mb-3 rounded-xl border px-3 py-2 ${profileTone}`}>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] opacity-70">
          <Sparkles className="h-3 w-3" aria-hidden /> Prüferische Lesart
        </div>
        <p className="mt-1 text-sm font-medium">{profile.reading}</p>
        <p className="mt-0.5 text-[11px] opacity-80">
          Achse: {profile.axis} · Konsistenz {(profile.confidence * 100).toFixed(0)}%
        </p>
      </div>

      {/* Biographie — verdichtete Entwicklung über Achsen */}
      <div className="mb-3">
        <div className="mb-1.5 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          <BookMarked className="h-3 w-3" aria-hidden /> Prüfungsbiographie
        </div>
        <ul className="space-y-1.5">
          {chapters.map((chapter, idx) => {
            const tone = riskToneClasses(chapter.tone);
            return (
              <li
                key={`${chapter.axis}-${idx}`}
                className="rounded-lg border border-border/40 bg-background/40 px-3 py-2"
              >
                <p className="text-xs text-foreground">{chapter.narrative}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] ${tone}`}>
                    {TREND_LABEL[chapter.trend]}
                  </span>
                  <span className="opacity-70">· seit {chapter.ageDays}d</span>
                </p>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Deliberative Prüferstimme */}
      <div className="rounded-xl border border-border/40 bg-background/30 px-3 py-2">
        <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          <Quote className="h-3 w-3" aria-hidden /> Prüfersicht
        </div>
        <ul className="space-y-1">
          {voice.statements.map((s, idx) => (
            <li
              key={idx}
              className="text-[12px] leading-snug text-foreground"
              style={{ opacity: 0.6 + s.weight * 0.4 }}
            >
              {s.text}
            </li>
          ))}
        </ul>
        <p className="mt-2 border-t border-border/30 pt-1.5 text-[11px] italic text-muted-foreground">
          {voice.closing}
        </p>
      </div>
    </motion.section>
  );
}
