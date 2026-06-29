import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, GraduationCap, Clock, Award, Search, BookOpen, BadgeCheck, Briefcase, Filter, Bell, ShoppingCart, Sparkles, TrendingUp, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { useFullCatalog, type CatalogEntry } from '@/hooks/useFullCatalog';
import { generateOrganizationSchema, generateBreadcrumbSchema, SITE_URL, getBerufUrl } from '@/lib/seo';
import { useState, useMemo, useCallback } from 'react';
import { CourseInquiryDialog } from '@/components/catalog/CourseInquiryDialog';
import publishedBerufeFallback from '@/data/publishedBerufeFallback.json';
import { getBerufImage } from '@/lib/berufImage';
import { useBerufImages } from '@/hooks/useBerufImages';
import { BerufImageStatusBadge } from '@/components/berufe/BerufImageStatusBadge';
import { useCatalogCacheSignal } from '@/hooks/useCatalogCacheSignal';


/**
 * Static fallback catalog — bundled at build time so /berufe always renders
 * clickable Beruf-Cards beim ersten Paint, auch bevor React Query auflöst.
 * Pre-Customer Reality QA: ≥ 20 sichtbare Beruf-Links sofort, ohne Netz-Wartezeit.
 */
const FALLBACK_CATALOG: CatalogEntry[] = (publishedBerufeFallback as Array<{
  id: string; title: string; slug: string; kammer: string | null;
}>).map((b) => ({
  berufId: b.id,
  title: b.title,
  titleLong: null,
  slug: b.slug,
  publishedSlug: b.slug,
  kammer: b.kammer,
  zustaendigkeit: null,
  ausbildungsdauerMonate: null,
  dqrNiveau: null,
  isPublished: true,
  packageId: null,
  category: null,
  categoryLabel: null,
  description: null,
  discoveryTeaser: null,
  popularityScore: null,
}));

function DebugBadgeRow({ entry, status }: { entry: CatalogEntry; status: 'sellable' | 'upcoming' }) {
  const usp = entry.description ? 'USP' : 'Fallback';
  return (
    <div className="flex flex-wrap gap-1 text-[10px] font-mono border border-dashed border-amber-500/60 rounded p-1.5 bg-amber-500/5">
      <Badge variant="outline" className="text-[10px]">
        {status === 'sellable' ? 'sellable=true' : 'sellable=false'}
      </Badge>
      <Badge variant="outline" className="text-[10px]">teaser={usp}</Badge>
      {entry.dqrNiveau !== null && (
        <Badge variant="outline" className="text-[10px]">DQR{entry.dqrNiveau}</Badge>
      )}
      {entry.ausbildungsdauerMonate !== null && (
        <Badge variant="outline" className="text-[10px]">{entry.ausbildungsdauerMonate}M</Badge>
      )}
      <Badge variant="outline" className="text-[10px]">{entry.category ?? '—'}</Badge>
      {entry.packageId && (
        <Badge variant="outline" className="text-[10px]" title={entry.packageId}>pkg ✓</Badge>
      )}
    </div>
  );
}

type CategoryFilter = 'all' | 'published' | 'upcoming';
type KammerFilter = 'all' | 'IHK' | 'HWK' | string;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export default function BerufePage() {
  useCatalogCacheSignal(); // auto-invalidate when products/curricula/courses change
  const [searchParams] = useSearchParams();
  const debugMode = searchParams.get('debug') === 'catalog';
  const { data: catalogData, isLoading } = useFullCatalog();
  // SSOT: live-Katalog, sobald verfügbar — sonst statischer Build-Fallback,
  // damit Visitors NIE eine leere /berufe sehen (Reality-QA: ≥ 20 Links).
  const catalog: CatalogEntry[] | undefined =
    catalogData && catalogData.length > 0 ? catalogData : FALLBACK_CATALOG;
  const showSkeleton = isLoading && !catalog;
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

  const publishedSlice = useMemo(
    () => (catalog ?? []).filter(c => c.isPublished).slice(0, 25),
    [catalog],
  );

  // Per-Beruf realistic photos — lazy-generated & cached server-side.
  // Only request for the currently-filtered set to avoid queueing all 335 at once.
  const visibleForImages = useMemo(
    () =>
      filteredCourses
        .filter((c) => c.isPublished)
        .slice(0, 60)
        .map((c) => ({
          slug: c.publishedSlug || c.slug,
          title: c.title,
          kammer: c.kammer ?? null,
        })),
    [filteredCourses],
  );
  const { imageBySlug, statusBySlug, altBySlug } = useBerufImages(visibleForImages);
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      generateOrganizationSchema(),
      generateBreadcrumbSchema([
        { name: 'Start', url: `${SITE_URL}/` },
        { name: 'Kurskatalog', url: `${SITE_URL}/berufe` },
      ]),
      {
        '@type': 'CollectionPage',
        name: 'Prüfungsvorbereitung – Alle Berufe & Kurse',
        description: 'Vollständiger Kurskatalog: Veröffentlichte Prüfungstrainings und kommende Kurse zum Anfragen.',
        url: `${SITE_URL}/berufe`,
      },
      {
        '@type': 'ItemList',
        name: 'Verfügbare Prüfungstrainings',
        numberOfItems: publishedSlice.length,
        itemListElement: publishedSlice.map((c, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          url: `${SITE_URL}${getBerufUrl(c.publishedSlug || c.slug)}`,
          name: c.title,
        })),
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
        {debugMode && (
          <div className="bg-amber-500/10 border-b border-amber-500/40 text-amber-900 dark:text-amber-200 text-xs px-4 py-2 font-mono">
            🔎 DEBUG-Mode aktiv (<code>?debug=catalog</code>) — jede Karte zeigt sellable-Flag, Teaser-Quelle und Roh-Felder. Admin-Report: <Link to="/admin/governance/catalog-diagnostics" className="underline">/admin/governance/catalog-diagnostics</Link>
          </div>
        )}
        {/* Hero — Premium */}
        <section className="relative overflow-hidden border-b border-border/40">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-accent/10" />
          <div
            aria-hidden
            className="absolute -top-32 -right-32 w-[36rem] h-[36rem] rounded-full bg-primary/15 blur-3xl"
          />
          <div
            aria-hidden
            className="absolute -bottom-40 -left-40 w-[32rem] h-[32rem] rounded-full bg-accent/15 blur-3xl"
          />

          <div className="container relative z-10 pt-10 pb-12 sm:pt-14 sm:pb-16">
            <Breadcrumbs items={[{ label: 'Kurskatalog' }]} className="mb-6" />

            <div className="max-w-3xl">
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary mb-5">
                <Sparkles className="h-3.5 w-3.5" />
                ExamFit · Dein Prüfungstraining
              </span>

              <h1 className="font-display font-bold tracking-tight text-4xl sm:text-5xl md:text-6xl leading-[1.05] mb-5">
                Bestehe deine Prüfung.
                <br />
                <span className="text-gradient">Mit Plan, KI und Routine.</span>
              </h1>

              <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed max-w-2xl mb-8">
                Geprüfte Lernpfade für über {counts.all} Ausbildungsberufe — von der ersten Lektion bis zum Prüfungstag. Starte heute und werde Teil der Generation, die ihre Abschlussprüfung souverän meistert.
              </p>

              {/* Stats Strip */}
              <div className="grid grid-cols-3 gap-3 sm:gap-6 mb-8 max-w-2xl">
                <div className="rounded-2xl border border-border/60 bg-card/70 backdrop-blur-sm px-4 py-3 sm:px-5 sm:py-4">
                  <div className="flex items-center gap-2 text-primary mb-1">
                    <ShoppingCart className="h-4 w-4" />
                    <span className="text-xs font-medium uppercase tracking-wider">Verfügbar</span>
                  </div>
                  <div className="text-2xl sm:text-3xl font-display font-bold">{counts.published}</div>
                  <p className="text-xs text-muted-foreground">Kurse sofort startklar</p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-card/70 backdrop-blur-sm px-4 py-3 sm:px-5 sm:py-4">
                  <div className="flex items-center gap-2 text-accent mb-1">
                    <TrendingUp className="h-4 w-4" />
                    <span className="text-xs font-medium uppercase tracking-wider">Pipeline</span>
                  </div>
                  <div className="text-2xl sm:text-3xl font-display font-bold">{counts.upcoming}</div>
                  <p className="text-xs text-muted-foreground">Wöchentlich neu</p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-card/70 backdrop-blur-sm px-4 py-3 sm:px-5 sm:py-4">
                  <div className="flex items-center gap-2 text-primary mb-1">
                    <ShieldCheck className="h-4 w-4" />
                    <span className="text-xs font-medium uppercase tracking-wider">Geprüft</span>
                  </div>
                  <div className="text-2xl sm:text-3xl font-display font-bold">IHK · HWK</div>
                  <p className="text-xs text-muted-foreground">Kammer-konform</p>
                </div>
              </div>

              {/* Search */}
              <div className="relative max-w-2xl">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Finde deinen Beruf — z. B. Tierpfleger, Mechatroniker, Industriekaufmann …"
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setLetterFilter(null); }}
                  className="pl-12 h-14 text-base sm:text-lg bg-background/80 border-border/60 shadow-sm focus-visible:ring-primary/40"
                  aria-label="Beruf oder Kurs suchen"
                />
                <p
                  data-testid="berufe-handoff-microcopy"
                  className="mt-3 text-xs text-muted-foreground"
                >
                  Nach der Auswahl sicherst du dir dein Komplettpaket für 24,90 € — 12 Monate Zugang, einmalig.
                </p>
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
            {showSkeleton ? (
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
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {filteredCourses.map((entry) => {
                    const Icon = getCategoryIcon(entry);
                    const fallbackImg = getBerufImage(entry.title, entry.kammer);
                    const slugKey = entry.publishedSlug || entry.slug;
                    const realImg = imageBySlug.get(slugKey);
                    const img = realImg || fallbackImg;
                    const imgStatus = realImg ? 'ready' : statusBySlug.get(slugKey);
                    const imgAlt = altBySlug.get(slugKey)
                      || `Berufsbild für ${entry.title}${entry.kammer ? ` (${entry.kammer})` : ''} – Auszubildende im Beruf.`;

                    if (entry.isPublished) {
                      const detailUrl =
                        entry.category && entry.category !== 'ausbildung'
                          ? `/paket/${entry.publishedSlug || entry.slug}`
                          : getBerufUrl(entry.publishedSlug || entry.slug);
                      return (
                        <Link
                          key={entry.berufId}
                          to={detailUrl}
                          className="group block"
                        >
                          <Card className="h-full overflow-hidden border border-border/60 bg-card hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                            <div className="relative aspect-[16/10] overflow-hidden bg-muted">
                              <img
                                src={img}
                                alt={imgAlt}
                                loading="lazy"
                                width={768}
                                height={512}
                                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                              />
                              <BerufImageStatusBadge status={imgStatus} className="top-3 right-3" />
                              <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
                              <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
                                <Badge className="bg-primary text-primary-foreground border-0 text-[11px] shadow-sm">
                                  ✓ Verfügbar
                                </Badge>
                                {entry.kammer && (
                                  <Badge variant="secondary" className="text-[11px] bg-background/90 text-foreground border-0 backdrop-blur-sm">
                                    {entry.kammer}
                                  </Badge>
                                )}
                                {entry.categoryLabel && entry.category !== 'ausbildung' && (
                                  <Badge variant="secondary" className="text-[11px] bg-background/90 text-foreground border-0 backdrop-blur-sm">
                                    {entry.categoryLabel}
                                  </Badge>
                                )}
                              </div>
                              <div className="absolute bottom-3 left-3 right-3">
                                <h3 className="text-lg font-display font-semibold text-white leading-snug line-clamp-2 drop-shadow-md">
                                  {entry.title}
                                </h3>
                              </div>
                            </div>
                            <CardContent className="p-4 flex flex-col gap-3">
                              {debugMode && (
                                <DebugBadgeRow entry={entry} status="sellable" />
                              )}
                              {entry.discoveryTeaser && (
                                <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
                                  {entry.discoveryTeaser}
                                </p>
                              )}
                              <div className="flex items-center justify-end">
                                <span className="text-sm text-primary flex items-center font-semibold group-hover:gap-2 gap-1 transition-all">
                                  Jetzt kaufen <ArrowRight className="h-4 w-4" />
                                </span>
                              </div>
                            </CardContent>
                          </Card>
                        </Link>
                      );
                    }

                    // Unpublished → "Kurs anfragen"
                    return (
                      <Card key={entry.berufId} className="h-full overflow-hidden border border-dashed border-border bg-card/60">
                        <div className="relative aspect-[16/10] overflow-hidden bg-muted">
                          <img
                            src={img}
                            alt={imgAlt}
                            loading="lazy"
                            width={768}
                            height={512}
                            className="h-full w-full object-cover opacity-50 grayscale"
                          />
                          <BerufImageStatusBadge status={imgStatus} className="top-3 right-3" />
                          <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/40 to-transparent" />
                          <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
                            <Badge variant="outline" className="text-[11px] bg-background/90 text-muted-foreground backdrop-blur-sm">
                              In Vorbereitung
                            </Badge>
                            {entry.kammer && (
                              <Badge variant="outline" className="text-[11px] bg-background/90 backdrop-blur-sm">{entry.kammer}</Badge>
                            )}
                          </div>
                          <div className="absolute bottom-3 left-3 right-3">
                            <h3 className="text-lg font-display font-semibold text-foreground leading-snug line-clamp-2">
                              {entry.title}
                            </h3>
                          </div>
                        </div>
                        <CardContent className="p-4 flex flex-col gap-3">
                          {debugMode && (
                            <DebugBadgeRow entry={entry} status="upcoming" />
                          )}
                          {entry.discoveryTeaser && (
                            <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
                              {entry.discoveryTeaser}
                            </p>
                          )}
                          <div className="flex items-center justify-end">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRequestCourse(entry)}
                              className="text-xs gap-1"
                            >
                              <Bell className="h-3 w-3" />
                              Benachrichtigen
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
