import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import {
  ClipboardCheck,
  AlertOctagon,
  Map,
  Brain,
  PenLine,
  Mic,
  Trophy,
} from "lucide-react";

/**
 * Dramaturgie statt Linearität:
 *   1 Unsicherheit  → 2 Schockmoment  → 3 Kontrolle
 *   4–6 Training & Fortschritt  → 7 Finale (Auflösung)
 *
 * Farbcode pro Phase (icon-bg / accent):
 *   uncertain = neutral aqua
 *   shock     = danger / amber
 *   control   = success / aqua
 *   training  = emerald
 *   finale    = gradient mint→violet
 */
type Phase = "uncertain" | "shock" | "control" | "training" | "finale";

const STEPS: Array<{
  icon: any;
  phase: Phase;
  badge: string;
  title: string;
  text: string;
}> = [
  {
    icon: ClipboardCheck,
    phase: "uncertain",
    badge: "Unsicherheit",
    title: "Wie prüfungsreif bist du wirklich?",
    text: "4 Minuten. 5 Fragen. Du beantwortest sie ehrlich — und merkst sofort, wo du ungenau wirst.",
  },
  {
    icon: AlertOctagon,
    phase: "shock",
    badge: "Schockmoment",
    title: "ExamFit zeigt dir, wo du Punkte verlierst.",
    text: "Heatmap aller Kompetenzen. Rot = kritisch. Amber = wackelig. Du weißt jetzt, was die Prüfung wirklich kostet.",
  },
  {
    icon: Map,
    phase: "control",
    badge: "Kontrolle zurück",
    title: "Du bekommst deinen Lernpfad.",
    text: "Kein generisches Kursmenü — ein priorisierter Plan, der mit deiner schwächsten Kompetenz beginnt.",
  },
  {
    icon: Brain,
    phase: "training",
    badge: "Training",
    title: "Der KI-Tutor schließt deine Lücken.",
    text: "Strict-RAG mit Quellen aus Rahmenplan und Kurs. Jede Antwort zitierbar. Keine Halluzinationen.",
  },
  {
    icon: PenLine,
    phase: "training",
    badge: "Training",
    title: "Du trainierst schriftlich.",
    text: "Echte Prüfungsfragen mit Zeitlimit, Punkten und Begründung — wie in der IHK-Klausur.",
  },
  {
    icon: Mic,
    phase: "training",
    badge: "Training",
    title: "Du trainierst mündlich.",
    text: "Simulierter Prüfer hört zu und bewertet Fach, Struktur und Praxisbezug — wie im Fachgespräch.",
  },
  {
    icon: Trophy,
    phase: "finale",
    badge: "Finale",
    title: "Du gehst vorbereitet rein — nicht hoffend.",
    text: "Score steigt messbar. Bestehenswahrscheinlichkeit grün. Keine bösen Überraschungen am Prüfungstag.",
  },
];

const PHASE_STYLES: Record<Phase, { iconBg: string; iconBorder: string; iconColor: string; badge: string }> = {
  uncertain: {
    iconBg: "rgba(89,240,208,0.10)",
    iconBorder: "rgba(89,240,208,0.30)",
    iconColor: "var(--lp-aqua)",
    badge: "text-[var(--lp-text-2)] bg-white/[0.04] border-[var(--lp-border)]",
  },
  shock: {
    iconBg: "rgba(239,77,107,0.14)",
    iconBorder: "rgba(239,77,107,0.45)",
    iconColor: "var(--lp-danger)",
    badge: "text-[var(--lp-danger)] bg-[rgba(239,77,107,0.10)] border-[rgba(239,77,107,0.30)]",
  },
  control: {
    iconBg: "rgba(74,222,128,0.14)",
    iconBorder: "rgba(74,222,128,0.4)",
    iconColor: "var(--lp-success)",
    badge: "text-[var(--lp-success)] bg-[rgba(74,222,128,0.10)] border-[rgba(74,222,128,0.30)]",
  },
  training: {
    iconBg: "rgba(46,211,183,0.14)",
    iconBorder: "var(--lp-border-emerald)",
    iconColor: "var(--lp-aqua)",
    badge: "text-[var(--lp-aqua)] bg-[rgba(46,211,183,0.10)] border-[var(--lp-border-emerald)]",
  },
  finale: {
    iconBg: "linear-gradient(135deg, rgba(89,240,208,0.25), rgba(167,139,250,0.25))",
    iconBorder: "rgba(167,139,250,0.45)",
    iconColor: "var(--lp-mint)",
    badge: "text-[var(--lp-mint)] bg-[rgba(115,255,184,0.10)] border-[rgba(115,255,184,0.30)]",
  },
};

export function StoryScrollSection() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const lineHeight = useTransform(scrollYProgress, [0.1, 0.85], ["0%", "100%"]);

  return (
    <section className="relative py-20 sm:py-28 overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none opacity-60"
        style={{
          background:
            "radial-gradient(70% 50% at 50% 0%, rgba(46,211,183,0.08), transparent 70%)",
        }}
        aria-hidden
      />

      <div className="relative container mx-auto max-w-5xl px-4">
        <div className="text-center mb-14 sm:mb-20 max-w-2xl mx-auto">
          <span className="lp-chip">Die Prüfungsreise</span>
          <h2 className="lp-display mt-4 text-3xl sm:text-5xl font-bold leading-tight">
            Von Unsicherheit zu{" "}
            <span className="lp-gradient-text">bestandener Prüfung.</span>
          </h2>
          <p className="lp-body mt-4 text-base sm:text-lg text-[var(--lp-text-2)]">
            Sieben Stationen. Ein System. Keine verlorenen Wochen.
          </p>
        </div>

        <div ref={ref} className="relative">
          {/* Center timeline */}
          <div className="absolute left-5 sm:left-1/2 sm:-translate-x-1/2 top-0 bottom-0 w-px bg-white/8">
            <motion.div
              className="absolute top-0 left-0 w-px"
              style={{
                height: lineHeight,
                background:
                  "linear-gradient(180deg, transparent, #59F0D0 20%, #ef4d6b 35%, #4ade80 55%, #2ED3B7 75%, #a78bfa 92%, transparent)",
                boxShadow: "0 0 14px rgba(89,240,208,0.55)",
              }}
            />
          </div>

          <ol className="space-y-12 sm:space-y-16">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const isLeft = i % 2 === 0;
              const ph = PHASE_STYLES[s.phase];
              return (
                <motion.li
                  key={s.title}
                  className="relative grid sm:grid-cols-2 gap-6 items-center pl-14 sm:pl-0"
                  initial={{ opacity: 0, y: 28 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-80px" }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                >
                  {/* Node */}
                  <div className="absolute left-5 sm:left-1/2 sm:-translate-x-1/2 top-1 sm:top-1/2 sm:-translate-y-1/2 z-10">
                    <div
                      className="w-10 h-10 -ml-5 sm:-ml-5 rounded-full flex items-center justify-center"
                      style={{
                        background: ph.iconBg,
                        border: `1px solid ${ph.iconBorder}`,
                        boxShadow: `0 0 24px -4px ${ph.iconBorder}`,
                      }}
                    >
                      <Icon className="w-4 h-4" style={{ color: ph.iconColor }} />
                    </div>
                  </div>

                  {/* Card */}
                  <div
                    className={`lp-card p-5 sm:p-6 ${
                      isLeft ? "sm:col-start-1 sm:text-right" : "sm:col-start-2"
                    }`}
                  >
                    <div className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${ph.badge} mb-2`}>
                      Schritt {String(i + 1).padStart(2, "0")} · {s.badge}
                    </div>
                    <h3 className="lp-display text-xl font-semibold mb-2 text-[var(--lp-text)]">
                      {s.title}
                    </h3>
                    <p className="text-sm text-[var(--lp-text-2)] leading-relaxed">{s.text}</p>
                  </div>
                </motion.li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
