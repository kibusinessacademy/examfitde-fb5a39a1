import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, AlertCircle, Clock, Target, Play, BookOpen, Brain } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';

interface ExamBlueprint {
  id: string;
  title: string;
  description: string | null;
  total_questions: number;
  time_limit_minutes: number;
  pass_threshold: number;
  difficulty_distribution: {
    easy: number;
    medium: number;
    hard: number;
  };
}

export type ExamMode = 'simulation' | 'practice' | 'timed_exam' | 'adaptive';

interface BlueprintSelectorProps {
  blueprints: ExamBlueprint[] | undefined;
  isLoading: boolean;
  onSelect: (blueprintId: string, mode: ExamMode) => void;
}

export function BlueprintSelector({ blueprints, isLoading, onSelect }: BlueprintSelectorProps) {
  const [selectedMode, setSelectedMode] = useState<ExamMode>('simulation');
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  
  if (!blueprints?.length) {
    return (
      <Card className="glass-card max-w-lg mx-auto">
        <CardContent className="pt-6 text-center">
          <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">Keine Prüfungen verfügbar</h3>
          <p className="text-muted-foreground">
            Es sind derzeit keine freigegebenen Prüfungssimulationen verfügbar.
            Prüfungen erscheinen hier erst, wenn sie vollständig produziert und freigegeben wurden.
          </p>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="text-center">
        <h1 className="text-2xl font-display font-bold mb-2">Prüfungssimulation</h1>
        <p className="text-muted-foreground">
          Wähle eine Prüfung und den Modus
        </p>
      </div>
      
      {/* Mode Selection */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">Modus wählen</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            {([
              { 
                value: 'simulation' as const, 
                label: 'Simulation', 
                desc: 'Ohne Zeitdruck, mit Feedback nach jeder Frage',
                icon: BookOpen
              },
              { 
                value: 'practice' as const, 
                label: 'Übungsmodus', 
                desc: 'Zeigt Erklärungen sofort an',
                icon: Target
              },
              { 
                value: 'timed_exam' as const, 
                label: 'Prüfungsmodus', 
                desc: 'Mit Zeitlimit wie in der echten Prüfung',
                icon: Clock
              },
              {
                value: 'adaptive' as const,
                label: 'Adaptive Übung (IRT)',
                desc: 'Fragen passen sich deinem Können an – echte CAT-Logik',
                icon: Brain
              },
            ] satisfies { value: ExamMode; label: string; desc: string; icon: typeof BookOpen }[]).map(mode => (
              <button
                key={mode.value}
                onClick={() => setSelectedMode(mode.value)}
                className={cn(
                  "flex items-center gap-4 p-4 rounded-xl border text-left transition-all",
                  selectedMode === mode.value 
                    ? "border-primary bg-primary/5" 
                    : "border-border hover:border-primary/50"
                )}
              >
                <mode.icon className={cn(
                  "h-6 w-6",
                  selectedMode === mode.value ? "text-primary" : "text-muted-foreground"
                )} />
                <div>
                  <div className="font-medium">{mode.label}</div>
                  <div className="text-sm text-muted-foreground">{mode.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
      
      {/* Blueprint Selection */}
      <div className="grid gap-4">
        {blueprints.map(blueprint => (
          <Card key={blueprint.id} className="glass-card hover:border-primary/50 transition-all">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle>{blueprint.title}</CardTitle>
                  {blueprint.description && (
                    <CardDescription className="mt-1">
                      {blueprint.description}
                    </CardDescription>
                  )}
                </div>
                <Badge variant="secondary">{blueprint.total_questions} Fragen</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  {blueprint.time_limit_minutes} Minuten
                </div>
                <div className="flex items-center gap-1">
                  <Target className="h-4 w-4" />
                  {(blueprint.pass_threshold * 100).toFixed(0)}% zum Bestehen
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Badge variant="outline" className="text-xs">
                  {(blueprint.difficulty_distribution.easy * 100).toFixed(0)}% Leicht
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {(blueprint.difficulty_distribution.medium * 100).toFixed(0)}% Mittel
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {(blueprint.difficulty_distribution.hard * 100).toFixed(0)}% Schwer
                </Badge>
              </div>
            </CardContent>
            <CardFooter>
              <Button 
                className="w-full" 
                onClick={() => onSelect(blueprint.id, selectedMode)}
              >
                <Play className="h-4 w-4 mr-2" />
                Prüfung starten
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
