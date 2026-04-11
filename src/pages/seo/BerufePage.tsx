import { Link } from 'react-router-dom';
import { ArrowRight, GraduationCap, Clock, Award, Search, BookOpen, BadgeCheck, Briefcase, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { usePublishedCourses, type CourseCategory } from '@/hooks/usePublishedCourses';
import { generateOrganizationSchema, SITE_URL, getBerufUrl } from '@/lib/seo';
import { useState, useMemo } from 'react';

const CATEGORY_CONFIG: { key: CourseCategory | 'all'; label: string; icon: typeof GraduationCap }[] = [
  { key: 'all', label: 'Alle', icon: Filter },
  { key: 'ausbildung', label: 'Ausbildung', icon: GraduationCap },
  { key: 'studium', label: 'Studium', icon: BookOpen },
  { key: 'fortbildung', label: 'Fortbildung', icon: Briefcase },
  { key: 'zertifizierung', label: 'Zertifizierung', icon: BadgeCheck },
];

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export default function BerufePage() {
  const { data: courses, isLoading } = usePublishedCourses();
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CourseCategory | 'all'>('all');
  const [letterFilter, setLetterFilter] = useState<string | null>(null);

  const filteredCourses = useMemo(() => {
    if (!courses) return [];
    let filtered = courses;

    if (categoryFilter !== 'all') {
      filtered = filtered.filter(c => c.category === categoryFilter);
    }

    if (letterFilter) {
      filtered = filtered.filter(c => c.title.toUpperCase().startsWith(letterFilter));
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(c =>
        c.title.toLowerCase().includes(query) ||
        c.description?.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [courses, searchQuery, categoryFilter, letterFilter]);

  // Count per category
  const categoryCounts = useMemo(() => {
    if (!courses) return {} as Record<string, number>;
    const counts: Record<string, number> = { all: courses.length };
    courses.forEach(c => { counts[c.category] = (counts[c.category] || 0) + 1; });
    return counts;
  }, [courses]);

  // Available letters
  const availableLetters = useMemo(() => {
    if (!courses) return new Set<string>();
    const letters = new Set<string>();
    const filtered = categoryFilter !== 'all'
      ? courses.filter(c => c.category === categoryFilter)
      : courses;
    filtered.forEach(c => {
      const first = c.title.charAt(0).toUpperCase();
      if (ALPHABET.includes(first)) letters.add(first);
    });
    return letters;
  }, [courses, categoryFilter]);

  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      generateOrganizationSchema(),
      {
        '@type': 'CollectionPage',
        name: 'Prüfungsvorbereitung – Alle Berufe, Studiengänge & Zertifizierungen',
        description: 'Finde dein Prüfungstraining: Ausbildungsberufe, Studiengänge, Fortbildungen und Zertifizierungen.',
        url: `${SITE_URL}/berufe`,
      },
    ],
  };

  const getCategoryIcon = (category: CourseCategory) => {
    switch (category) {
      case 'ausbildung': return GraduationCap;
      case 'studium': return BookOpen;
      case 'fortbildung': return Briefcase;
      case 'zertifizierung': return BadgeCheck;
    }
  };

  const getCategoryColor = (category: CourseCategory) => {
    switch (category) {
      case 'ausbildung': return 'default';
      case 'studium': return 'secondary';
      case 'fortbildung': return 'outline';
      case 'zertifizierung': return 'outline';
    }
  };

  return (
    <>
      <SEOHead
        title="Prüfungsvorbereitung – Ausbildung, Studium, Fortbildung & Zertifizierung | ExamFit"
        description="Finde dein Prüfungstraining: Ausbildungsberufe (IHK/HWK), Studiengänge, Fortbildungen und Zertifizierungen. Alle verfügbaren Kurse auf einen Blick."
        canonical={`${SITE_URL}/berufe`}
        structuredData={structuredData}
      />

      <div className="min-h-screen">
        {/* Hero */}
        <section className="relative py-12 sm:py-16 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-accent/10 via-transparent to-primary/10" />
          <div className="container relative z-10">
            <Breadcrumbs items={[{ label: 'Alle Kurse & Bildungswege' }]} className="mb-6" />

            <div className="max-w-3xl">
              <h1 className="text-3xl sm:text-4xl md:text-5xl font-display font-bold mb-4">
                <span className="text-gradient">Prüfungsvorbereitung</span>
                <br />
                für jeden Bildungsweg
              </h1>
              <p className="text-lg text-muted-foreground mb-8">
                Ausbildung, Studium, Fortbildung oder Zertifizierung – finde dein Prüfungstraining und starte sofort.
              </p>

              {/* Search */}
              <div className="relative max-w-xl">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Beruf oder Kurs suchen..."
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setLetterFilter(null); }}
                  className="pl-10 h-12 text-lg bg-background/50"
                  aria-label="Beruf oder Kurs suchen"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Filter Bar */}
        <section className="sticky top-16 z-20 border-b bg-background/95 backdrop-blur-sm">
          <div className="container">
            {/* Category Tabs */}
            <div className="flex gap-1 py-3 overflow-x-auto scrollbar-none">
              {CATEGORY_CONFIG.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => { setCategoryFilter(key); setLetterFilter(null); }}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
                    categoryFilter === key
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                  <span className="text-xs opacity-70">({categoryCounts[key] || 0})</span>
                </button>
              ))}
            </div>

            {/* A-Z Bar */}
            <div className="flex gap-0.5 py-2 overflow-x-auto scrollbar-none">
              <button
                onClick={() => setLetterFilter(null)}
                className={`px-2 py-1 text-xs rounded font-medium transition-colors ${
                  !letterFilter ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Alle
              </button>
              {ALPHABET.map(letter => {
                const available = availableLetters.has(letter);
                return (
                  <button
                    key={letter}
                    onClick={() => available && setLetterFilter(letter === letterFilter ? null : letter)}
                    disabled={!available}
                    className={`px-2 py-1 text-xs rounded font-medium transition-colors ${
                      letter === letterFilter
                        ? 'bg-primary text-primary-foreground'
                        : available
                          ? 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                          : 'text-muted-foreground/30 cursor-not-allowed'
                    }`}
                  >
                    {letter}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Results */}
        <section className="py-8 sm:py-12">
          <div className="container">
            {isLoading ? (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(9)].map((_, i) => (
                  <Card key={i} className="glass-card animate-pulse">
                    <CardHeader>
                      <div className="h-6 bg-muted rounded w-3/4" />
                      <div className="h-4 bg-muted rounded w-full mt-2" />
                    </CardHeader>
                  </Card>
                ))}
              </div>
            ) : filteredCourses.length === 0 ? (
              <div className="text-center py-16">
                <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">Kein Ergebnis gefunden</h3>
                <p className="text-muted-foreground mb-4">
                  Versuche einen anderen Suchbegriff oder Filter.
                </p>
                <Button variant="outline" onClick={() => { setSearchQuery(''); setCategoryFilter('all'); setLetterFilter(null); }}>
                  Filter zurücksetzen
                </Button>
              </div>
            ) : (
              <>
                <div className="mb-4 text-sm text-muted-foreground">
                  {filteredCourses.length} {filteredCourses.length === 1 ? 'Kurs' : 'Kurse'} gefunden
                </div>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredCourses.map((course) => {
                    const Icon = getCategoryIcon(course.category);
                    return (
                      <Link key={course.packageId} to={getBerufUrl(course.slug)}>
                        <Card className="glass-card hover:shadow-glow-sm transition-all duration-300 h-full group">
                          <CardHeader className="pb-3">
                            <div className="flex items-start justify-between gap-2">
                              <Icon className="h-7 w-7 text-primary flex-shrink-0" />
                              <div className="flex flex-wrap gap-1 justify-end">
                                <Badge variant={getCategoryColor(course.category)} className="text-xs">
                                  {course.categoryLabel}
                                </Badge>
                                {course.kammer && (
                                  <Badge variant="outline" className="text-xs">
                                    {course.kammer}
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <CardTitle className="text-responsive-base group-hover:text-primary transition-colors leading-snug line-clamp-2">
                              {course.title}
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="pt-0">
                            {course.description && (
                              <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                                {course.description}
                              </p>
                            )}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                {course.duration && (
                                  <span className="flex items-center gap-1">
                                    <Clock className="h-3.5 w-3.5" />
                                    {course.duration} Mon.
                                  </span>
                                )}
                                {course.dqrLevel && (
                                  <span>DQR {course.dqrLevel}</span>
                                )}
                              </div>
                              <span className="text-sm text-primary flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                Details <ArrowRight className="ml-1 h-3.5 w-3.5" />
                              </span>
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </section>

        {/* CTA */}
        <section className="py-12 sm:py-16 bg-muted/30">
          <div className="container text-center">
            <Award className="h-12 w-12 text-primary mx-auto mb-4" />
            <h2 className="text-2xl md:text-3xl font-display font-bold mb-4">
              Dein Bildungsweg ist nicht dabei?
            </h2>
            <p className="text-muted-foreground mb-6 max-w-lg mx-auto">
              Wir erweitern ständig unser Angebot. Kontaktiere uns und wir priorisieren deinen Kurs.
            </p>
            <Button variant="outline" asChild>
              <a href="mailto:kontakt@examfit.de">Kurs vorschlagen</a>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
