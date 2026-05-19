import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ClipboardCheck, ArrowRight } from "lucide-react";
import { trackConversion } from "@/lib/seo-tracking";

export function FinalCTASection() {
  return (
    <section className="relative py-20 sm:py-28 overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 50%, rgba(89,240,208,0.18), transparent 70%)",
        }}
        aria-hidden
      />
      <div className="relative container mx-auto max-w-3xl px-4 text-center">
        <motion.h2
          className="lp-display text-3xl sm:text-5xl font-bold leading-tight"
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          Du weißt nicht, wo du stehst.{" "}
          <span className="lp-gradient-text">In 4 Minuten schon.</span>
        </motion.h2>
        <p className="lp-body mt-5 text-base sm:text-lg text-[var(--lp-text-2)]">
          Kein Account nötig. Kein Risiko. Kein Verkaufsgespräch.
          <br className="hidden sm:block" />
          Nur ein ehrlicher Blick darauf, wie prüfungsreif du wirklich bist.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link to="/pruefungsreife-check" className="contents">
            <button
              className="lp-cta-primary h-14 px-8 inline-flex items-center justify-center text-base group"
              data-cta-location="final_v2_primary"
              onClick={() =>
                trackConversion({
                  event: "cta_click",
                  source: "final_v2",
                  label: "pruefungsreife_test",
                })
              }
            >
              <ClipboardCheck className="w-5 h-5 mr-2" />
              Kostenlos Prüfungsreife testen
              <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-0.5" />
            </button>
          </Link>
          <Link to="/berufe" className="contents">
            <button className="lp-cta-ghost h-14 px-7 inline-flex items-center justify-center text-base">
              Alle Berufe ansehen
            </button>
          </Link>
        </div>
        <div className="mt-6 text-xs text-[var(--lp-text-3)]">
          ✓ DSGVO-konform · ✓ Keine Anmeldung · ✓ Sofort-Ergebnis
        </div>
      </div>
    </section>
  );
}
