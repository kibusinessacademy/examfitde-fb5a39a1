import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Brain, Target, Zap, BookOpen, ChevronLeft, Search, 
  Loader2, Sparkles, GraduationCap, CheckCircle2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTrainerBerufe, CATEGORY_META, type BerufCategory, type TrainerBeruf } from '@/hooks/useTrainerBerufe';

export type TrainingMode = 'learn' | 'exam' | 'quick';

interface TrainerStartPageProps {
  onStart: (curriculumId: string, berufName: string, mode: TrainingMode) => void;
}

export default function TrainerStartPage({ onStart }: TrainerStartPageProps) {
  const { data: berufe, isLoading } = useTrainerBerufe();
  
  const [selectedCategory, setSelectedCategory] = useState<BerufCategory | null>(null);
  const [selectedBeruf, setSelectedBeruf] = useState<TrainerBeruf | null>(null);
  const [selectedMode, setSelectedMode] = useState<TrainingMode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Group berufe by category
  const categoryGroups = useMemo(() => {
    if (!berufe) return [];
    const groups = new Map<BerufCategory, TrainerBeruf[]>();
    for (const b of berufe) {
      const list = groups.get(b.category) || [];
      list.push(b);
      groups.set(b.category, list);
    }
    return Array.from(groups.entries())
      .map(([key, items]) => ({
        key,
        ...CATEGORY_META[key],
        count: items.length,
        items,
      }))
      .sort((a, b) => a.order - b.order);
  }, [berufe]);

  // Filtered berufe for search or category view
  const filteredBerufe = useMemo(() => {
    if (!berufe) return [];
    let list = selectedCategory
      ? berufe.filter(b => b.category === selectedCategory)
      : berufe;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(b => b.bezeichnung_kurz.toLowerCase().includes(q));
    }
    return list;
  }, [berufe, selectedCategory, searchQuery]);

  const handleBack = () => {
    if (selectedMode !== null && selectedBeruf) {
      setSelectedMode(null);
    } else if (selectedBeruf) {
      setSelectedBeruf(null);
      setSelectedMode(null);
    } else if (selectedCategory) {
      setSelectedCategory(null);
      setSearchQuery('');
    }
  };

  const handleStart = () => {
    if (selectedBeruf && selectedMode) {
      onStart(selectedBeruf.curriculum_id, selectedBeruf.bezeichnung_kurz, selectedMode);
    }
  };

  // Current step
  const currentStep = !selectedCategory && !selectedBeruf
    ? 'category'
    : selectedBeruf && !selectedMode
    ? 'mode'
    : selectedBeruf && selectedMode
    ? 'ready'
    : 'beruf';

  return (
    <div className="min-h-[70vh] max-w-2xl mx-auto">
      {/* Hero */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 mb-4">
          <GraduationCap className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium text-primary">IHK-Prüfungsvorbereitung</span>
        </div>
        <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-3">
          Prüfungs<span className="text-gradient">trainer</span>
        </h1>
        <p className="text-muted-foreground max-w-md mx-auto">
          Trainiere echte Prüfungsfragen für deine Abschlussprüfung
        </p>
        <div className="flex items-center justify-center gap-4 mt-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-primary" /> 1000+ Prüfungsfragen</span>
          <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-primary" /> Sofortiges Feedback</span>
        </div>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center justify-center gap-2 mb-6">
        {[
          { label: 'Beruf', done: !!selectedBeruf },
          { label: 'Modus', done: !!selectedMode },
          { label: 'Start', done: false },
        ].map((s, i) => (
          <div key={s.label} className="flex items-center gap-2">
            {i > 0 && <div className="w-8 h-px bg-border" />}
            <div className={cn(
              "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors",
              s.done ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
            )}>
              {s.done && <CheckCircle2 className="h-3 w-3" />}
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Back Button */}
      {currentStep !== 'category' && (
        <Button variant="ghost" size="sm" onClick={handleBack} className="mb-4 gap-1.5">
          <ChevronLeft className="h-4 w-4" />
          Zurück
        </Button>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {/* Step 1: Category Selection */}
      {!isLoading && currentStep === 'category' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground text-center">
            Wähle deinen Bereich
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {categoryGroups.map(cat => (
              <button
                key={cat.key}
                onClick={() => setSelectedCategory(cat.key)}
                className={cn(
                  "flex flex-col items-center gap-2 p-5 rounded-2xl border border-border",
                  "bg-card hover:border-primary/50 hover:bg-primary/5 transition-all",
                  "active:scale-[0.98]"
                )}
              >
                <span className="text-3xl">{cat.emoji}</span>
                <span className="font-medium text-sm text-foreground">{cat.label}</span>
                <Badge variant="secondary" className="text-xs">
                  {cat.count} {cat.count === 1 ? 'Beruf' : 'Berufe'}
                </Badge>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Beruf Selection */}
      {!isLoading && currentStep === 'beruf' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground text-center">
            {selectedCategory && CATEGORY_META[selectedCategory]
              ? `${CATEGORY_META[selectedCategory].emoji} ${CATEGORY_META[selectedCategory].label}`
              : 'Beruf wählen'}
          </h2>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Beruf suchen..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Beruf List */}
          <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
            {filteredBerufe.length === 0 && (
              <p className="text-center text-muted-foreground py-8 text-sm">
                Kein Beruf gefunden
              </p>
            )}
            {filteredBerufe.map(b => (
              <button
                key={b.id}
                onClick={() => {
                  setSelectedBeruf(b);
                  setSelectedMode(null);
                }}
                className={cn(
                  "w-full flex items-center gap-3 p-4 rounded-xl border text-left transition-all",
                  "border-border bg-card hover:border-primary/50 hover:bg-primary/5",
                  "active:scale-[0.99]"
                )}
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-foreground truncate">
                    {b.bezeichnung_kurz}
                  </p>
                </div>
                <ChevronLeft className="h-4 w-4 text-muted-foreground rotate-180 flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 3: Mode Selection */}
      {!isLoading && (currentStep === 'mode' || currentStep === 'ready') && selectedBeruf && (
        <div className="space-y-4">
          {/* Selected Beruf Badge */}
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-4 flex items-center gap-3">
              <GraduationCap className="h-5 w-5 text-primary flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-foreground truncate">
                  {selectedBeruf.bezeichnung_kurz}
                </p>
              </div>
            </CardContent>
          </Card>

          <h2 className="text-lg font-semibold text-foreground text-center">
            Was möchtest du trainieren?
          </h2>

          <div className="space-y-3">
            {([
              {
                value: 'learn' as const,
                label: 'Lernmodus',
                desc: 'Erklärungen & Feedback nach jeder Frage',
                icon: BookOpen,
              },
              {
                value: 'exam' as const,
                label: 'Prüfungsmodus',
                desc: 'Echte Prüfungssimulation mit Zeitlimit',
                icon: Target,
              },
              {
                value: 'quick' as const,
                label: 'Schnelltraining',
                desc: '10 zufällige Fragen – schnell & effektiv',
                icon: Zap,
              },
            ]).map(mode => (
              <button
                key={mode.value}
                onClick={() => setSelectedMode(mode.value)}
                className={cn(
                  "w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-all",
                  "active:scale-[0.99]",
                  selectedMode === mode.value
                    ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                    : "border-border bg-card hover:border-primary/50"
                )}
              >
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                  selectedMode === mode.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                )}>
                  <mode.icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium text-sm text-foreground">{mode.label}</p>
                  <p className="text-xs text-muted-foreground">{mode.desc}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Start Button */}
          <Button
            onClick={handleStart}
            disabled={!selectedMode}
            className="w-full h-12 text-base gradient-primary text-primary-foreground shadow-glow mt-2"
          >
            <Sparkles className="h-5 w-5 mr-2" />
            Training starten
          </Button>
        </div>
      )}
    </div>
  );
}
