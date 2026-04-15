import { Link } from 'react-router-dom';
import { ArrowRight, GraduationCap, Clock, Award, Search, BookOpen, BadgeCheck, Briefcase, Filter, Bell, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { useFullCatalog, type CatalogEntry } from '@/hooks/useFullCatalog';
import { generateOrganizationSchema, SITE_URL, getBerufUrl } from '@/lib/seo';
import { useState, useMemo, useCallback } from 'react';
import { CourseInquiryDialog } from '@/components/catalog/CourseInquiryDialog';

type CategoryFilter = 'all' | 'published' | 'upcoming';
type KammerFilter = 'all' | 'IHK' | 'HWK' | string;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export default function BerufePage() {
  const { data: catalog, isLoading } = useFullCatalog();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<CategoryFilter>('all');
  const [kammerFilter, setKammerFilter] = useState<KammerFilter>('all');
  const [letterFilter, setLetterFilter] = useState<string | null>(null);

  // Inquiry dialog state
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const [selectedCourses, setSelectedCourses] = useState<{ id: string; title: string }[]>([]);

  const handleRequestCourse = useCallback((entry: CatalogEntry) => {
    setSelectedCourses(prev => {
      if (prev.some(c => c.id === entry.berufId)) return prev;
      return [...prev, { id: entry.berufId, title: entry.title }];
    });
    setInquiryOpen(true);
  }, []);

  const handleRemoveCourse = useCallback((id: string) => {
    setSelectedCourses(prev => prev.filter(c => c.id !== id));
  }, []);

  // Available Kammern
  const kammerOptions = useMemo(() => {
    if (!catalog) return [];
    const set = new Set<string>();
    catalog.forEach(c => { if (c.kammer) set.add(c.kammer); });
    return Array.from(set).sort();
  }, [catalog]);

  const filteredCourses = useMemo(() => {
    if (!catalog) return [];
    let filtered = catalog;

    if (statusFilter === 'published') filtered = filtered.filter(c => c.isPublished);
    if (statusFilter === 'upcoming') filtered = filtered.filter(c => !c.isPublished);

    if (kammerFilter !== 'all') filtered = filtered.filter(c => c.kammer === kammerFilter);

    if (letterFilter) filtered = filtered.filter(c => c.title.toUpperCase().startsWith(letterFilter));

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(c =>
        c.title.toLowerCase().includes(q) ||
        c.titleLong?.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q)
      );
    }

    // Published first, then by title
    return filtered.sort((a, b) => {
      if (a.isPublished && !b.isPublished) return -1;
      if (!a.isPublished && b.isPublished) return 1;
      return a.title.localeCompare(b.title, 'de');
    });
  }, [catalog, searchQuery, statusFilter, kammerFilter, letterFilter]);

  const counts = useMemo(() => {
    if (!catalog) return { all: 0, published: 0, upcoming: 0 };
    return {
      all: catalog.length,
      published: catalog.filter(c => c.isPublished).length,
      upcoming: catalog.filter(c => !c.isPublished).length,
    };
  }, [catalog]);

  const availableLetters = useMemo(() => {
    if (!catalog) return new Set<string>();
    const letters = new Set<string>();
    let base = catalog;
    if (statusFilter === 'published') base = base.filter(c => c.isPublished);
    if (statusFilter === 'upcoming') base = base.filter(c => !c.isPublished);
    if (kammerFilter !== 'all') base = base.filter(c => c.kammer === kammerFilter);
    base.forEach(c => {
      const first = c.title.charAt(0).toUpperCase();
      if (ALPHABET.includes(first)) letters.add(first);
    });
    return letters;
  }, [catalog, statusFilter, kammerFilter]);

  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      generateOrganizationSchema(),
      {
        '@type': 'CollectionPage',
        name: 'Prüfungsvorbereitung – Alle Berufe & Kurse',
        description: 'Vollständiger Kurskatalog: Veröffentlichte Prüfungstrainings und kommende Kurse zum Anfragen.',
        url: `${SITE_URL}/berufe`,
      },
    ],
  };

  const getCategoryIcon = (entry: CatalogEntry) => {
    switch (entry.category) {
      case 'studium': return BookOpen;
      case 'fortbildung': return Briefcase;
      case 'zertifizierung': return BadgeCheck;
      default: return GraduationCap;
    }
  };

  return (
    <>
      <SEOHead
        title="Alle Kurse & Prüfungstrainings – Katalog | ExamFit"
        description={`${counts.published} verfügbare Prüfungstrainings und ${counts.upcoming} kommende Kurse. Finde dein Training oder frage deinen Wunschkurs an.`}
        canonical={`${SITE_URL}/berufe`}
        structuredData={structuredData}
      />

      <div className="min-h-screen">
        {/* Hero */}
        <section className="relative py-12 sm:py-16 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-accent/10 via-transparent to-primary/10" />
          <div className="container relative z-10">
            <Breadcrumbs items={[{ label: 'Kurskatalog' }]} className="mb-6" />

            <div className="max-w-3xl">
              <h1 className="text-responsive-3xl sm:text-responsive-4xl md:text-responsive-5xl font-display font-bold mb-4">
                <span className="text-gradient">Kurskatalog</span>
                <br />
                Alle Prüfungstrainings
              </h1>
              <p className="text-lg text-muted-foreground mb-4">
                {counts.published} veröffentlichte Kurse sofort verfügbar · {counts.upcoming} weitere in Vorbereitung.
                <br />Dein Kurs fehlt? Jetzt anfragen!
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
            {/* Status Tabs */}
            <div className="flex gap-1 py-3 overflow-x-auto scrollbar-none">
              {([
                { key: 'all' as const, label: 'Alle', icon: Filter },
                { key: 'published' as const, label: 'Verfügbar', icon: ShoppingCart },
                { key: 'upcoming' as const, label: 'In Vorbereitung', icon: Bell },
              ]).map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => { setStatusFilter(key); setLetterFilter(null); }}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
                    statusFilter === key
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                  <span className="text-xs opacity-70">({counts[key]})</span>
                </button>
              ))}

              {/* Kammer filter */}
              <div className="ml-4 flex gap-1">
                <button
                  onClick={() => setKammerFilter('all')}
                  className={`px-3 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
                    kammerFilter === 'all' ? 'bg-accent text-accent-foreground' : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                  }`}
                >
                  Alle Kammern
                </button>
                {kammerOptions.map(k => (
                  <button
                    key={k}
                    onClick={() => setKammerFilter(k)}
                    className={`px-3 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
                      kammerFilter === k ? 'bg-accent text-accent-foreground' : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
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
                <Button variant="outline" onClick={() => { setSearchQuery(''); setStatusFilter('all'); setKammerFilter('all'); setLetterFilter(null); }}>
                  Filter zurücksetzen
                </Button>
              </div>
            ) : (
              <>
                <div className="mb-4 text-sm text-muted-foreground">
                  {filteredCourses.length} {filteredCourses.length === 1 ? 'Kurs' : 'Kurse'} gefunden
                </div>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredCourses.map((entry) => {
                    const Icon = getCategoryIcon(entry);
                    if (entry.isPublished) {
                      return (
                        <Link key={entry.berufId} to={getBerufUrl(entry.publishedSlug || entry.slug)}>
                          <Card className="glass-card hover:shadow-glow-sm transition-all duration-300 h-full group border-primary/20 relative overflow-hidden">
                            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary to-accent" />
                            <CardHeader className="pb-3">
                              <div className="flex items-start justify-between gap-2">
                                <Icon className="h-7 w-7 text-primary flex-shrink-0" />
                                <div className="flex flex-wrap gap-1 justify-end">
                                  <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">
                                    ✓ Verfügbar
                                  </Badge>
                                  {entry.kammer && (
                                    <Badge variant="outline" className="text-xs">{entry.kammer}</Badge>
                                  )}
                                </div>
                              </div>
                              <CardTitle className="text-responsive-base group-hover:text-primary transition-colors leading-snug line-clamp-2">
                                {entry.title}
                              </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-0">
                              {entry.description && (
                                <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{entry.description}</p>
                              )}
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                  {entry.ausbildungsdauerMonate && (
                                    <span className="flex items-center gap-1">
                                      <Clock className="h-3.5 w-3.5" />{entry.ausbildungsdauerMonate} Mon.
                                    </span>
                                  )}
                                  {entry.dqrNiveau && <span>DQR {entry.dqrNiveau}</span>}
                                </div>
                                <span className="text-sm text-primary flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                  Zum Kurs <ArrowRight className="ml-1 h-3.5 w-3.5" />
                                </span>
                              </div>
                            </CardContent>
                          </Card>
                        </Link>
                      );
                    }

                    // Unpublished → "Kurs anfragen"
                    return (
                      <Card key={entry.berufId} className="glass-card h-full group border-dashed border-muted-foreground/20">
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between gap-2">
                            <Icon className="h-7 w-7 text-muted-foreground/60 flex-shrink-0" />
                            <div className="flex flex-wrap gap-1 justify-end">
                              <Badge variant="outline" className="text-xs text-muted-foreground">
                                In Vorbereitung
                              </Badge>
                              {entry.kammer && (
                                <Badge variant="outline" className="text-xs">{entry.kammer}</Badge>
                              )}
                            </div>
                          </div>
                          <CardTitle className="text-responsive-base leading-snug line-clamp-2 text-muted-foreground">
                            {entry.title}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              {entry.ausbildungsdauerMonate && (
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3.5 w-3.5" />{entry.ausbildungsdauerMonate} Mon.
                                </span>
                              )}
                              {entry.dqrNiveau && <span>DQR {entry.dqrNiveau}</span>}
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRequestCourse(entry)}
                              className="text-xs gap-1"
                            >
                              <Bell className="h-3 w-3" />
                              Kurs anfragen
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
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
              Wir erweitern ständig unser Angebot. Frage deinen Wunschkurs direkt an – wir priorisieren ihn!
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setSelectedCourses([]);
                setInquiryOpen(true);
              }}
            >
              Kurs vorschlagen
            </Button>
          </div>
        </section>
      </div>

      <CourseInquiryDialog
        open={inquiryOpen}
        onOpenChange={setInquiryOpen}
        selectedCourses={selectedCourses}
        onRemoveCourse={handleRemoveCourse}
      />
    </>
  );
}
