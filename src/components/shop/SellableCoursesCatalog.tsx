import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Search, Sparkles, PlayCircle } from 'lucide-react';
import { formatEur } from '@/lib/timezone';
import { useSellableCourses, cleanCourseTitle, TRACK_LABELS, type SellableCourse } from '@/hooks/useSellableCourses';
import { useTrackGrowthEvent } from '@/hooks/useTrackGrowthEvent';

const ALL = '__ALL__';
const PRICE_BUCKETS: Array<{ key: string; label: string; test: (c: SellableCourse) => boolean }> = [
  { key: ALL, label: 'Alle Preise', test: () => true },
  { key: 'lt25', label: 'unter 25 €', test: (c) => c.min_price_cents < 2500 },
  { key: '25to50', label: '25 – 50 €', test: (c) => c.min_price_cents >= 2500 && c.min_price_cents <= 5000 },
  { key: 'gt50', label: 'über 50 €', test: (c) => c.min_price_cents > 5000 },
];

/**
 * P74a — Kunden-facing Katalog der 190 verkaufbaren Kurse.
 * Filter: Beruf-Typ (chamber+catalog), Prüfungstyp (catalog_type), Track, Preis, Suche.
 * Anti-Drift: keine internen Begriffe (Curriculum, Council, Bronze, Pipeline-State).
 */
export function SellableCoursesCatalog() {
  const navigate = useNavigate();
  const { track } = useTrackGrowthEvent();
  const { data: courses = [], isLoading } = useSellableCourses();

  const [search, setSearch] = useState('');
  const [chamber, setChamber] = useState(ALL);
  const [catalog, setCatalog] = useState(ALL);
  const [trackFilter, setTrackFilter] = useState(ALL);
  const [priceBucket, setPriceBucket] = useState(ALL);

  const { chambers, catalogs, tracks } = useMemo(() => {
    const c = new Set<string>(), k = new Set<string>(), t = new Set<string>();
    for (const x of courses) { c.add(x.chamber_type); k.add(x.catalog_type); t.add(x.track); }
    return {
      chambers: Array.from(c).sort(),
      catalogs: Array.from(k).sort(),
      tracks: Array.from(t).sort(),
    };
  }, [courses]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const bucket = PRICE_BUCKETS.find((b) => b.key === priceBucket) ?? PRICE_BUCKETS[0];
    return courses.filter((c) => {
      if (chamber !== ALL && c.chamber_type !== chamber) return false;
      if (catalog !== ALL && c.catalog_type !== catalog) return false;
      if (trackFilter !== ALL && c.track !== trackFilter) return false;
      if (!bucket.test(c)) return false;
      if (q && !c.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [courses, search, chamber, catalog, trackFilter, priceBucket]);

  const handleStart = (c: SellableCourse, action: 'start' | 'simulate') => {
    track('product_select', {
      curriculumId: c.curriculum_id,
      product_key: action === 'simulate' ? 'catalog_simulate' : 'catalog_start',
    });
    if (c.product_slug) {
      navigate(`/produkt/${c.product_slug}${action === 'simulate' ? '?intent=simulate' : ''}`);
    } else {
      navigate(`/shop?curriculum=${c.curriculum_id}`);
    }
  };

  return (
    <section className="max-w-6xl mx-auto px-4 py-12 md:py-16">
      <div className="text-center mb-8">
        <h2 className="text-2xl md:text-3xl font-display font-bold mb-3">
          Alle Berufe & Prüfungen
        </h2>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          {isLoading ? 'Wird geladen…' : `${courses.length} Kurse sofort verfügbar. Filtere nach Beruf, Prüfungstyp oder Preis.`}
        </p>
      </div>

      {/* Filter Bar */}
      <Card className="mb-6">
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Beruf oder Prüfung suchen…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              aria-label="Kurse durchsuchen"
            />
          </div>
          <Select value={chamber} onValueChange={setChamber}>
            <SelectTrigger aria-label="Kammer-Typ"><SelectValue placeholder="Kammer" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Alle Kammern</SelectItem>
              {chambers.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={catalog} onValueChange={setCatalog}>
            <SelectTrigger aria-label="Prüfungstyp"><SelectValue placeholder="Prüfungstyp" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Alle Prüfungstypen</SelectItem>
              {catalogs.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={trackFilter} onValueChange={setTrackFilter}>
            <SelectTrigger aria-label="Track"><SelectValue placeholder="Umfang" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Alle Umfänge</SelectItem>
              {tracks.map((t) => <SelectItem key={t} value={t}>{TRACK_LABELS[t] ?? t}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
        <CardContent className="pt-0 flex flex-wrap gap-2">
          {PRICE_BUCKETS.map((b) => (
            <Button
              key={b.key}
              size="sm"
              variant={priceBucket === b.key ? 'default' : 'outline'}
              onClick={() => setPriceBucket(b.key)}
            >
              {b.label}
            </Button>
          ))}
          <div className="ml-auto text-sm text-muted-foreground self-center">
            {filtered.length} von {courses.length}
          </div>
        </CardContent>
      </Card>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="animate-pulse h-48 bg-muted/30" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          Keine Kurse für diese Filter — bitte Filter anpassen.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c) => (
            <Card key={c.course_id} className="flex flex-col hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <Badge variant="secondary">{c.chamber_type}</Badge>
                  <span className="text-base font-semibold whitespace-nowrap">
                    {formatEur(c.min_price_cents)}
                  </span>
                </div>
                <CardTitle className="text-base leading-snug line-clamp-2">
                  {cleanCourseTitle(c.title)}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col justify-between gap-4">
                <div className="text-xs text-muted-foreground space-y-1">
                  <div>{c.catalog_type} · {TRACK_LABELS[c.track] ?? c.track}</div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => handleStart(c, 'start')}
                  >
                    <Sparkles className="h-4 w-4 mr-1" />
                    Prüfung starten
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleStart(c, 'simulate')}
                    aria-label={`Prüfung simulieren — ${cleanCourseTitle(c.title)}`}
                  >
                    <PlayCircle className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
