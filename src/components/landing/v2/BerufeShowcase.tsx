import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, TrendingUp, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { trackConversion } from "@/lib/seo-tracking";
import { useHomepageCatalog, type CatalogCourseItem } from "@/hooks/usePublishedCourses";
import { getBerufUrl } from "@/lib/seo";

/**
 * Editorial promo set — used to sort/highlight cards. Slugs are MATCHED against
 * the live homepage catalog (single source of truth). Cards never link to a
 * hardcoded slug — that was the root cause of "Prüfungstraining nicht gefunden"
 * for every popular course.
 */
const PROMO: Array<{ match: RegExp; trending?: boolean; rank: number }> = [
  { match: /^fachinformatiker.*system/i, trending: true, rank: 1 },
  { match: /^kaufmann.*büromanagement/i, trending: true, rank: 2 },
  { match: /^industriekaufmann/i, rank: 3 },
  { match: /^bilanzbuchhalter/i, trending: true, rank: 4 },
  { match: /^fachinformatiker.*anwendung/i, rank: 5 },
  { match: /einzelhandel/i, rank: 6 },
  { match: /^aevo|ausbildereignung/i, trending: true, rank: 7 },
  { match: /wirtschaftsfachwirt/i, rank: 8 },
];

const AREAS = ["Alle", "IT", "Kaufmännisch", "Handel", "Fortbildung", "Handwerk"] as const;
type Area = (typeof AREAS)[number];

const AREA_MATCH: Record<Exclude<Area, "Alle">, RegExp> = {
  IT: /\b(it|fachinformatiker|informat|systemintegration|anwendungs)/i,
  Kaufmännisch: /(kaufmann|kauffrau|büromanage|industriekaufmann)/i,
  Handel: /(handel|verkäufer|einzelhandel|großhandel)/i,
  Fortbildung: /(fortbildung|fachwirt|meister|bilanzbuchhalter|aevo|ausbildereignung)/i,
  Handwerk: /(handwerk|mechaniker|elektroniker|tischler|maurer|zimmer|maler)/i,
};

interface ShowcaseItem {
  slug: string;
  title: string;
  area: string;
  trending: boolean;
  rank: number;
}

function pickShowcase(catalog: CatalogCourseItem[]): ShowcaseItem[] {
  const items: ShowcaseItem[] = [];
  const seen = new Set<string>();

  // 1) Editorial promos first, in the curated order, but only when the slug
  //    actually exists in the catalog. This prevents broken links forever.
  for (const promo of PROMO) {
    const hit = catalog.find(
      (c) => !seen.has(c.slug) && (promo.match.test(c.title) || promo.match.test(c.slug)),
    );
    if (hit) {
      seen.add(hit.slug);
      items.push({
        slug: hit.slug,
        title: hit.berufDisplayName || hit.title,
        area: hit.categoryLabel || hit.category,
        trending: Boolean(promo.trending),
        rank: promo.rank,
      });
    }
  }

  // 2) Backfill with highest-popularity catalog entries until we have 8.
  for (const c of catalog) {
    if (items.length >= 8) break;
    if (seen.has(c.slug)) continue;
    seen.add(c.slug);
    items.push({
      slug: c.slug,
      title: c.berufDisplayName || c.title,
      area: c.categoryLabel || c.category,
      trending: false,
      rank: 100 + items.length,
    });
  }

  return items;
}

function matchesArea(area: string, filter: Area, title: string): boolean {
  if (filter === "Alle") return true;
  if (filter === "Fortbildung" && /fortbildung|weiterbildung/i.test(area)) return true;
  return AREA_MATCH[filter as Exclude<Area, "Alle">]?.test(`${area} ${title}`) ?? false;
}

export function BerufeShowcase() {
  const { data: catalog = [], isLoading } = useHomepageCatalog();
  const [active, setActive] = useState<Area>("Alle");

  const items = useMemo(() => pickShowcase(catalog), [catalog]);
  const visible = useMemo(
    () => items.filter((it) => matchesArea(it.area, active, it.title)),
    [items, active],
  );

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
          {AREAS.map((a) => {
            const isActive = a === active;
            return (
              <button
                key={a}
                type="button"
                onClick={() => setActive(a)}
                aria-pressed={isActive}
                className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  isActive
                    ? "bg-[rgba(46,211,183,0.12)] border-[var(--lp-border-emerald)] text-[var(--lp-aqua)]"
                    : "bg-white/[0.03] border-[var(--lp-border)] text-[var(--lp-text-2)] hover:text-[var(--lp-text)]"
                }`}
              >
                {a}
              </button>
            );
          })}
        </div>

        {isLoading && items.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-[var(--lp-text-3)]">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Berufe werden geladen…
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-12 text-sm text-[var(--lp-text-2)]">
            Keine Berufe für „{active}". {" "}
            <button
              onClick={() => setActive("Alle")}
              className="text-[var(--lp-aqua)] hover:underline"
            >
              Filter zurücksetzen
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {visible.map((p, i) => (
              <motion.div
                key={p.slug}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.04 }}
              >
                <Link
                  to={getBerufUrl(p.slug)}
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
        )}
      </div>
    </section>
  );
}
