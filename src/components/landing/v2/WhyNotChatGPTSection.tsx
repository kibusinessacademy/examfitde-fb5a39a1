import { motion } from "framer-motion";
import { Check, X, AlertTriangle } from "lucide-react";

/**
 * "Warum nicht ChatGPT?" — Kategorie-Differenzierung
 * 3-Spalten-Vergleichstabelle: ExamFit (glow) · ChatGPT · klassischer Kurs
 */
const ROWS = [
  { feature: "Antworten mit Quellen", ef: "yes", gpt: "no", course: "warn" },
  { feature: "Rahmenplan-Mapping (IHK)", ef: "yes", gpt: "no", course: "warn" },
  { feature: "Prüfungsreife-Score", ef: "yes", gpt: "no", course: "no" },
  { feature: "Mündliche Prüfungssimulation", ef: "yes", gpt: "no", course: "no" },
  { feature: "Adaptive Schwächenanalyse", ef: "yes", gpt: "no", course: "no" },
  { feature: "Prüfungslogik statt allg. KI", ef: "yes", gpt: "no", course: "warn" },
  { feature: "Keine Halluzinationen", ef: "yes", gpt: "no", course: "yes" },
] as const;

function Cell({ v }: { v: "yes" | "no" | "warn" }) {
  if (v === "yes")
    return (
      <span className="inline-flex w-7 h-7 rounded-full bg-[rgba(74,222,128,0.14)] border border-[rgba(74,222,128,0.4)] items-center justify-center">
        <Check className="w-4 h-4 text-[var(--lp-success)]" />
      </span>
    );
  if (v === "no")
    return (
      <span className="inline-flex w-7 h-7 rounded-full bg-[rgba(239,77,107,0.10)] border border-[rgba(239,77,107,0.3)] items-center justify-center">
        <X className="w-4 h-4 text-[var(--lp-danger)]" />
      </span>
    );
  return (
    <span className="inline-flex w-7 h-7 rounded-full bg-[rgba(245,183,84,0.10)] border border-[rgba(245,183,84,0.3)] items-center justify-center">
      <AlertTriangle className="w-3.5 h-3.5 text-[var(--lp-warn)]" />
    </span>
  );
}

export function WhyNotChatGPTSection() {
  return (
    <section className="relative py-20 sm:py-28 overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none opacity-70"
        style={{
          background:
            "radial-gradient(60% 50% at 80% 0%, rgba(167,139,250,0.10), transparent 70%), radial-gradient(50% 40% at 10% 80%, rgba(46,211,183,0.10), transparent 70%)",
        }}
        aria-hidden
      />
      <div className="relative container mx-auto max-w-5xl px-4">
        <div className="text-center mb-12 max-w-2xl mx-auto">
          <span className="lp-chip">System vs. Tool</span>
          <h2 className="lp-display mt-4 text-3xl sm:text-5xl font-bold leading-tight">
            Warum nicht einfach{" "}
            <span className="lp-gradient-text">ChatGPT?</span>
          </h2>
          <p className="lp-display mt-5 text-lg sm:text-2xl font-medium text-[var(--lp-text)] leading-snug">
            ChatGPT weiß viel.{" "}
            <span className="lp-gradient-text">ExamFit weiß, was in deiner Prüfung drankommt.</span>
          </p>
          <p className="lp-body mt-3 text-sm sm:text-base text-[var(--lp-text-2)]">
            Eine allgemeine KI beantwortet Fragen. Ein Prüfungssystem bereitet dich auf eine
            konkrete IHK-Prüfung vor — mit Score, Lernpfad und mündlicher Simulation.
          </p>
        </div>

        <motion.div
          className="lp-card overflow-hidden"
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5 }}
        >
          {/* Header */}
          <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] sm:grid-cols-[1.6fr_1fr_1fr_1fr] text-[11px] sm:text-xs uppercase tracking-wider text-[var(--lp-text-3)] border-b border-[var(--lp-border)]">
            <div className="p-3 sm:p-4" />
            <div className="p-3 sm:p-4 text-center relative">
              <div className="absolute inset-x-2 inset-y-1 rounded-lg bg-[rgba(46,211,183,0.08)] border border-[var(--lp-border-emerald)]" />
              <span className="relative font-semibold text-[var(--lp-aqua)]">ExamFit</span>
            </div>
            <div className="p-3 sm:p-4 text-center">ChatGPT</div>
            <div className="p-3 sm:p-4 text-center">Klass. Kurs</div>
          </div>

          {/* Rows */}
          {ROWS.map((r, i) => (
            <div
              key={r.feature}
              className={`grid grid-cols-[1.4fr_1fr_1fr_1fr] sm:grid-cols-[1.6fr_1fr_1fr_1fr] items-center text-xs sm:text-sm ${
                i < ROWS.length - 1 ? "border-b border-[var(--lp-border)]" : ""
              }`}
            >
              <div className="p-3 sm:p-4 text-[var(--lp-text)]">{r.feature}</div>
              <div className="p-3 sm:p-4 flex justify-center relative">
                <div className="absolute inset-x-2 inset-y-0 bg-[rgba(46,211,183,0.04)] pointer-events-none" />
                <span className="relative">
                  <Cell v={r.ef} />
                </span>
              </div>
              <div className="p-3 sm:p-4 flex justify-center">
                <Cell v={r.gpt} />
              </div>
              <div className="p-3 sm:p-4 flex justify-center">
                <Cell v={r.course} />
              </div>
            </div>
          ))}
        </motion.div>

        <p className="text-center text-xs text-[var(--lp-text-3)] mt-5">
          ChatGPT ist ein Tool. ExamFit ist ein <span className="text-[var(--lp-aqua)]">Prüfungssystem</span>.
        </p>
      </div>
    </section>
  );
}
