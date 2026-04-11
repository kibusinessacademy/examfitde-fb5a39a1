import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Search, GraduationCap, BookOpen, Briefcase, BadgeCheck, ArrowRight, Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useHomepageCatalog, type CourseCategory, type CatalogCourseItem } from '@/hooks/usePublishedCourses';
import { getBerufUrl } from '@/lib/seo';
import { trackConversion } from '@/lib/seo-tracking';

const CATEGORY_FILTERS: { value: CourseCategory | 'all'; label: string; icon: typeof GraduationCap }[] = [
  { value: 'all', label: 'Alle', icon: Filter },
  { value: 'ausbildung', label: 'Ausbildung', icon: GraduationCap },
  { value: 'studium', label: 'Studium', icon: BookOpen },
  { value: 'fortbildung', label: 'Fortbildung', icon: Briefcase },
  { value: 'zertifizierung', label: 'Zertifizierung', icon: BadgeCheck },
];

const categoryColor: Record<CourseCategory, string> = {
  ausbildung: 'bg-primary/10 text-primary',
  studium: 'bg-blue-500/10 text-blue-500',
  fortbildung: 'bg-accent/10 text-accent',
  zertifizierung: 'bg-emerald-500/10 text-emerald-500',
};

const categoryIcon: Record<CourseCategory, typeof GraduationCap> = {
  ausbildung: GraduationCap,
  studium: BookOpen,
  fortbildung: Briefcase,
  zertifizierung: BadgeCheck,
};

const MAX_BADGES = 3;

/** Compute search relevance score (higher = better match) */
function searchRelevance(course: CatalogCourseItem, q: string): number {
  const titleLower = course.title.toLowerCase();
  const berufLower = (course.berufKurz || '').toLowerCase();

  // Tier 1: Title starts with query
  if (titleLower.startsWith(q)) return 400;
  // Tier 2: Beruf name starts with query
  if (berufLower.startsWith(q)) return 300;
  // Tier 3: Title contains query
  if (titleLower.includes(q)) return 200;
  // Tier 4: Beruf name contains query
  if (berufLower.includes(q)) return 150;
  // Tier 5: search_text match (synonyms, long names, etc.)
  if (course.searchText.includes(q)) return 100;

  return 0;
}

export function CourseFinderSection() {
  const { data: allCourses, isLoading } = useHomepageCatalog();
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<CourseCategory | 'all'>('all');
  const [showAll, setShowAll] = useState(false);
  const lastTrackedNoResults = useRef('');

  const isSearching = query.length >= 2;

  const filtered = useMemo(() => {
    if (!allCourses) return [];
    let results = [...allCourses];

    if (activeCategory !== 'all') {
      results = results.filter(c => c.category === activeCategory);
    }

    if (isSearching) {
      const q = query.toLowerCase();
      // Score each result for relevance, filter out non-matches
      results = results
        .map(c => ({ course: c, relevance: searchRelevance(c, q) }))
        .filter(r => r.relevance > 0)
        .sort((a, b) => {
          // Primary: relevance tier
          if (a.relevance !== b.relevance) return b.relevance - a.relevance;
          // Secondary: editorial priority
          const aPrio = a.course.editorialPriority ?? 999;
          const bPrio = b.course.editorialPriority ?? 999;
          if (aPrio !== bPrio) return aPrio - bPrio;
          // Tertiary: popularity
          return b.course.popularityScore - a.course.popularityScore;
        })
        .map(r => r.course);
    } else {
      // Not searching: editorial priority → popularity → published_at DESC
      results.sort((a, b) => {
        const aPrio = a.editorialPriority ?? 999;
        const bPrio = b.editorialPriority ?? 999;
        if (aPrio !== bPrio) return aPrio - bPrio;
        if (a.popularityScore !== b.popularityScore) return b.popularityScore - a.popularityScore;
        return 0; // DB already ordered by published_at
      });
    }

    return results;
  }, [allCourses, query, activeCategory, isSearching]);

  // Track no-results via useEffect, not in render
  useEffect(() => {
    if (isSearching && filtered.length === 0 && query !== lastTrackedNoResults.current) {
      lastTrackedNoResults.current = query;
      trackConversion({ event: 'finder_no_results', source: 'homepage_finder', label: query });
    }
  }, [isSearching, filtered.length, query]);

  const displayed = showAll ? filtered : filtered.slice(0, 12);
  const hasMore = filtered.length > 12;

  const handleCategoryChange = useCallback((value: CourseCategory | 'all') => {
    setActiveCategory(value);
    setShowAll(false);
    trackConversion({ event: 'finder_filter_select', source: 'homepage_finder', label: value });
  }, []);

  return (
    <section className="py-12 sm:py-16 md:py-20 px-3 sm:px-4" id="kursfinder">
      <div className="container mx-auto max-w-6xl">
        <div className="text-center mb-8 md:mb-10">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold mb-3">
            Welchen Beruf bereitest du <span className="text-gradient">vor?</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Wähle deinen Beruf, filtere passende Kurse und starte direkt mit deinem Prüfungstraining.
          </p>
        </div>

        {/* Search */}
        <div className="max-w-2xl mx-auto mb-6">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="z. B. Industriekaufmann, Fachinformatiker, Bürokaufmann, FISI …"
              value={query}
              onChange={e => {
                setQuery(e.target.value);
                setShowAll(false);
                if (e.target.value.length === 2) {
                  trackConversion({ event: 'course_search', source: 'homepage_finder', label: e.target.value });
                }
              }}
              className="pl-12 h-14 text-base rounded-2xl border-2 border-border focus-visible:border-primary/50 bg-card"
            />
          </div>
        </div>

        {/* Category chips */}
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          {CATEGORY_FILTERS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => handleCategoryChange(value)}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                activeCategory === value
                  ? 'bg-primary text-primary-foreground shadow-md'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Results */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="glass-card rounded-xl p-5 animate-pulse h-40" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">
              {isSearching
                ? `Kein Kurs gefunden für „${query}". Versuche eine andere Suche.`
                : 'Keine Kurse in dieser Kategorie verfügbar.'}
            </p>
            <Button variant="outline" asChild className="rounded-xl">
              <Link to="/berufe">Alle Kurse & Berufe ansehen</Link>
            </Button>
          </div>
        ) : (
          <>
            {isSearching && (
              <p className="text-sm text-muted-foreground mb-4 text-center">
                {filtered.length} {filtered.length === 1 ? 'Kurs' : 'Kurse'} gefunden
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {displayed.map(course => (
                <CourseCard key={course.packageId} course={course} />
              ))}
            </div>

            {hasMore && !showAll && (
              <div className="text-center mt-6">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowAll(true);
                    trackConversion({ event: 'finder_show_all', source: 'homepage_finder', label: String(filtered.length) });
                  }}
                  className="rounded-xl"
                >
                  Alle {filtered.length} Kurse anzeigen
                </Button>
              </div>
            )}
          </>
        )}

        <div className="text-center mt-8">
          <Button variant="outline" size="lg" asChild className="rounded-xl">
            <Link to="/berufe" onClick={() => trackConversion({ event: 'catalog_view', source: 'homepage_finder' })}>
              Alle Berufe & Kurse entdecken <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Rich course card with badges, discovery teaser, and clear CTA */
function CourseCard({ course }: { course: CatalogCourseItem }) {
  const Icon = categoryIcon[course.category];
  // Prefer discovery_teaser over raw taetigkeitsprofil
  const cardText = course.discoveryTeaser || course.description;
  const shortDesc = cardText
    ? cardText.length > 130
      ? cardText.substring(0, 127) + '…'
      : cardText
    : null;

  return (
    <Link
      to={getBerufUrl(course.slug)}
      className="glass-card rounded-xl p-5 group hover:border-primary/30 transition-all duration-300 flex flex-col"
      onClick={() => trackConversion({ event: 'course_card_click', source: 'homepage_finder', label: course.slug })}
    >
      {/* Header: category + kammer */}
      <div className="flex items-center gap-2 mb-3">
        <div className={`p-1.5 rounded-lg ${categoryColor[course.category]}`}>
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-xs font-medium text-muted-foreground">{course.categoryLabel}</span>
        {course.kammer && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-auto">
            {course.kammer}
          </Badge>
        )}
      </div>

      {/* Title */}
      <h3 className="text-base font-semibold leading-tight group-hover:text-primary transition-colors mb-2">
        {course.title}
      </h3>

      {/* Discovery teaser */}
      {shortDesc && (
        <p className="text-xs text-muted-foreground leading-relaxed mb-3 flex-1">
          {shortDesc}
        </p>
      )}

      {/* Badges */}
      {course.badges.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {course.badges.slice(0, MAX_BADGES).map(badge => (
            <span key={badge} className="text-[10px] px-2 py-0.5 rounded-full bg-muted/50 text-muted-foreground font-medium">
              {badge}
            </span>
          ))}
        </div>
      )}

      {/* CTA */}
      <span className="text-sm text-primary font-medium flex items-center gap-1 mt-auto group-hover:gap-2 transition-all">
        Kurs ansehen <ArrowRight className="h-3.5 w-3.5" />
      </span>
    </Link>
  );
}
