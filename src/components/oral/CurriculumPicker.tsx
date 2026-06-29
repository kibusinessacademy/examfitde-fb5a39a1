import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { BookOpen, CheckCircle2, Lock, RotateCcw, Search, Sparkles, Star, X, AlertTriangle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { useOralCurriculaReadinessBulk } from '@/hooks/useOralStartability';
import {
  buildCurriculumIndex,
  filterCurricula,
  getRecentCurriculumIds,
  type CurriculumCategory,
  type CurriculumDisplay,
  type CurriculumSort,
} from '@/lib/curriculumDisplay';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const VIRTUALIZE_THRESHOLD = 40;
const ROW_ESTIMATE_PX = 60;


const CATEGORY_CHIPS: { key: CurriculumCategory | 'all'; label: string }[] = [
  { key: 'all', label: 'Alle' },
  { key: 'popular', label: '⭐ Beliebt' },
  { key: 'aevo', label: 'AEVO' },
  { key: 'ihk', label: 'IHK' },
  { key: 'hwk', label: 'HWK' },
  { key: 'fachwirt', label: 'Fachwirte' },
  { key: 'meister', label: 'Meister' },
  { key: 'bachelor_professional', label: 'Bachelor Professional' },
  { key: 'fortbildung', label: 'Fortbildungen' },
  { key: 'studium', label: 'Studium' },
];

interface CurriculumPickerProps {
  curricula: Array<{ id: string; title: string }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  label?: string;
}

export function CurriculumPicker({
  curricula,
  selectedId,
  onSelect,
  label = 'Welchen Beruf möchtest du trainieren?',
}: CurriculumPickerProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CurriculumCategory | 'all'>('all');
  const [sort, setSort] = useState<CurriculumSort>('relevance');
  const { user } = useAuth();

  // Debounce query so fast typing doesn't re-sort/filter on every keystroke.
  const debouncedQuery = useDebouncedValue(query, 140);

  const index = useMemo(() => buildCurriculumIndex(curricula), [curricula]);
  const recentIds = useMemo(() => getRecentCurriculumIds(), []);

  const allIds = useMemo(() => index.map((c) => c.id), [index]);
  const readinessBulk = useOralCurriculaReadinessBulk(allIds);

  const recent = useMemo(
    () => recentIds.map((id) => index.find((c) => c.id === id)).filter(Boolean) as CurriculumDisplay[],
    [recentIds, index],
  );

  const popular = useMemo(
    () => index.filter((c) => c.popularity > 0).slice(0, 8),
    [index],
  );

  const filtered = useMemo(
    () =>
      filterCurricula(index, {
        query: debouncedQuery,
        category,
        recentIds: debouncedQuery ? [] : recentIds,
        sort,
      }),
    [index, debouncedQuery, category, recentIds, sort],
  );

  const showQuickRows = !debouncedQuery && category === 'all';
  const readinessMap = readinessBulk.data;
  const isLoggedIn = !!user;
  const filtersActive = query.length > 0 || category !== 'all' || sort !== 'relevance';

  const resetFilters = () => {
    setQuery('');
    setCategory('all');
    setSort('relevance');
  };



  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium mb-2 block flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" /> {label}
        </label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="z. B. Industriekaufmann, FIAE, AEVO, Büromanagement …"
            className="pl-9 pr-9 h-11"
            autoComplete="off"
            data-testid="oral-curriculum-search"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
              aria-label="Suche zurücksetzen"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Kategorien">
        {CATEGORY_CHIPS.map((chip) => (
          <Button
            key={chip.key}
            type="button"
            size="sm"
            variant={category === chip.key ? 'default' : 'outline'}
            onClick={() => setCategory(chip.key)}
            data-testid={`oral-cat-${chip.key}`}
          >
            {chip.label}
          </Button>
        ))}
        </div>
        <div className="flex items-center gap-2">
          <Select value={sort} onValueChange={(v) => setSort(v as CurriculumSort)}>
            <SelectTrigger className="h-8 w-[180px]" data-testid="oral-sort-select" aria-label="Sortierung">
              <SelectValue placeholder="Sortierung" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="relevance">Relevanz (empfohlen)</SelectItem>
              <SelectItem value="popularity">Beliebtheit</SelectItem>
              <SelectItem value="az">Name A–Z</SelectItem>
              <SelectItem value="za">Name Z–A</SelectItem>
            </SelectContent>
          </Select>
          {filtersActive && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={resetFilters}
              data-testid="oral-reset-filters"
              aria-label="Filter zurücksetzen"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Filter zurücksetzen
            </Button>
          )}
        </div>
      </div>


      {showQuickRows && recent.length > 0 && (
        <Section title="Zuletzt genutzt" icon={<Star className="h-4 w-4 text-amber-500" />}>
          <CardRow items={recent} selectedId={selectedId} onSelect={onSelect} readinessMap={readinessMap} isLoggedIn={isLoggedIn} />
        </Section>
      )}

      {showQuickRows && popular.length > 0 && (
        <Section title="Beliebte Prüfungen" icon={<Sparkles className="h-4 w-4 text-primary" />}>
          <CardRow items={popular} selectedId={selectedId} onSelect={onSelect} readinessMap={readinessMap} isLoggedIn={isLoggedIn} />
        </Section>
      )}

      <Section
        title={
          query
            ? `${filtered.length} Treffer für „${query}"`
            : category === 'all'
              ? `Alle Berufe (${filtered.length})`
              : `${filtered.length} Berufe`
        }
      >
        {filtered.length === 0 ? (
          <div
            className="rounded-lg border border-dashed p-6 text-center space-y-3"
            data-testid="oral-curriculum-empty"
            role="status"
            aria-live="polite"
          >
            <div className="mx-auto h-9 w-9 rounded-full bg-muted flex items-center justify-center">
              <Search className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-sm font-medium">Kein Beruf gefunden</div>
            <div className="text-xs text-muted-foreground">
              {query
                ? <>Für „<span className="font-medium">{query}</span>"{category !== 'all' ? ' in dieser Kategorie' : ''} gibt es keine Treffer.</>
                : 'In dieser Kategorie sind keine Curricula verfügbar.'}
            </div>
            {filtersActive && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={resetFilters}
                data-testid="oral-empty-reset"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1" /> Filter zurücksetzen
              </Button>
            )}
          </div>
        ) : (
          <VirtualizedCurriculumList
            items={filtered}
            selectedId={selectedId}
            onSelect={onSelect}
            readinessMap={readinessMap}
            isLoggedIn={isLoggedIn}
          />
        )}
      </Section>
    </div>
  );
}


function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

type ReadinessInfo = { hasBlueprints: boolean; blueprintCount: number } | undefined;

function CardRow({
  items,
  selectedId,
  onSelect,
  readinessMap,
  isLoggedIn,
}: {
  items: CurriculumDisplay[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  readinessMap?: Map<string, { hasBlueprints: boolean; blueprintCount: number }>;
  isLoggedIn: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {items.map((item) => (
        <CurriculumRow
          key={item.id}
          item={item}
          selected={selectedId === item.id}
          onSelect={onSelect}
          readiness={readinessMap?.get(item.id)}
          isLoggedIn={isLoggedIn}
          compact
        />
      ))}
    </div>
  );
}

function StartabilityBadge({ readiness, isLoggedIn }: { readiness: ReadinessInfo; isLoggedIn: boolean }) {
  if (!readiness) {
    return null;
  }
  if (!readiness.hasBlueprints) {
    return (
      <Badge
        variant="outline"
        className="h-5 px-1.5 text-[10px] border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-300"
        title="Für diesen Beruf sind noch keine mündlichen Prüfungsblueprints freigegeben."
      >
        <AlertTriangle className="h-3 w-3 mr-1" /> noch nicht verfügbar
      </Badge>
    );
  }
  if (!isLoggedIn) {
    return (
      <Badge
        variant="outline"
        className="h-5 px-1.5 text-[10px] border-sky-300 text-sky-700 bg-sky-50 dark:bg-sky-950/30 dark:text-sky-300"
        title="Login erforderlich"
      >
        <Lock className="h-3 w-3 mr-1" /> Login
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="h-5 px-1.5 text-[10px] border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-300"
      title={`${readiness.blueprintCount} mündliche Prüfungsfragen verfügbar`}
    >
      <CheckCircle2 className="h-3 w-3 mr-1" /> verfügbar
    </Badge>
  );
}

const CurriculumRow = memo(function CurriculumRow({
  item,
  selected,
  onSelect,
  readiness,
  isLoggedIn,
  compact = false,
}: {
  item: CurriculumDisplay;
  selected: boolean;
  onSelect: (id: string) => void;
  readiness?: { hasBlueprints: boolean; blueprintCount: number };
  isLoggedIn: boolean;
  compact?: boolean;
}) {
  const unavailable = readiness && !readiness.hasBlueprints;
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      aria-pressed={selected}
      data-testid="oral-curriculum-item"
      data-oral-status={
        !readiness ? 'unknown' : !readiness.hasBlueprints ? 'no_blueprints' : isLoggedIn ? 'ready' : 'login_required'
      }
      className={cn(
        'group flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
        'hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        selected
          ? 'border-primary bg-primary/10 ring-1 ring-primary'
          : 'border-border bg-surface',
        compact && 'py-2',
        unavailable && 'opacity-70',
      )}
    >
      <BookOpen
        className={cn('h-4 w-4 mt-0.5 shrink-0', selected ? 'text-primary' : 'text-muted-foreground')}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="truncate text-sm font-medium">{item.display_name}</span>
          {item.popularity >= 900 && (
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">beliebt</Badge>
          )}
          <StartabilityBadge readiness={readiness} isLoggedIn={isLoggedIn} />
        </div>
        {item.subtitle && (
          <div className="truncate text-xs text-muted-foreground">{item.subtitle}</div>
        )}
      </div>
    </button>
  );
});

function VirtualizedCurriculumList({
  items,
  selectedId,
  onSelect,
  readinessMap,
  isLoggedIn,
}: {
  items: CurriculumDisplay[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  readinessMap?: Map<string, { hasBlueprints: boolean; blueprintCount: number }>;
  isLoggedIn: boolean;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Below threshold → render normally (avoids virtualization overhead for short lists).
  if (items.length < VIRTUALIZE_THRESHOLD) {
    return (
      <div className="grid gap-2" data-testid="oral-curriculum-grid">
        {items.map((item) => (
          <CurriculumRow
            key={item.id}
            item={item}
            selected={selectedId === item.id}
            onSelect={onSelect}
            readiness={readinessMap?.get(item.id)}
            isLoggedIn={isLoggedIn}
          />
        ))}
      </div>
    );
  }

  // Cap height so the inner window virtualizes; preserves page-level scroll feel.
  const maxHeight = Math.min(720, items.length * ROW_ESTIMATE_PX);

  return (
    <VirtualList
      parentRef={parentRef}
      maxHeight={maxHeight}
      items={items}
      selectedId={selectedId}
      onSelect={onSelect}
      readinessMap={readinessMap}
      isLoggedIn={isLoggedIn}
    />
  );
}

function VirtualList({
  parentRef,
  maxHeight,
  items,
  selectedId,
  onSelect,
  readinessMap,
  isLoggedIn,
}: {
  parentRef: React.RefObject<HTMLDivElement>;
  maxHeight: number;
  items: CurriculumDisplay[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  readinessMap?: Map<string, { hasBlueprints: boolean; blueprintCount: number }>;
  isLoggedIn: boolean;
}) {
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: 8,
  });

  // Preserve scroll position across filter/sort changes that do NOT actually
  // remove the currently-visible top item. We do this by remembering the topmost
  // visible item id; whenever the list mutates, we re-scroll to that id if it is
  // still present, otherwise we keep scrollTop=0 (avoids the "jump to bottom"
  // virtualizer artefact when row counts shrink).
  const topIdRef = useRef<string | null>(null);
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const handler = () => {
      const vis = virtualizer.getVirtualItems();
      const first = vis[0];
      topIdRef.current = first ? items[first.index]?.id ?? null : null;
    };
    el.addEventListener('scroll', handler, { passive: true });
    return () => el.removeEventListener('scroll', handler);
  }, [parentRef, virtualizer, items]);

  useEffect(() => {
    const id = topIdRef.current;
    if (!id) return;
    const idx = items.findIndex((it) => it.id === id);
    if (idx >= 0) {
      virtualizer.scrollToIndex(idx, { align: 'start' });
    } else if (parentRef.current) {
      parentRef.current.scrollTop = 0;
    }
    // We intentionally only react to identity changes of `items` array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // Keyboard navigation — Arrow/Home/End/PageUp/PageDown + Enter/Space.
  const initialActive = Math.max(
    0,
    selectedId ? items.findIndex((it) => it.id === selectedId) : 0,
  );
  const [activeIndex, setActiveIndex] = useState(initialActive);
  useEffect(() => {
    setActiveIndex((cur) => Math.min(Math.max(0, cur), Math.max(0, items.length - 1)));
  }, [items.length]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (items.length === 0) return;
    let next = activeIndex;
    if (e.key === 'ArrowDown') next = Math.min(items.length - 1, activeIndex + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, activeIndex - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'PageDown') next = Math.min(items.length - 1, activeIndex + 8);
    else if (e.key === 'PageUp') next = Math.max(0, activeIndex - 8);
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const it = items[activeIndex];
      if (it) onSelect(it.id);
      return;
    } else {
      return;
    }
    e.preventDefault();
    setActiveIndex(next);
    virtualizer.scrollToIndex(next, { align: 'auto' });
  };

  return (
    <div
      ref={parentRef}
      data-testid="oral-curriculum-grid"
      className="overflow-auto rounded-md border border-border/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      style={{ height: maxHeight }}
      role="listbox"
      aria-label="Berufe wählen"
      aria-activedescendant={items[activeIndex] ? `oral-cur-row-${items[activeIndex].id}` : undefined}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const item = items[vi.index];
          const isActive = vi.index === activeIndex;
          return (
            <div
              key={item.id}
              id={`oral-cur-row-${item.id}`}
              role="option"
              aria-selected={selectedId === item.id}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              className={isActive ? 'ring-1 ring-primary/40 rounded-md' : undefined}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${vi.start}px)`,
                paddingBottom: 8,
                paddingLeft: 4,
                paddingRight: 4,
              }}
            >
              <CurriculumRow
                item={item}
                selected={selectedId === item.id}
                onSelect={onSelect}
                readiness={readinessMap?.get(item.id)}
                isLoggedIn={isLoggedIn}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Lightweight debounce hook — avoids re-running expensive filter/sort on every
 * keystroke during rapid typing. SSR-safe (no window dependency).
 */
function useDebouncedValue<T>(value: T, delay = 140): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}


