import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, GraduationCap, Briefcase, Laptop, Wrench, HeartPulse,
  Cog, Truck, UtensilsCrossed, MoreHorizontal,
  ChevronRight, Sparkles, Target, Brain, PlayCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useTrainerBerufe, CATEGORY_META, type BerufCategory, type TrainerBeruf } from '@/hooks/useTrainerBerufe';

export type TrainingMode = 'learn' | 'exam' | 'quick';

interface TrainerStartPageProps {
  onStart: (curriculumId: string, berufName: string, mode: TrainingMode) => void;
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

const CATEGORY_SUBTITLES: Record<BerufCategory, string> = {
  kaufmaennisch: 'Handel, Büro, Finanzen',
  it: 'Fachinformatik & IT-Berufe',
  handwerk: 'Bau, Fertigung, Montage',
  gesundheit: 'Medizin & Pharma',
  technik: 'Industrie, Anlagen, Maschinen',
  logistik: 'Lager, Spedition, Transport',
  gastro: 'Küche, Hotel, Lebensmittel',
  sonstige: 'Weitere Ausbildungsberufe',
};

const TRAINING_MODES: {
  id: TrainingMode;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    id: 'learn',
    title: 'Lernmodus',
    subtitle: 'Mit Erklärungen, Feedback und didaktischer Begleitung',
    icon: Brain,
  },
  {
    id: 'exam',
    title: 'Prüfungsmodus',
    subtitle: 'Prüfungsnahe Simulation mit Zeitdruck und Bewertung',
    icon: Target,
  },
  {
    id: 'quick',
    title: 'Schnelltraining',
    subtitle: 'Direkt 10 gemischte Fragen starten',
    icon: PlayCircle,
  },
];

export default function TrainerStartPage({ onStart }: TrainerStartPageProps) {
  const { data: berufe, isLoading } = useTrainerBerufe();

  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<BerufCategory | null>(null);
  const [selectedBeruf, setSelectedBeruf] = useState<TrainerBeruf | null>(null);
  const [selectedMode, setSelectedMode] = useState<TrainingMode | null>(null);

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
      .sort((a, b) => (CATEGORY_META[a.key].order) - (CATEGORY_META[b.key].order));
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

  const canStart = Boolean(selectedBeruf && selectedMode);

  const handleStart = () => {
    if (!selectedBeruf || !selectedMode) return;
    onStart(selectedBeruf.curriculum_id, selectedBeruf.bezeichnung_kurz, selectedMode);
  };

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
          Prüfungstrainer
        </div>

        <h1 className="text-3xl font-display font-bold tracking-tight text-foreground sm:text-4xl">
          Trainiere echte Prüfungsfragen für deinen Beruf
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
          Wähle deinen Beruf, starte deinen Modus und bereite dich gezielt auf die
          IHK- oder Abschlussprüfung vor.
        </p>
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
                { label: 'Beruf auswählen', desc: 'Nur Berufe und Prüfungen, keine technischen Curricula.' },
                { label: 'Modus wählen', desc: 'Lernen, simulieren oder direkt ins Schnelltraining.' },
                { label: 'Training starten', desc: 'Direkter Einstieg in deinen prüfungsrelevanten Fragenpool.' },
              ].map((s, i) => (
                <div key={i} className="rounded-xl border border-border bg-card/60 p-4">
                  <div className="mb-2 flex items-center gap-2 text-accent">
                    <Sparkles className="h-4 w-4" />
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

      {/* ─── Main Content ─── */}
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Left Column: Beruf + Mode selection */}
        <div className="space-y-6">
          {/* Step 1: Beruf */}
          <Card className="rounded-2xl border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-xl">1. Wähle deinen Beruf</CardTitle>
              <CardDescription>
                Suche nach deinem Ausbildungsberuf oder wähle eine Kategorie.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Search */}
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Beruf suchen, z. B. Verkäufer oder Fachinformatiker"
                  className="h-12 rounded-xl pl-10 text-base"
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
                      onClick={() => {
                        setSelectedCategory(isSelected ? null : key);
                        setSelectedBeruf(null);
                      }}
                      className={cn(
                        'rounded-xl border p-4 text-left transition-all active:scale-[0.98]',
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
                        {categoryCounts[key] || 0} Berufe
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Beruf List */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm font-medium text-muted-foreground">
                    {selectedCategory
                      ? CATEGORY_META[selectedCategory].label
                      : 'Alle Berufe'}
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
                        Kein Beruf gefunden. Passe deine Suche oder Kategorie an.
                      </div>
                    )}

                    {filteredBerufe.map((b) => {
                      const isActive = selectedBeruf?.id === b.id;
                      return (
                        <button
                          key={b.id}
                          onClick={() => setSelectedBeruf(b)}
                          className={cn(
                            'w-full rounded-xl border px-4 py-3 text-left transition-all active:scale-[0.99]',
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
                            <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
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
          <Card className="rounded-2xl border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-xl">2. Wähle deinen Modus</CardTitle>
              <CardDescription>
                Passe dein Training an dein aktuelles Ziel an.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {TRAINING_MODES.map((mode) => {
                const Icon = mode.icon;
                const isSelected = selectedMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    onClick={() => setSelectedMode(mode.id)}
                    className={cn(
                      'w-full rounded-xl border p-4 text-left transition-all active:scale-[0.99]',
                      isSelected
                        ? 'border-accent bg-accent/10'
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
        </div>

        {/* Right Column: Summary + Start */}
        <div>
          <Card className="sticky top-4 rounded-2xl border-accent/20 bg-gradient-to-br from-primary/10 via-card to-card shadow-lg">
            <CardHeader>
              <CardTitle className="text-xl">3. Training starten</CardTitle>
              <CardDescription>
                Dein Einstieg wird erst aktiv, wenn Beruf und Modus gewählt sind.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4 rounded-xl border border-border bg-muted/30 p-4">
                <div>
                  <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                    Beruf
                  </div>
                  <div className="font-medium text-foreground">
                    {selectedBeruf?.bezeichnung_kurz || 'Noch nicht ausgewählt'}
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                    Modus
                  </div>
                  <div className="font-medium text-foreground">
                    {selectedMode
                      ? TRAINING_MODES.find((m) => m.id === selectedMode)?.title
                      : 'Noch nicht ausgewählt'}
                  </div>
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
                        <span className="font-medium">
                          {selectedBeruf.bezeichnung_kurz}
                        </span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <Button
                onClick={handleStart}
                disabled={!canStart}
                className="mt-4 w-full h-12 text-base gradient-primary text-primary-foreground shadow-glow"
              >
                <Sparkles className="h-5 w-5 mr-2" />
                Training starten
              </Button>

              {!canStart && (
                <p className="mt-3 text-center text-xs text-muted-foreground">
                  Wähle oben zuerst einen Beruf und einen Trainingsmodus.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
