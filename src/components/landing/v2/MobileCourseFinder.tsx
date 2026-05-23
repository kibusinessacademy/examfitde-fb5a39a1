import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, ArrowRight, TrendingUp, Loader2, X } from "lucide-react";
import { useHomepageCatalog, type CatalogCourseItem } from "@/hooks/usePublishedCourses";
import { getBerufUrl } from "@/lib/seo";
import { trackConversion } from "@/lib/seo-tracking";

/**
 * Mobile Kursfinder v1
 * - Top-of-fold search field (no floating bottom search)
 * - Visible category chips
 * - "Beliebte Prüfungen" first
 * - Compact list cards
 * - Empty state with suggestions
 * - Bottom padding so StickyCTA / bottom-nav never overlap last card
 *
 * SSOT: useHomepageCatalog (v_homepage_course_catalog). No hardcoded slugs.
 * Mobile-only: rendered with `md:hidden` from HomePageV2.
 */

const CATEGORIES = [
  { key: "popular", label: "Beliebt" },
  { key: "ausbildung", label: "Ausbildung" },
  { key: "fortbildung", label: "Fortbildung" },
  { key: "kaufmaennisch", label: "Kaufmännisch" },
  { key: "it", label: "IT" },
  { key: "handel", label: "Handel" },
  { key: "handwerk", label: "Handwerk" },
] as const;

type CategoryKey = (typeof CATEGORIES)[number]["key"];

const CATEGORY_MATCH: Record<Exclude<CategoryKey, "popular">, RegExp> = {
  ausbildung: /ausbildung/i,
  fortbildung: /(fortbildung|weiterbildung|fachwirt|meister|bilanzbuchhalter|aevo)/i,
  kaufmaennisch: /(kaufmann|kauffrau|büromanage|industriekaufmann|bankkaufmann)/i,
  it: /\b(it|fachinformatiker|informat|systemintegration|anwendungs)/i,
  handel: /(handel|verkäufer|einzelhandel|großhandel)/i,
  handwerk: /(handwerk|mechaniker|elektroniker|tischler|maurer|maler|zimmer|bäcker|fleisch)/i,
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss");
}

function matchesCategory(item: CatalogCourseItem, cat: CategoryKey): boolean {
  if (cat === "popular") return true;
  const blob = `${item.categoryLabel} ${item.title} ${item.berufDisplayName ?? ""}`;
  return CATEGORY_MATCH[cat]?.test(blob) ?? false;
}

function matchesQuery(item: CatalogCourseItem, q: string): boolean {
  if (!q) return true;
  const needle = normalize(q.trim());
  if (needle.length < 2) return true;
  const hay = normalize(
    `${item.title} ${item.berufDisplayName ?? ""} ${item.berufKurz ?? ""} ${item.searchText}`,
  );
  return hay.includes(needle);
}

export function MobileCourseFinder() {
  const { data: catalog = [], isLoading } = useHomepageCatalog();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<CategoryKey>("popular");

  const sorted = useMemo(
    () => [...catalog].sort((a, b) => b.popularityScore - a.popularityScore),
    [catalog],
  );

  const popular = useMemo(() => sorted.slice(0, 6), [sorted]);

  const filtered = useMemo(() => {
    const base = cat === "popular" ? sorted : sorted.filter((i) => matchesCategory(i, cat));
    return base.filter((i) => matchesQuery(i, q)).slice(0, 12);
  }, [sorted, cat, q]);

  const isSearching = q.trim().length >= 2;
  const showEmpty = !isLoading && filtered.length === 0;

  return (
    <section
      id="kursfinder"
      className="md:hidden relative px-4 pt-6 pb-32"
      aria-label="Kursfinder"
    >
      <div className="mb-3">
        <h2 className="lp-display text-2xl font-bold leading-tight">
          Finde dein <span className="lp-gradient-text">Prüfungstraining</span>
        </h2>
        <p className="lp-body mt-1 text-sm text-[var(--lp-text-2)]">
          Beruf suchen oder Kategorie wählen.
        </p>
      </div>

      {/* Search field — top, not floating bottom */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--lp-text-3)]" />
        <input
          type="search"
          inputMode="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="z. B. Industriekaufmann, IT, AEVO"
          aria-label="Beruf suchen"
          className="w-full h-12 rounded-xl pl-10 pr-10 bg-white/[0.04] border border-[var(--lp-border)] text-[var(--lp-text)] placeholder:text-[var(--lp-text-3)] focus:outline-none focus:border-[var(--lp-aqua)] transition-colors"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="Suche leeren"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-[var(--lp-text-3)] hover:text-[var(--lp-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Visible category chips */}
      <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-2 mb-4 scrollbar-none">
        {CATEGORIES.map((c) => {
          const isActive = c.key === cat;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setCat(c.key)}
              aria-pressed={isActive}
              className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                isActive
                  ? "bg-[rgba(46,211,183,0.12)] border-[var(--lp-border-emerald)] text-[var(--lp-aqua)]"
                  : "bg-white/[0.03] border-[var(--lp-border)] text-[var(--lp-text-2)]"
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {/* Section header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] uppercase tracking-wider text-[var(--lp-text-3)]">
          {isSearching
            ? `Treffer für „${q.trim()}"`
            : cat === "popular"
              ? "Beliebte Prüfungen"
              : `Kategorie: ${CATEGORIES.find((c) => c.key === cat)?.label}`}
        </span>
        {!isSearching && cat === "popular" && (
          <TrendingUp className="w-3.5 h-3.5 text-[var(--lp-aqua)]" />
        )}
      </div>

      {isLoading && filtered.length === 0 ? (
        <div className="flex items-center justify-center py-10 text-sm text-[var(--lp-text-3)]">
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
          Berufe werden geladen…
        </div>
      ) : showEmpty ? (
        <EmptyState
          query={q}
          suggestions={popular}
          onPick={(slug) => {
            trackConversion({
              event: "cta_click",
              source: "mobile_kursfinder_empty_suggestion",
              label: slug,
            });
          }}
          onReset={() => {
            setQ("");
            setCat("popular");
          }}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((item) => (
            <li key={item.packageId}>
              <Link
                to={getBerufUrl(item.slug)}
                onClick={() =>
                  trackConversion({
                    event: "cta_click",
                    source: "mobile_kursfinder",
                    label: item.slug,
                  })
                }
                className="lp-tile flex items-center gap-3 px-3 py-3 rounded-xl group"
              >
                <div className="flex-1 min-w-0">
                  <div className="lp-display text-sm font-semibold text-[var(--lp-text)] leading-snug truncate">
                    {item.berufDisplayName || item.title}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[var(--lp-text-3)]">
                    <span className="truncate">{item.categoryLabel}</span>
                    {item.kammer && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="truncate">{item.kammer}</span>
                      </>
                    )}
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 shrink-0 text-[var(--lp-text-3)] group-hover:text-[var(--lp-aqua)] transition-colors" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EmptyState({
  query,
  suggestions,
  onPick,
  onReset,
}: {
  query: string;
  suggestions: CatalogCourseItem[];
  onPick: (slug: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--lp-border)] bg-white/[0.03] p-4">
      <p className="text-sm text-[var(--lp-text)]">
        {query.trim()
          ? <>Keine Treffer für „<span className="font-semibold">{query.trim()}</span>".</>
          : <>Keine Berufe in dieser Kategorie.</>}
      </p>
      <p className="text-xs text-[var(--lp-text-3)] mt-1">
        Probiere einen Teilbegriff oder wähle einen Vorschlag:
      </p>
      <div className="flex flex-wrap gap-2 mt-3">
        {suggestions.map((s) => (
          <Link
            key={s.packageId}
            to={getBerufUrl(s.slug)}
            onClick={() => onPick(s.slug)}
            className="text-xs px-3 py-1.5 rounded-full bg-[rgba(46,211,183,0.08)] border border-[var(--lp-border-emerald)] text-[var(--lp-aqua)]"
          >
            {s.berufDisplayName || s.title}
          </Link>
        ))}
      </div>
      <button
        type="button"
        onClick={onReset}
        className="mt-3 text-xs text-[var(--lp-text-2)] underline"
      >
        Filter zurücksetzen
      </button>
    </div>
  );
}
