import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTerminology } from '@/hooks/useProgramType';
import {
  Search, GraduationCap, Briefcase, Laptop, Wrench, HeartPulse,
  Cog, Truck, UtensilsCrossed, MoreHorizontal,
  ChevronRight, Sparkles, Target, Brain, PlayCircle,
  CheckCircle2, Zap, MessageSquare,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useTrainerBerufe, CATEGORY_META, type BerufCategory, type TrainerBeruf } from '@/hooks/useTrainerBerufe';
import type { TrainerStartPayload, TrainingMode } from '@/types/trainer';
import { buildTrainerStartPayload } from '@/features/trainer/trainer-start-config';

/* ─── Props ─── */
interface TrainerStartPageProps {
  onStart: (payload: TrainerStartPayload) => void;
}

/* ─── Category icon mapping ─── */
const CATEGORY_ICONS: Record<BerufCategory, React.ComponentType<{ className?: string }>> = {
  kaufmaennisch: Briefcase,
  it: Laptop,
  handwerk: Wrench,
  gesundheit: HeartPulse,
  technik: Cog,
  logistik: Truck,
  gastro: UtensilsCrossed,
  sonstige: MoreHorizontal,
};

/* ─── Training modes (will be rendered with dynamic labels) ─── */
function getTrainingModes(isAcademic: boolean): {
  id: TrainingMode;
  title: string;
  subtitle: string;
  summaryHint: string;
  icon: React.ComponentType<{ className?: string }>;
}[] {
  return [
    {
      id: 'learn',
      title: 'Lernmodus',
      subtitle: 'Mit Erklärungen, Feedback und didaktischer Begleitung',
      summaryHint: 'Mit Erklärungen nach jeder Frage',
      icon: Brain,
    },
    {
      id: 'exam',
      title: isAcademic ? 'Klausurmodus' : 'Prüfungsmodus',
      subtitle: isAcademic ? 'Klausurnahe Simulation mit Zeitdruck und Bewertung' : 'Prüfungsnahe Simulation mit Zeitdruck und Bewertung',
      summaryHint: isAcademic ? 'Echte Klausursimulation mit Zeitdruck' : 'Echte Prüfungssimulation mit Zeitdruck',
      icon: Target,
    },
    {
      id: 'quick',
      title: 'Schnelltraining',
      subtitle: 'Direkt 10 gemischte Fragen starten',
      summaryHint: '10 gemischte Fragen, sofort los',
      icon: PlayCircle,
    },
  ];
}

/* ─── Popular berufe slugs (top picks for quick access) ─── */
const POPULAR_SLUGS = [
  'verkäufer', 'einzelhandel', 'industriekaufm', 'fachinformatik',
  'medizinisch', 'mechatronik',
];

function isPopular(name: string): boolean {
  const lower = name.toLowerCase();
  return POPULAR_SLUGS.some((s) => lower.includes(s));
}

/* ─── Component ─── */
export default function TrainerStartPage({ onStart }: TrainerStartPageProps) {
  const { data: berufe, isLoading } = useTrainerBerufe();

  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<BerufCategory | null>(null);
  const [selectedBeruf, setSelectedBeruf] = useState<TrainerBeruf | null>(null);
  const [selectedMode, setSelectedMode] = useState<TrainingMode | null>(null);
  const { t, isAcademic } = useTerminology(selectedBeruf?.curriculum_id);

  /* ─── Derived data ─── */
  const categoryGroups = useMemo(() => {
    if (!berufe) return [];
    const groups = new Map<BerufCategory, TrainerBeruf[]>();
    for (const b of berufe) {
      const list = groups.get(b.category) || [];
      list.push(b);
      groups.set(b.category, list);
    }
    return Array.from(groups.entries())
      .map(([key, items]) => ({ key, count: items.length, items }))
      .sort((a, b) => CATEGORY_META[a.key].order - CATEGORY_META[b.key].order);
  }, [berufe]);

  const categoryCounts = useMemo(() => {
    const counts: Partial<Record<BerufCategory, number>> = {};
    for (const g of categoryGroups) counts[g.key] = g.count;
    return counts;
  }, [categoryGroups]);

  const filteredBerufe = useMemo(() => {
    if (!berufe) return [];
    let list = selectedCategory
      ? berufe.filter((b) => b.category === selectedCategory)
      : berufe;
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter((b) => b.bezeichnung_kurz.toLowerCase().includes(q));
    }
    return list.sort((a, b) => a.bezeichnung_kurz.localeCompare(b.bezeichnung_kurz, 'de'));
  }, [berufe, search, selectedCategory]);

  const popularBerufe = useMemo(() => {
    if (!berufe) return [];
    return berufe.filter((b) => isPopular(b.bezeichnung_kurz)).slice(0, 5);
  }, [berufe]);

  /* ─── Auto-reset beruf when filtered out ─── */
  useEffect(() => {
    if (selectedBeruf && !filteredBerufe.some((b) => b.id === selectedBeruf.id)) {
      setSelectedBeruf(null);
      setSelectedMode(null);
    }
  }, [filteredBerufe, selectedBeruf]);

  /* ─── Derived validity ─── */
  const isBerufVisible = !!selectedBeruf && filteredBerufe.some((b) => b.id === selectedBeruf.id);
  const canChooseMode = !!selectedBeruf;
  const canStart = !!selectedBeruf && !!selectedMode && isBerufVisible;
  const TRAINING_MODES = useMemo(() => getTrainingModes(isAcademic), [isAcademic]);
  const selectedModeMeta = TRAINING_MODES.find((m) => m.id === selectedMode) ?? null;

  /* ─── Handlers ─── */
  const handleSelectCategory = (category: BerufCategory) => {
    const isSelected = selectedCategory === category;
    setSelectedCategory(isSelected ? null : category);
    setSelectedBeruf(null);
    setSelectedMode(null);
  };

  const handleSelectBeruf = (beruf: TrainerBeruf) => {
    setSelectedBeruf(beruf);
    setSelectedMode(null);
  };

  const handlePopularPick = (beruf: TrainerBeruf) => {
    // Don't lock category — keep full list visible
    setSelectedCategory(null);
    setSelectedBeruf(beruf);
    setSelectedMode(null);
  };

  const handleStart = () => {
    if (!selectedBeruf || !selectedMode) return;
    const payload = buildTrainerStartPayload({
      curriculumId: selectedBeruf.curriculum_id,
      berufLabel: selectedBeruf.bezeichnung_kurz,
      mode: selectedMode,
    });
    onStart(payload);
  };

  /* ─── Summary content (shared between desktop sidebar & mobile bottom) ─── */
  const summaryContent = (
    <>
      <div className="space-y-4 rounded-xl border border-border bg-muted/30 p-4">
        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{isAcademic ? 'Fach' : 'Beruf'}</div>
          <div className={cn('font-medium', selectedBeruf ? 'text-foreground' : 'text-muted-foreground')}>
            {selectedBeruf?.bezeichnung_kurz || 'Noch nicht ausgewählt'}
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Modus</div>
          <div className={cn('font-medium', selectedModeMeta ? 'text-foreground' : 'text-muted-foreground')}>
            {selectedModeMeta?.title || 'Noch nicht ausgewählt'}
          </div>
          {selectedModeMeta && (
            <p className="mt-0.5 text-xs text-muted-foreground">{selectedModeMeta.summaryHint}</p>
          )}
        </div>

        <AnimatePresence mode="wait">
          {selectedBeruf && (
            <motion.div
              key={selectedBeruf.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="rounded-lg border border-accent/20 bg-accent/5 p-3"
            >
              <div className="flex items-center gap-2 text-sm text-accent">
                <GraduationCap className="h-4 w-4" />
                <span className="font-medium">{selectedBeruf.bezeichnung_kurz}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Button
        onClick={handleStart}
        disabled={!canStart}
        className="mt-4 w-full h-12 text-base gradient-primary text-primary-foreground shadow-glow"
        aria-label="Training starten"
      >
        <Sparkles className="h-5 w-5 mr-2" />
        Training starten
      </Button>

      {!canStart && (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          {!selectedBeruf
            ? (isAcademic ? 'Wähle zuerst ein Fach aus.' : 'Wähle zuerst einen Beruf aus.')
            : 'Wähle noch einen Trainingsmodus.'}
        </p>
      )}
    </>
  );

  return (
    <div className="min-h-[70vh] mx-auto w-full max-w-md px-4 pb-28 pt-2 sm:max-w-2xl sm:px-6 lg:max-w-5xl">
      {/* ─── Hero ─── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="mb-5"
      >
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-sm text-primary">
          <GraduationCap className="h-4 w-4" />
          {t('trainerTitle')}
        </div>

        <h1 className="text-3xl font-display font-bold tracking-tight text-foreground sm:text-4xl">
          {t('trainerHeadline')}
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
          {t('trainerSubline')}
        </p>

        {/* Outcome badges */}
        <div className="flex flex-wrap items-center gap-3 mt-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-accent" /> {t('trainerTasksLabel')}
          </span>
          <span className="flex items-center gap-1">
            <Zap className="h-3.5 w-3.5 text-accent" /> Sofort Feedback
          </span>
          <span className="flex items-center gap-1">
            <MessageSquare className="h-3.5 w-3.5 text-accent" /> Schwächen gezielt erkennen
          </span>
        </div>
      </motion.div>

      {/* ─── Steps Overview ─── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.05 }}
        className="mb-6"
      >
        <Card className="overflow-hidden rounded-2xl border-primary/15 bg-gradient-to-br from-primary/10 via-background to-background shadow-lg">
          <CardContent className="p-5 sm:p-6">
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: t('trainerSelectLabel'), desc: t('trainerSelectDesc'), done: !!selectedBeruf },
                { label: 'Modus wählen', desc: 'Lernen, simulieren oder direkt ins Schnelltraining.', done: !!selectedMode },
                { label: t('trainerStartLabel'), desc: t('trainerStartDesc'), done: canStart },
              ].map((s, i) => (
                <div
                  key={i}
                  className={cn(
                    'rounded-xl border p-4 transition-colors',
                    s.done ? 'border-accent/40 bg-accent/5' : 'border-border bg-card/60',
                  )}
                >
                  <div className="mb-2 flex items-center gap-2 text-accent">
                    {s.done ? <CheckCircle2 className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                    <span className="text-sm font-medium">Schritt {i + 1}</span>
                  </div>
                  <div className="font-semibold text-foreground">{s.label}</div>
                  <p className="mt-1 text-sm text-muted-foreground">{s.desc}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ─── Popular Berufe (quick access) ─── */}
      {!isLoading && popularBerufe.length > 0 && !selectedCategory && !search.trim() && (
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">{isAcademic ? 'Beliebte Fächer' : 'Beliebte Berufe'}</h2>
            <Badge variant="secondary" className="rounded-full text-xs">
              Schnellzugriff
            </Badge>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {popularBerufe.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => handlePopularPick(b)}
                aria-pressed={selectedBeruf?.id === b.id}
                className={cn(
                  'rounded-xl border p-3 text-left transition-all active:scale-[0.98]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selectedBeruf?.id === b.id
                    ? 'border-accent bg-accent/10'
                    : 'border-border bg-card hover:border-primary/30 hover:bg-muted/50',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground truncate">
                    {b.bezeichnung_kurz}
                  </span>
                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {CATEGORY_META[b.category].label}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ─── Main Content ─── */}
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Left Column */}
        <div className="space-y-6">
          {/* Step 1: Beruf */}
          <Card className="rounded-2xl border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-xl">1. {t('trainerSelectLabel')}</CardTitle>
              <CardDescription>
                {isAcademic ? 'Suche nach deinem Studienfach oder wähle eine Kategorie.' : 'Suche nach deinem Ausbildungsberuf oder wähle eine Kategorie.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Search */}
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={isAcademic ? 'Fach suchen, z. B. BWL oder Wirtschaftsinformatik' : 'Beruf suchen, z. B. Verkäufer oder Fachinformatiker'}
                  className="h-12 rounded-xl pl-10 text-base"
                  aria-label={isAcademic ? 'Fach suchen' : 'Beruf suchen'}
                />
              </div>

              {/* Category Grid */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {categoryGroups.map(({ key }) => {
                  const Icon = CATEGORY_ICONS[key];
                  const isSelected = selectedCategory === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleSelectCategory(key)}
                      aria-pressed={isSelected}
                      className={cn(
                        'rounded-xl border p-4 text-left transition-all active:scale-[0.98]',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        isSelected
                          ? 'border-accent bg-accent/10'
                          : 'border-border bg-card hover:border-primary/30 hover:bg-muted/50',
                      )}
                    >
                      <div className="mb-2 text-accent">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="text-sm font-semibold text-foreground">
                        {CATEGORY_META[key].label}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {categoryCounts[key] || 0} {isAcademic ? 'Fächer' : 'Berufe'}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Beruf List */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm font-medium text-muted-foreground">
                    {selectedCategory ? CATEGORY_META[selectedCategory].label : (isAcademic ? 'Alle Fächer' : 'Alle Berufe')}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {filteredBerufe.length} Treffer
                  </div>
                </div>

                <ScrollArea className="h-[280px] rounded-xl border border-border bg-muted/30 p-2">
                  <div className="space-y-2">
                    {isLoading && (
                      <div className="py-8 text-center text-sm text-muted-foreground">
                        Berufe werden geladen…
                      </div>
                    )}

                    {!isLoading && filteredBerufe.length === 0 && (
                      <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                        {berufe && berufe.length === 0
                          ? t('trainerEmpty')
                          : (isAcademic ? 'Kein Fach gefunden. Passe deine Suche oder Kategorie an.' : 'Kein Beruf gefunden. Passe deine Suche oder Kategorie an.')}
                      </div>
                    )}

                    {filteredBerufe.map((b) => {
                      const isActive = selectedBeruf?.id === b.id;
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => handleSelectBeruf(b)}
                          aria-pressed={isActive}
                          className={cn(
                            'w-full rounded-xl border px-4 py-3 text-left transition-all active:scale-[0.99]',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            isActive
                              ? 'border-accent bg-accent/10'
                              : 'border-transparent bg-card/50 hover:border-border hover:bg-card',
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-medium text-foreground text-sm">
                                {b.bezeichnung_kurz}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {CATEGORY_META[b.category].label}
                              </div>
                            </div>
                            {isActive ? (
                              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" />
                            ) : (
                              <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            </CardContent>
          </Card>

          {/* Step 2: Mode */}
          <Card
            className={cn(
              'rounded-2xl border-border bg-card transition-all',
              !canChooseMode && 'opacity-50 pointer-events-none cursor-not-allowed',
            )}
            aria-disabled={!canChooseMode}
          >
            <CardHeader className="pb-3">
              <CardTitle className="text-xl">2. Wähle deinen Modus</CardTitle>
              <CardDescription>
                {canChooseMode
                   ? 'Passe dein Training an dein aktuelles Ziel an.'
                   : (isAcademic ? 'Wähle zuerst ein Fach, um den Modus freizuschalten.' : 'Wähle zuerst einen Beruf, um den Modus freizuschalten.')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {TRAINING_MODES.map((mode) => {
                const Icon = mode.icon;
                const isSelected = selectedMode === mode.id;
                const disabled = !canChooseMode;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => !disabled && setSelectedMode(mode.id)}
                    disabled={disabled}
                    aria-pressed={isSelected}
                    aria-disabled={disabled}
                    className={cn(
                      'w-full rounded-xl border p-4 text-left transition-all',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      disabled
                        ? 'cursor-not-allowed'
                        : 'active:scale-[0.99]',
                      isSelected
                        ? 'border-accent bg-accent/10'
                        : disabled
                          ? 'border-border bg-card'
                          : 'border-border bg-card hover:border-primary/30 hover:bg-muted/50',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          'mt-0.5 rounded-lg p-2',
                          isSelected
                            ? 'bg-accent text-accent-foreground'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="font-semibold text-foreground">{mode.title}</div>
                        <div className="mt-1 text-sm text-muted-foreground">{mode.subtitle}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          {/* ─── Mobile Summary (visible only on small screens) ─── */}
          <div className="lg:hidden">
            <Card className="rounded-2xl border-accent/20 bg-gradient-to-br from-primary/10 via-card to-card shadow-lg">
              <CardHeader className="pb-2">
                <CardTitle className="text-xl">3. Training starten</CardTitle>
              </CardHeader>
              <CardContent>{summaryContent}</CardContent>
            </Card>
          </div>
        </div>

        {/* ─── Desktop Summary (right column, hidden on mobile) ─── */}
        <div className="hidden lg:block">
          <Card className="sticky top-4 rounded-2xl border-accent/20 bg-gradient-to-br from-primary/10 via-card to-card shadow-lg">
            <CardHeader>
              <CardTitle className="text-xl">3. Training starten</CardTitle>
              <CardDescription>
                Dein Einstieg wird erst aktiv, wenn {isAcademic ? 'Fach' : 'Beruf'} und Modus gewählt sind.
              </CardDescription>
            </CardHeader>
            <CardContent>{summaryContent}</CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
