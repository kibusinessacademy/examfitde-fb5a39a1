import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { 
  Wind, 
  Eye, 
  ListChecks, 
  Zap,
  Play,
  Pause,
  RotateCcw,
  CheckCircle2,
  Heart,
  Brain,
  Mountain,
  Waves,
  Sun,
  Moon,
  Loader2,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTerminology } from '@/hooks/useProgramType';
import { useDashboardSummary } from '@/hooks/useDashboardSummary';

type SessionType = 'breathing' | 'visualization' | 'checklist' | 'quick_calm';

interface BreathingPhase {
  name: string;
  duration: number;
  instruction: string;
}

// 4-7-8 Breathing Pattern
const BREATHING_478: BreathingPhase[] = [
  { name: 'Einatmen', duration: 4, instruction: 'Tief durch die Nase einatmen' },
  { name: 'Halten', duration: 7, instruction: 'Atem sanft anhalten' },
  { name: 'Ausatmen', duration: 8, instruction: 'Langsam durch den Mund ausatmen' },
];

// Box Breathing Pattern
const BREATHING_BOX: BreathingPhase[] = [
  { name: 'Einatmen', duration: 4, instruction: 'Gleichmäßig einatmen' },
  { name: 'Halten', duration: 4, instruction: 'Atem halten' },
  { name: 'Ausatmen', duration: 4, instruction: 'Gleichmäßig ausatmen' },
  { name: 'Halten', duration: 4, instruction: 'Pause vor dem nächsten Atemzug' },
];

const VISUALIZATION_THEMES = [
  { id: 'mountain', name: 'Berggipfel', icon: Mountain, description: 'Stell dir vor, du stehst auf einem Berggipfel...' },
  { id: 'ocean', name: 'Meeresstrand', icon: Waves, description: 'Du sitzt an einem ruhigen Strand...' },
  { id: 'sunrise', name: 'Sonnenaufgang', icon: Sun, description: 'Ein warmer Sonnenaufgang...' },
  { id: 'starry', name: 'Sternenhimmel', icon: Moon, description: 'Eine klare Nacht voller Sterne...' },
];

const EXAM_CHECKLIST = [
  { id: 'materials', label: 'Alle Materialien eingepackt (Stift, Ausweis, Taschenrechner)', category: 'Vorbereitung' },
  { id: 'location', label: 'Prüfungsort und Anfahrt bekannt', category: 'Vorbereitung' },
  { id: 'sleep', label: 'Ausreichend geschlafen (7-8 Stunden)', category: 'Körper' },
  { id: 'food', label: 'Leichtes Frühstück gegessen', category: 'Körper' },
  { id: 'water', label: 'Wasserflasche dabei', category: 'Körper' },
  { id: 'breathing', label: 'Atemübung gemacht', category: 'Mental' },
  { id: 'positive', label: 'Positive Selbstgespräche geführt', category: 'Mental' },
  { id: 'time', label: 'Früh genug losgefahren (Puffer eingeplant)', category: 'Organisation' },
];

const QUICK_CALM_STEPS = [
  { title: 'Stop', instruction: 'Halte kurz inne. Erkenne, dass du nervös bist – das ist normal.', duration: 5 },
  { title: 'Atme', instruction: 'Atme 3x tief ein und aus. Zähle: Ein-2-3-4, Aus-2-3-4-5-6.', duration: 15 },
  { title: 'Beobachte', instruction: 'Spüre deine Füße auf dem Boden. Fühle den Stuhl unter dir.', duration: 10 },
  { title: 'Positiv', instruction: 'Sage dir: "Ich bin gut vorbereitet. Ich schaffe das."', duration: 10 },
];

export default function ExamAnxietyManager() {
  const { user } = useAuth();
  const { data: dashboard } = useDashboardSummary();
  const activeCurriculumId = dashboard?.active_curriculum_id || null;
  const { t } = useTerminology(activeCurriculumId);
  const [activeSession, setActiveSession] = useState<SessionType | null>(null);
  const [anxietyBefore, setAnxietyBefore] = useState<number>(5);
  const [anxietyAfter, setAnxietyAfter] = useState<number | null>(null);
  
  // Breathing state
  const [breathingPattern, setBreathingPattern] = useState<'478' | 'box'>('478');
  const [breathingRound, setBreathingRound] = useState(0);
  const [breathingPhase, setBreathingPhase] = useState(0);
  const [breathingTimer, setBreathingTimer] = useState(0);
  const [isBreathing, setIsBreathing] = useState(false);
  const [totalRounds, setTotalRounds] = useState(4);
  
  // Visualization state
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);
  const [visualizationTimer, setVisualizationTimer] = useState(0);
  const [isVisualizing, setIsVisualizing] = useState(false);
  const [visualizationDuration, setVisualizationDuration] = useState(120); // 2 minutes
  
  // Checklist state
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  
  // Quick calm state
  const [quickCalmStep, setQuickCalmStep] = useState(0);
  const [quickCalmTimer, setQuickCalmTimer] = useState(0);
  const [isQuickCalm, setIsQuickCalm] = useState(false);

  const currentPattern = breathingPattern === '478' ? BREATHING_478 : BREATHING_BOX;

  // Breathing exercise logic
  useEffect(() => {
    if (!isBreathing) return;

    const interval = setInterval(() => {
      setBreathingTimer(prev => {
        const currentPhaseDuration = currentPattern[breathingPhase].duration;
        
        if (prev >= currentPhaseDuration) {
          // Move to next phase
          const nextPhase = (breathingPhase + 1) % currentPattern.length;
          setBreathingPhase(nextPhase);
          
          // If we completed a full cycle
          if (nextPhase === 0) {
            const nextRound = breathingRound + 1;
            if (nextRound >= totalRounds) {
              setIsBreathing(false);
              toast.success('Atemübung abgeschlossen! 🧘');
              return 0;
            }
            setBreathingRound(nextRound);
          }
          return 0;
        }
        return prev + 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isBreathing, breathingPhase, breathingRound, currentPattern, totalRounds]);

  // Visualization timer
  useEffect(() => {
    if (!isVisualizing) return;

    const interval = setInterval(() => {
      setVisualizationTimer(prev => {
        if (prev >= visualizationDuration) {
          setIsVisualizing(false);
          toast.success('Visualisierung abgeschlossen! ✨');
          return visualizationDuration;
        }
        return prev + 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isVisualizing, visualizationDuration]);

  // Quick calm timer
  useEffect(() => {
    if (!isQuickCalm) return;

    const interval = setInterval(() => {
      setQuickCalmTimer(prev => {
        const currentStepDuration = QUICK_CALM_STEPS[quickCalmStep].duration;
        
        if (prev >= currentStepDuration) {
          const nextStep = quickCalmStep + 1;
          if (nextStep >= QUICK_CALM_STEPS.length) {
            setIsQuickCalm(false);
            toast.success('Sofort-Beruhigung abgeschlossen! 💪');
            return 0;
          }
          setQuickCalmStep(nextStep);
          return 0;
        }
        return prev + 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isQuickCalm, quickCalmStep]);

  const saveSession = async (type: SessionType, additionalData: any = {}) => {
    if (!user) return;

    try {
      await supabase.from('exam_anxiety_sessions').insert({
        user_id: user.id,
        session_type: type,
        anxiety_before: anxietyBefore,
        anxiety_after: anxietyAfter,
        ...additionalData,
        completed_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to save session:', error);
    }
  };

  const handleComplete = async () => {
    if (activeSession) {
      const additionalData: any = {};
      
      if (activeSession === 'breathing') {
        additionalData.breathing_rounds = breathingRound + 1;
        additionalData.breathing_pattern = breathingPattern;
      } else if (activeSession === 'visualization') {
        additionalData.visualization_theme = selectedTheme;
        additionalData.visualization_duration_seconds = visualizationTimer;
      } else if (activeSession === 'checklist') {
        additionalData.checklist_items_completed = checkedItems.size;
        additionalData.checklist_items_total = EXAM_CHECKLIST.length;
      }

      await saveSession(activeSession, additionalData);
    }
    
    // Reset state
    setActiveSession(null);
    setAnxietyAfter(null);
    setBreathingRound(0);
    setBreathingPhase(0);
    setBreathingTimer(0);
    setIsBreathing(false);
    setVisualizationTimer(0);
    setIsVisualizing(false);
    setQuickCalmStep(0);
    setQuickCalmTimer(0);
    setIsQuickCalm(false);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Session Selection
  if (!activeSession) {
    return (
      <div className="container max-w-4xl py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Heart className="h-8 w-8 text-primary" />
            {t('anxietyTitle')}
          </h1>
          <p className="text-muted-foreground mt-2">
            Techniken zur Beruhigung und mentalen Vorbereitung
          </p>
        </div>

        {/* Anxiety Level Input */}
        <Card className="glass-card mb-6">
          <CardContent className="pt-6">
            <div className="space-y-4">
              <label className="text-sm font-medium">
                Wie nervös fühlst du dich gerade? (1 = entspannt, 10 = sehr nervös)
              </label>
              <div className="flex items-center gap-4">
                <span className="text-sm">😌 1</span>
                <Slider
                  value={[anxietyBefore]}
                  onValueChange={(v) => setAnxietyBefore(v[0])}
                  min={1}
                  max={10}
                  step={1}
                  className="flex-1"
                />
                <span className="text-sm">10 😰</span>
              </div>
              <div className="text-center">
                <Badge variant={anxietyBefore <= 3 ? 'default' : anxietyBefore <= 6 ? 'secondary' : 'destructive'}>
                  Level {anxietyBefore}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Session Types */}
        <div className="grid md:grid-cols-2 gap-4">
          <Card 
            className="glass-card cursor-pointer hover:border-primary/50 transition-all"
            onClick={() => setActiveSession('breathing')}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wind className="h-5 w-5 text-blue-500" />
                Atemübung
              </CardTitle>
              <CardDescription>
                4-7-8 oder Box-Breathing Technik
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {t('anxietyBreathing')}
              </p>
            </CardContent>
          </Card>

          <Card 
            className="glass-card cursor-pointer hover:border-primary/50 transition-all"
            onClick={() => setActiveSession('visualization')}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5 text-purple-500" />
                Visualisierung
              </CardTitle>
              <CardDescription>
                Geführte Entspannungsbilder
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Stelle dir einen ruhigen Ort vor und lass die Anspannung los.
              </p>
            </CardContent>
          </Card>

          <Card 
            className="glass-card cursor-pointer hover:border-primary/50 transition-all"
            onClick={() => setActiveSession('checklist')}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ListChecks className="h-5 w-5 text-green-500" />
                {t('anxietyChecklist')}
              </CardTitle>
              <CardDescription>
                Strukturierte Vorbereitung
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Gehe alle wichtigen Punkte durch und gewinne Sicherheit.
              </p>
            </CardContent>
          </Card>

          <Card 
            className="glass-card cursor-pointer hover:border-primary/50 transition-all"
            onClick={() => setActiveSession('quick_calm')}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-yellow-500" />
                Sofort-Beruhigung
              </CardTitle>
              <CardDescription>
                40 Sekunden STOP-Technik
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Schnelle Hilfe bei akuter Nervosität direkt vor oder in der Prüfung.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Breathing Exercise
  if (activeSession === 'breathing') {
    const currentPhaseData = currentPattern[breathingPhase];
    const phaseProgress = (breathingTimer / currentPhaseData.duration) * 100;

    return (
      <div className="container max-w-lg py-8">
        <Card className="glass-card">
          <CardHeader className="text-center">
            <CardTitle className="flex items-center justify-center gap-2">
              <Wind className="h-6 w-6 text-blue-500" />
              Atemübung
            </CardTitle>
            <div className="flex justify-center gap-2 mt-2">
              <Button
                size="sm"
                variant={breathingPattern === '478' ? 'default' : 'outline'}
                onClick={() => setBreathingPattern('478')}
                disabled={isBreathing}
              >
                4-7-8
              </Button>
              <Button
                size="sm"
                variant={breathingPattern === 'box' ? 'default' : 'outline'}
                onClick={() => setBreathingPattern('box')}
                disabled={isBreathing}
              >
                Box
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-8">
            {/* Breathing Circle */}
            <div className="relative w-48 h-48 mx-auto">
              <div 
                className={cn(
                  "absolute inset-0 rounded-full border-4 transition-all duration-1000",
                  isBreathing ? "border-primary" : "border-muted",
                  currentPhaseData.name === 'Einatmen' && isBreathing && "scale-110",
                  currentPhaseData.name === 'Ausatmen' && isBreathing && "scale-90",
                )}
                style={{
                  transform: isBreathing ? 
                    (currentPhaseData.name === 'Einatmen' ? 'scale(1.1)' : 
                     currentPhaseData.name === 'Ausatmen' ? 'scale(0.9)' : 'scale(1)') 
                    : 'scale(1)',
                }}
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-2xl font-bold">{currentPhaseData.name}</p>
                <p className="text-4xl font-mono">
                  {currentPhaseData.duration - breathingTimer}
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Runde {breathingRound + 1} / {totalRounds}
                </p>
              </div>
            </div>

            <p className="text-center text-muted-foreground">
              {currentPhaseData.instruction}
            </p>

            <Progress value={phaseProgress} className="h-2" />

            <div className="flex justify-center gap-3">
              {!isBreathing ? (
                <Button onClick={() => setIsBreathing(true)} size="lg">
                  <Play className="h-4 w-4 mr-2" />
                  Start
                </Button>
              ) : (
                <Button onClick={() => setIsBreathing(false)} variant="outline" size="lg">
                  <Pause className="h-4 w-4 mr-2" />
                  Pause
                </Button>
              )}
              <Button 
                variant="ghost" 
                onClick={() => {
                  setIsBreathing(false);
                  setBreathingRound(0);
                  setBreathingPhase(0);
                  setBreathingTimer(0);
                }}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>

            <Button variant="outline" className="w-full" onClick={handleComplete}>
              Beenden & Speichern
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Visualization
  if (activeSession === 'visualization') {
    return (
      <div className="container max-w-lg py-8">
        <Card className="glass-card">
          <CardHeader className="text-center">
            <CardTitle className="flex items-center justify-center gap-2">
              <Eye className="h-6 w-6 text-purple-500" />
              Visualisierung
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {!selectedTheme ? (
              <>
                <p className="text-center text-muted-foreground">
                  Wähle ein Entspannungsbild:
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {VISUALIZATION_THEMES.map(theme => (
                    <Button
                      key={theme.id}
                      variant="outline"
                      className="h-auto py-4 flex-col gap-2"
                      onClick={() => setSelectedTheme(theme.id)}
                    >
                      <theme.icon className="h-8 w-8" />
                      <span>{theme.name}</span>
                    </Button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="text-center space-y-4">
                  {VISUALIZATION_THEMES.find(t => t.id === selectedTheme)?.icon && (
                    <div className="w-24 h-24 mx-auto rounded-full bg-primary/20 flex items-center justify-center">
                      {(() => {
                        const Icon = VISUALIZATION_THEMES.find(t => t.id === selectedTheme)!.icon;
                        return <Icon className="h-12 w-12 text-primary" />;
                      })()}
                    </div>
                  )}
                  <p className="text-lg">
                    {VISUALIZATION_THEMES.find(t => t.id === selectedTheme)?.description}
                  </p>
                  <p className="text-3xl font-mono">
                    {formatTime(visualizationTimer)} / {formatTime(visualizationDuration)}
                  </p>
                  <Progress value={(visualizationTimer / visualizationDuration) * 100} className="h-2" />
                </div>

                <div className="flex justify-center gap-3">
                  {!isVisualizing ? (
                    <Button onClick={() => setIsVisualizing(true)} size="lg">
                      <Play className="h-4 w-4 mr-2" />
                      Start
                    </Button>
                  ) : (
                    <Button onClick={() => setIsVisualizing(false)} variant="outline" size="lg">
                      <Pause className="h-4 w-4 mr-2" />
                      Pause
                    </Button>
                  )}
                </div>
              </>
            )}

            <Button variant="outline" className="w-full" onClick={handleComplete}>
              Beenden & Speichern
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Checklist
  if (activeSession === 'checklist') {
    const groupedItems = EXAM_CHECKLIST.reduce((acc, item) => {
      if (!acc[item.category]) acc[item.category] = [];
      acc[item.category].push(item);
      return acc;
    }, {} as Record<string, typeof EXAM_CHECKLIST>);

    return (
      <div className="container max-w-lg py-8">
        <Card className="glass-card">
          <CardHeader className="text-center">
            <CardTitle className="flex items-center justify-center gap-2">
              <ListChecks className="h-6 w-6 text-green-500" />
              Prüfungs-Checkliste
            </CardTitle>
            <CardDescription>
              {checkedItems.size} / {EXAM_CHECKLIST.length} erledigt
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Progress 
              value={(checkedItems.size / EXAM_CHECKLIST.length) * 100} 
              className="h-2" 
            />

            {Object.entries(groupedItems).map(([category, items]) => (
              <div key={category}>
                <h3 className="font-medium mb-3">{category}</h3>
                <div className="space-y-2">
                  {items.map(item => (
                    <div
                      key={item.id}
                      className={cn(
                        "flex items-start gap-3 p-3 rounded-lg border transition-all",
                        checkedItems.has(item.id) ? "bg-green-500/10 border-green-500/30" : "bg-muted/50"
                      )}
                    >
                      <Checkbox
                        checked={checkedItems.has(item.id)}
                        onCheckedChange={(checked) => {
                          const newItems = new Set(checkedItems);
                          if (checked) {
                            newItems.add(item.id);
                          } else {
                            newItems.delete(item.id);
                          }
                          setCheckedItems(newItems);
                        }}
                      />
                      <span className={cn(
                        "text-sm",
                        checkedItems.has(item.id) && "line-through text-muted-foreground"
                      )}>
                        {item.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <Button 
              className="w-full" 
              onClick={handleComplete}
              disabled={checkedItems.size < EXAM_CHECKLIST.length / 2}
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Checkliste abschließen
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Quick Calm
  if (activeSession === 'quick_calm') {
    const currentStep = QUICK_CALM_STEPS[quickCalmStep];
    const stepProgress = (quickCalmTimer / currentStep.duration) * 100;

    return (
      <div className="container max-w-lg py-8">
        <Card className="glass-card">
          <CardHeader className="text-center">
            <CardTitle className="flex items-center justify-center gap-2">
              <Zap className="h-6 w-6 text-yellow-500" />
              Sofort-Beruhigung
            </CardTitle>
            <CardDescription>
              Schritt {quickCalmStep + 1} von {QUICK_CALM_STEPS.length}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            <div className="text-center space-y-4">
              <p className="text-4xl font-bold">{currentStep.title}</p>
              <p className="text-lg text-muted-foreground">
                {currentStep.instruction}
              </p>
              <p className="text-2xl font-mono">
                {currentStep.duration - quickCalmTimer}s
              </p>
            </div>

            <Progress value={stepProgress} className="h-2" />

            <div className="flex justify-center gap-3">
              {!isQuickCalm ? (
                <Button onClick={() => setIsQuickCalm(true)} size="lg">
                  <Play className="h-4 w-4 mr-2" />
                  Start
                </Button>
              ) : (
                <Button onClick={() => setIsQuickCalm(false)} variant="outline" size="lg">
                  <Pause className="h-4 w-4 mr-2" />
                  Pause
                </Button>
              )}
            </div>

            {/* Step indicators */}
            <div className="flex justify-center gap-2">
              {QUICK_CALM_STEPS.map((_, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "w-3 h-3 rounded-full",
                    idx < quickCalmStep ? "bg-primary" :
                    idx === quickCalmStep ? "bg-primary/50" : "bg-muted"
                  )}
                />
              ))}
            </div>

            <Button variant="outline" className="w-full" onClick={handleComplete}>
              Beenden
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}
