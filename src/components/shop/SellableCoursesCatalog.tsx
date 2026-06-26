import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, Sparkles, PlayCircle, TrendingUp } from 'lucide-react';
import { formatEur } from '@/lib/timezone';
import {
  useSellableCourses,
  cleanCourseTitle,
  TRACK_LABELS,
  CATEGORY_ORDER,
  type SellableCourse,
  type CourseCategory,
} from '@/hooks/useSellableCourses';
import { useTrackGrowthEvent } from '@/hooks/useTrackGrowthEvent';

const ALL = '__ALL__';
const CATEGORY_TAB_ALL = '__ALL_CATEGORIES__';

const PRICE_BUCKETS: Array<{ key: string; label: string; test: (c: SellableCourse) => boolean }> = [
  { key: ALL, label: 'Alle Preise', test: () => true },
  { key: 'lt25', label: 'unter 25 €', test: (c) => c.min_price_cents < 2500 },
  { key: '25to50', label: '25 – 50 €', test: (c) => c.min_price_cents >= 2500 && c.min_price_cents <= 5000 },
  { key: 'gt50', label: 'über 50 €', test: (c) => c.min_price_cents > 5000 },
];

type SortKey = 'demand' | 'price_asc' | 'price_desc' | 'alpha';

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: 'demand', label: 'Meistgefragt' },
  { key: 'price_asc', label: 'Preis: aufsteigend' },
  { key: 'price_desc', label: 'Preis: absteigend' },
  { key: 'alpha', label: 'Alphabetisch (A–Z)' },
];

const ROWS_PER_PAGE = 2; // 2 Reihen à 5 Karten = 10 Kurse pro "Laden mehr"-Schritt
const PAGE_SIZE = ROWS_PER_PAGE * 5;

function sortCourses(courses: SellableCourse[], sort: SortKey): SellableCourse[] {
  const list = [...courses];
  switch (sort) {
    case 'price_asc':
      return list.sort((a, b) => a.min_price_cents - b.min_price_cents);
    case 'price_desc':
      return list.sort((a, b) => b.min_price_cents - a.min_price_cents);
    case 'alpha':
      return list.sort((a, b) => cleanCourseTitle(a.title).localeCompare(cleanCourseTitle(b.title), 'de'));
    case 'demand':
    default:
      return list.sort((a, b) => b.demand_score - a.demand_score);
  }
}

/**
 * P75 — Premium Shop-Katalog der verkaufbaren Kurse.
 * Kategorien: Ausbildung / Weiterbildung / Zertifizierung (certification_catalog.catalog_type).
 * Standardsortierung: Nachfrage (demand_score = certification_catalog.priority_score).
 * Grid: 5 Karten je Reihe auf Desktop ("Shopmodell").
 * Anti-Drift: keine internen Begriffe (Curriculum, Council, Bronze, Pipeline-State).
 */
export function SellableCoursesCatalog() {
  const navigate = useNavigate();
  const { track } = useTrackGrowthEvent();
  const { data: courses = [], isLoading } = useSellableCourses();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>(CATEGORY_TAB_ALL);
  const [chamber, setChamber] = useState(ALL);
  const [trackFilter, setTrackFilter] = useState(ALL);
  const [priceBucket, setPriceBucket] = useState(ALL);
  const [sort, setSort] = useState<SortKey>('demand');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { [CATEGORY_TAB_ALL]: courses.length };
    for (const c of courses) counts[c.category] = (counts[c.category] ?? 0) + 1;
    return counts;
  }, [courses]);

  const { chambers, tracks } = useMemo(() => {
    const c = new Set<string>(), t = new Set<string>();
    for (const x of courses) { c.add(x.chamber_type); t.add(x.track); }
    return { chambers: Array.from(c).sort(), tracks: Array.from(t).sort() };
  }, [courses]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const bucket = PRICE_BUCKETS.find((b) => b.key === priceBucket) ?? PRICE_BUCKETS[0];
    const result = courses.filter((c) => {
      if (category !== CATEGORY_TAB_ALL && c.category !== category) return false;
      if (chamber !== ALL && c.chamber_type !== chamber) return false;
      if (trackFilter !== ALL && c.track !== trackFilter) return false;
      if (!bucket.test(c)) return false;
      if (q && !c.title.toLowerCase().includes(q)) return false;
      return true;
    });
    return sortCourses(result, sort);
  }, [courses, search, category, chamber, trackFilter, priceBucket, sort]);

  const visible = filtered.slice(0, visibleCount);
  const resetPaging = () => setVisibleCount(PAGE_SIZE);

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
    <section className="max-w-7xl mx-auto px-4 py-12 md:py-16">
      <div className="text-center mb-8">
        <h2 className="text-2xl md:text-3xl font-display font-bold mb-3">
          Alle Berufe & Prüfungen
        </h2>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          {isLoading ? 'Wird geladen…' : `${courses.length} Kurse sofort verfügbar — sortiert nach Nachfrage.`}
        </p>
      </div>

      {/* Kategorie-Tabs */}
      <Tabs
        value={category}
        onValueChange={(v) => { setCategory(v); resetPaging(); }}
        className="mb-6"
      >
        <TabsList className="flex w-full flex-wrap justify-center gap-1 h-auto bg-muted/60 p-1">
          <TabsTrigger value={CATEGORY_TAB_ALL} className="data-[state=active]:shadow-sm">
            Alle ({categoryCounts[CATEGORY_TAB_ALL] ?? 0})
          </TabsTrigger>
          {CATEGORY_ORDER.map((cat) => (
            <TabsTrigger key={cat} value={cat} className="data-[state=active]:shadow-sm">
              {cat} ({categoryCounts[cat] ?? 0})
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Filter- & Sortierleiste */}
      <Card className="mb-6 border-border/60 shadow-sm">
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Beruf oder Prüfung suchen…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); resetPaging(); }}
              className="pl-9"
              aria-label="Kurse durchsuchen"
            />
          </div>
          <Select value={chamber} onValueChange={(v) => { setChamber(v); resetPaging(); }}>
            <SelectTrigger aria-label="Kammer-Typ"><SelectValue placeholder="Kammer" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Alle Kammern</SelectItem>
              {chambers.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={trackFilter} onValueChange={(v) => { setTrackFilter(v); resetPaging(); }}>
            <SelectTrigger aria-label="Track"><SelectValue placeholder="Umfang" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Alle Umfänge</SelectItem>
              {tracks.map((t) => <SelectItem key={t} value={t}>{TRACK_LABELS[t] ?? t}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
        <CardContent className="pt-0 flex flex-wrap items-center gap-2">
          {PRICE_BUCKETS.map((b) => (
            <Button
              key={b.key}
              size="sm"
              variant={priceBucket === b.key ? 'default' : 'outline'}
              onClick={() => { setPriceBucket(b.key); resetPaging(); }}
            >
              {b.label}
            </Button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {filtered.length} von {courses.length}
            </span>
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger className="w-[180px]" aria-label="Sortierung">
                <SelectValue placeholder="Sortierung" />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => (
                  <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Grid — 5 Karten je Reihe auf Desktop */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <Card key={i} className="animate-pulse h-56 bg-muted/30" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          Keine Kurse für diese Filter — bitte Filter anpassen.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {visible.map((c, i) => {
              const isTopDemand = sort === 'demand' && filtered.indexOf(c) < 3;
              return (
                <Card
                  key={c.course_id}
                  className="flex flex-col hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 border-border/60"
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <Badge variant="secondary">{c.chamber_type}</Badge>
                      {isTopDemand && (
                        <Badge className="gap-1 bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30">
                          <TrendingUp className="h-3 w-3" /> Gefragt
                        </Badge>
                      )}
                    </div>
                    <CardTitle className="text-base leading-snug line-clamp-2">
                      {cleanCourseTitle(c.title)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col justify-between gap-4">
                    <div className="text-xs text-muted-foreground space-y-1">
                      <div>{c.category} · {TRACK_LABELS[c.track] ?? c.track}</div>
                      <div className="text-base font-semibold text-foreground">
                        {formatEur(c.min_price_cents)}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => handleStart(c, 'start')}
                      >
                        <Sparkles className="h-4 w-4 mr-1" />
                        Starten
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
              );
            })}
          </div>
          {visibleCount < filtered.length && (
            <div className="text-center mt-8">
              <Button variant="outline" onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}>
                Weitere Kurse laden ({filtered.length - visibleCount} verbleibend)
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
