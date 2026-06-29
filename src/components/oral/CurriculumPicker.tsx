import { useMemo, useState } from 'react';
import { BookOpen, Search, Sparkles, Star, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
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

  const index = useMemo(() => buildCurriculumIndex(curricula), [curricula]);
  const recentIds = useMemo(() => getRecentCurriculumIds(), []);

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
          <CardRow items={recent} selectedId={selectedId} onSelect={onSelect} />
        </Section>
      )}

      {showQuickRows && popular.length > 0 && (
        <Section title="Beliebte Prüfungen" icon={<Sparkles className="h-4 w-4 text-primary" />}>
          <CardRow items={popular} selectedId={selectedId} onSelect={onSelect} />
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

function CardRow({
  items,
  selectedId,
  onSelect,
}: {
  items: CurriculumDisplay[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {items.map((item) => (
        <CurriculumRow
          key={item.id}
          item={item}
          selected={selectedId === item.id}
          onSelect={onSelect}
          compact
        />
      ))}
    </div>
  );
}

function CurriculumRow({
  item,
  selected,
  onSelect,
  compact = false,
}: {
  item: CurriculumDisplay;
  selected: boolean;
  onSelect: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      aria-pressed={selected}
      data-testid="oral-curriculum-item"
      className={cn(
        'group flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
        'hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        selected
          ? 'border-primary bg-primary/10 ring-1 ring-primary'
          : 'border-border bg-surface',
        compact && 'py-2',
      )}
    >
      <BookOpen
        className={cn('h-4 w-4 mt-0.5 shrink-0', selected ? 'text-primary' : 'text-muted-foreground')}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{item.display_name}</span>
          {item.popularity >= 900 && (
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">beliebt</Badge>
          )}
        </div>
        {item.subtitle && (
          <div className="truncate text-xs text-muted-foreground">{item.subtitle}</div>
        )}
      </div>
    </button>
  );
}
