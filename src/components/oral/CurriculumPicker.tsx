import { useMemo, useState } from 'react';
import { BookOpen, CheckCircle2, Lock, Search, Sparkles, Star, X, AlertTriangle } from 'lucide-react';
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
} from '@/lib/curriculumDisplay';


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
  const { user } = useAuth();

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
        query,
        category,
        recentIds: query ? [] : recentIds,
      }),
    [index, query, category, recentIds],
  );

  const showQuickRows = !query && category === 'all';
  const readinessMap = readinessBulk.data;
  const isLoggedIn = !!user;


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
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Kein Beruf gefunden. Versuche es mit einem anderen Suchbegriff oder einer anderen
            Kategorie.
          </div>
        ) : (
          <div className="grid gap-2" data-testid="oral-curriculum-grid">
            {filtered.map((item) => (
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

function CurriculumRow({
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
}

