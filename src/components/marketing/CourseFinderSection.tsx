import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Search, GraduationCap, BookOpen, Briefcase, BadgeCheck, ArrowRight, Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { usePublishedCourses, type CourseCategory } from '@/hooks/usePublishedCourses';
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

export function CourseFinderSection() {
  const { data: allCourses, isLoading } = usePublishedCourses();
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<CourseCategory | 'all'>('all');
  const [showAll, setShowAll] = useState(false);

  const isSearching = query.length >= 2;

  const filtered = useMemo(() => {
    if (!allCourses) return [];
    let results = [...allCourses];

    if (activeCategory !== 'all') {
      results = results.filter(c => c.category === activeCategory);
    }

    if (isSearching) {
      const q = query.toLowerCase();
      results = results.filter(c =>
        c.title.toLowerCase().includes(q) ||
        c.slug.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q) ||
        c.kammer?.toLowerCase().includes(q)
      );
    } else {
      // Not searching: show top by popularity
      results.sort((a, b) => b.popularity - a.popularity);
    }

    return results;
  }, [allCourses, query, activeCategory, isSearching]);

  const displayed = showAll ? filtered : filtered.slice(0, 12);
  const hasMore = filtered.length > 12;

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
              placeholder="z. B. Industriekaufmann, Fachinformatiker, Kaufmann für Büromanagement"
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
              onClick={() => { setActiveCategory(value); setShowAll(false); }}
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="glass-card rounded-xl p-4 animate-pulse h-28" />
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
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {displayed.map(course => {
                const Icon = { ausbildung: GraduationCap, studium: BookOpen, fortbildung: Briefcase, zertifizierung: BadgeCheck }[course.category];
                return (
                  <Link
                    key={course.packageId}
                    to={getBerufUrl(course.slug)}
                    className="glass-card rounded-xl p-4 group hover:border-primary/30 transition-all duration-300 flex flex-col"
                    onClick={() => trackConversion({ event: 'course_click', source: 'homepage_finder', label: course.slug })}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`p-1.5 rounded-lg ${categoryColor[course.category]}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      {course.kammer && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {course.kammer}
                        </Badge>
                      )}
                    </div>
                    <h3 className="text-sm font-semibold leading-tight group-hover:text-primary transition-colors flex-1">
                      {course.title}
                    </h3>
                    <span className="text-xs text-primary mt-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      Zum Kurs <ArrowRight className="h-3 w-3" />
                    </span>
                  </Link>
                );
              })}
            </div>

            {hasMore && !showAll && (
              <div className="text-center mt-6">
                <Button
                  variant="outline"
                  onClick={() => setShowAll(true)}
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
            <Link to="/berufe">
              Alle Berufe & Kurse entdecken <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
