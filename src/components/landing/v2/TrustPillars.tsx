import { motion } from "framer-motion";
import { Shield, BookOpen, Brain, Target, Clock, Mic } from "lucide-react";

const ITEMS = [
  { icon: BookOpen, t: "Nach IHK-Rahmenplan", d: "Inhalte 1:1 an Prüfungsbereiche gemappt." },
  { icon: Brain, t: "Strict-RAG KI", d: "Antworten nur aus Kurs & Rahmenplan." },
  { icon: Mic, t: "Schriftlich + Mündlich", d: "Beide Prüfungsteile in einem System." },
  { icon: Target, t: "Adaptive Analyse", d: "Keine Zufallsfragen. Dein nächster Schritt." },
  { icon: Shield, t: "Kein Abo", d: "Einmal zahlen. 12 Monate Zugang." },
  { icon: Clock, t: "Sofort startklar", d: "Nach 4 Minuten kennst du deinen Score." },
];

export function TrustPillars() {
  return (
    <section className="py-16 sm:py-20 relative">
      <div className="container mx-auto max-w-6xl px-4">
        <div className="text-center mb-10 max-w-xl mx-auto">
          <span className="lp-chip">Warum ExamFit</span>
          <h2 className="lp-display mt-4 text-2xl sm:text-4xl font-bold leading-tight">
            Sechs Gründe, warum das hier{" "}
            <span className="lp-gradient-text">anders ist.</span>
          </h2>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {ITEMS.map((it, i) => {
            const Icon = it.icon;
            return (
              <motion.div
                key={it.t}
                className="lp-card p-4 sm:p-5"
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.04 }}
              >
                <div className="w-9 h-9 rounded-lg bg-[rgba(46,211,183,0.12)] border border-[var(--lp-border-emerald)] flex items-center justify-center mb-3">
                  <Icon className="w-4 h-4 text-[var(--lp-aqua)]" />
                </div>
                <div className="lp-display text-sm sm:text-base font-semibold text-[var(--lp-text)] leading-snug">
                  {it.t}
                </div>
                <div className="text-xs text-[var(--lp-text-2)] mt-1 leading-snug">
                  {it.d}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
