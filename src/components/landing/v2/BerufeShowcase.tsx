import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, TrendingUp } from "lucide-react";
import { trackConversion } from "@/lib/seo-tracking";

const POPULAR = [
  { slug: "fachinformatiker-systemintegration", title: "Fachinformatiker Systemintegration", area: "IT", trending: true },
  { slug: "kaufmann-bueromanagement", title: "Kaufmann für Büromanagement", area: "Kaufmännisch", trending: true },
  { slug: "industriekaufmann", title: "Industriekaufmann/-frau", area: "Kaufmännisch" },
  { slug: "bilanzbuchhalter", title: "Bilanzbuchhalter (IHK)", area: "Fortbildung", trending: true },
  { slug: "fachinformatiker-anwendungsentwicklung", title: "Fachinformatiker Anwendungsentwicklung", area: "IT" },
  { slug: "kaufmann-im-einzelhandel", title: "Kaufmann im Einzelhandel", area: "Handel" },
  { slug: "aevo", title: "AEVO – Ausbildereignung", area: "Fortbildung", trending: true },
  { slug: "wirtschaftsfachwirt", title: "Wirtschaftsfachwirt (IHK)", area: "Fortbildung" },
];

const AREAS = ["Alle", "IT", "Kaufmännisch", "Handel", "Fortbildung", "Handwerk"];

export function BerufeShowcase() {
  return (
    <section className="relative py-20 sm:py-28">
      <div className="container mx-auto max-w-6xl px-4">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10">
          <div className="max-w-xl">
            <span className="lp-chip">Berufskatalog</span>
            <h2 className="lp-display mt-4 text-3xl sm:text-5xl font-bold leading-tight">
              Finde dein <span className="lp-gradient-text">Prüfungstraining.</span>
            </h2>
            <p className="lp-body mt-3 text-[var(--lp-text-2)]">
              Über 100 Berufe verfügbar — vom IHK-Beruf bis zur Fortbildung.
            </p>
          </div>
          <Link
            to="/berufe"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--lp-aqua)] hover:underline shrink-0"
          >
            Alle Berufe ansehen <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {/* Filter chips */}
        <div className="flex gap-2 overflow-x-auto pb-3 mb-6 -mx-4 px-4 sm:mx-0 sm:px-0">
          {AREAS.map((a, i) => (
            <button
              key={a}
              className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                i === 0
                  ? "bg-[rgba(46,211,183,0.12)] border-[var(--lp-border-emerald)] text-[var(--lp-aqua)]"
                  : "bg-white/[0.03] border-[var(--lp-border)] text-[var(--lp-text-2)] hover:text-[var(--lp-text)]"
              }`}
            >
              {a}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {POPULAR.map((p, i) => (
            <motion.div
              key={p.slug}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.04 }}
            >
              <Link
                to={`/pruefungstraining/${p.slug}`}
                onClick={() =>
                  trackConversion({
                    event: "cta_click",
                    source: "berufe_showcase",
                    label: p.slug,
                  })
                }
                className="lp-tile p-4 sm:p-5 flex flex-col h-full group"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] uppercase tracking-wider text-[var(--lp-text-3)]">
                    {p.area}
                  </span>
                  {p.trending && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-[var(--lp-aqua)]">
                      <TrendingUp className="w-3 h-3" />
                      Trending
                    </span>
                  )}
                </div>
                <div className="lp-display text-sm sm:text-base font-semibold text-[var(--lp-text)] leading-snug mb-3 flex-1">
                  {p.title}
                </div>
                <div className="flex items-center justify-between text-xs text-[var(--lp-text-2)] mt-auto">
                  <div className="flex gap-1">
                    {["Score", "KI", "Mündlich"].map((tg) => (
                      <span
                        key={tg}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] border border-[var(--lp-border)]"
                      >
                        {tg}
                      </span>
                    ))}
                  </div>
                  <ArrowRight className="w-4 h-4 text-[var(--lp-text-3)] group-hover:text-[var(--lp-aqua)] group-hover:translate-x-0.5 transition-all" />
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
