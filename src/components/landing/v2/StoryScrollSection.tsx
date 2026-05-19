import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import {
  ClipboardCheck,
  Target,
  Map,
  Brain,
  PenLine,
  Mic,
  Trophy,
} from "lucide-react";

const STEPS = [
  {
    icon: ClipboardCheck,
    title: "Teste deine Prüfungsreife",
    text: "4 Minuten. 5 Fragen. Sofort weißt du, wo du stehst und was dir noch fehlt.",
  },
  {
    icon: Target,
    title: "ExamFit erkennt deine Schwächen",
    text: "Adaptive Analyse mappt deine Antworten auf Kompetenzen und Prüfungsbereiche.",
  },
  {
    icon: Map,
    title: "Du bekommst deinen Lernpfad",
    text: "Ein priorisierter Plan — keine generische Kursliste, sondern dein nächster Schritt.",
  },
  {
    icon: Brain,
    title: "Der KI-Tutor hilft gezielt",
    text: "Strict-RAG mit Quellen aus Rahmenplan und Kurs. Keine Halluzinationen.",
  },
  {
    icon: PenLine,
    title: "Du trainierst schriftlich",
    text: "Echte Prüfungsfragen mit Zeitlimit, Punkten und ausführlicher Begründung.",
  },
  {
    icon: Mic,
    title: "Du trainierst mündlich",
    text: "Simulierter Prüfer bewertet Fach, Struktur und Praxisbezug in Echtzeit.",
  },
  {
    icon: Trophy,
    title: "Du wirst prüfungsreif",
    text: "Score steigt messbar. Du gehst nicht hoffend in die Prüfung — sondern vorbereitet.",
  },
];

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
            Vom ersten Klick bis zur{" "}
            <span className="lp-gradient-text">bestandenen Prüfung.</span>
          </h2>
          <p className="lp-body mt-4 text-base sm:text-lg text-[var(--lp-text-2)]">
            Sieben Schritte. Ein System. Keine verlorenen Stunden auf YouTube.
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
                  "linear-gradient(180deg, transparent, #59F0D0 30%, #2ED3B7 70%, transparent)",
                boxShadow: "0 0 12px rgba(89,240,208,0.6)",
              }}
            />
          </div>

          <ol className="space-y-12 sm:space-y-16">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const isLeft = i % 2 === 0;
              return (
                <motion.li
                  key={s.title}
                  className={`relative grid sm:grid-cols-2 gap-6 items-center pl-14 sm:pl-0`}
                  initial={{ opacity: 0, y: 28 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-80px" }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                >
                  {/* Node */}
                  <div className="absolute left-5 sm:left-1/2 sm:-translate-x-1/2 top-1 sm:top-1/2 sm:-translate-y-1/2 z-10">
                    <div className="w-10 h-10 -ml-5 sm:-ml-5 rounded-full bg-[var(--lp-elev)] border border-[var(--lp-border-emerald)] flex items-center justify-center shadow-[0_0_24px_-4px_rgba(89,240,208,0.45)]">
                      <Icon className="w-4 h-4 text-[var(--lp-aqua)]" />
                    </div>
                  </div>

                  {/* Card */}
                  <div
                    className={`lp-card p-5 sm:p-6 ${
                      isLeft ? "sm:col-start-1 sm:text-right" : "sm:col-start-2"
                    }`}
                  >
                    <div className="text-[11px] uppercase tracking-wider text-[var(--lp-text-3)] mb-1.5">
                      Schritt {String(i + 1).padStart(2, "0")}
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
