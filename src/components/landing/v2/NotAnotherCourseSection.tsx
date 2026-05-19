import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { ArrowRight, Smartphone, Train, Briefcase } from "lucide-react";
import { trackConversion } from "@/lib/seo-tracking";

/**
 * "Kein weiterer Kurs" — psychologischer Pivot vom Kurs zum System.
 * Inkludiert Mobile-Moments Strip ("In der Bahn. Im Betrieb. Zwischen zwei Stunden.")
 */
export function NotAnotherCourseSection() {
  return (
    <section className="relative py-20 sm:py-28 overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(50% 40% at 50% 0%, rgba(89,240,208,0.10), transparent 70%)",
        }}
        aria-hidden
      />

      <div className="relative container mx-auto max-w-4xl px-4 text-center">
        <span className="lp-chip">Strategischer Shift</span>

        <motion.h2
          className="lp-display mt-5 text-[30px] sm:text-5xl lg:text-[56px] font-bold leading-[1.06]"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.6 }}
        >
          Du brauchst keinen{" "}
          <span className="relative inline-block">
            <span className="lp-strike">weiteren Kurs.</span>
          </span>
          <br className="hidden sm:block" />
          Du brauchst ein{" "}
          <span className="lp-gradient-text">System,</span>{" "}
          das erkennt, wo du Punkte verlierst.
        </motion.h2>

        <motion.p
          className="lp-body mt-6 text-base sm:text-lg text-[var(--lp-text-2)] max-w-2xl mx-auto leading-relaxed"
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          Nicht mehr Inhalte. Sondern die richtigen Fragen zur richtigen Zeit —
          adaptiv, mündlich & schriftlich, mit echtem Prüfungsfeedback.
        </motion.p>

        {/* Mobile Moments Strip */}
        <motion.div
          className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-3xl mx-auto"
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          {[
            { Icon: Train, t: "In der Bahn", s: "MiniChecks zwischen zwei Stationen." },
            { Icon: Briefcase, t: "Im Betrieb", s: "Pausenzeit = 1 Kompetenz-Sprint." },
            { Icon: Smartphone, t: "Zwischen zwei Berufsschulstunden", s: "Voice-Tutor direkt im Ohr." },
          ].map(({ Icon, t, s }) => (
            <div
              key={t}
              className="lp-card p-4 sm:p-5 text-left flex gap-3 items-start"
            >
              <div className="w-9 h-9 rounded-lg bg-[rgba(46,211,183,0.12)] border border-[var(--lp-border-emerald)] flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4 text-[var(--lp-aqua)]" />
              </div>
              <div>
                <div className="text-sm font-semibold text-[var(--lp-text)] leading-snug">
                  {t}
                </div>
                <div className="text-xs text-[var(--lp-text-2)] mt-1 leading-snug">{s}</div>
              </div>
            </div>
          ))}
        </motion.div>

        <div className="mt-10 flex justify-center">
          <Link to="/pruefungsreife-check" className="contents">
            <button
              className="lp-cta-primary h-14 px-7 inline-flex items-center justify-center text-base group"
              data-cta-location="not_another_course_primary"
              onClick={() =>
                trackConversion({
                  event: "cta_click",
                  source: "not_another_course",
                  label: "pruefungsreife_test",
                })
              }
            >
              Finde jetzt deine Schwächen
              <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-0.5" />
            </button>
          </Link>
        </div>
      </div>
    </section>
  );
}
