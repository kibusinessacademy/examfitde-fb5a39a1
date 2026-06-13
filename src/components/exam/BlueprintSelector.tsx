import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, AlertCircle, Clock, Target, Play, BookOpen, Brain, Briefcase } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { Link } from 'react-router-dom';

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

  // Empty / prerequisite state → single primary CTA to pick a profession
  if (!blueprints?.length) {
    return (
      <Card className="glass-card max-w-lg mx-auto">
        <CardContent className="pt-6 text-center space-y-4">
          <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground" />
          <h1 className="text-xl font-display font-bold">Noch keine Prüfung verfügbar</h1>
          <p className="text-muted-foreground">
            Wähle zuerst deinen Beruf – danach steht deine Prüfungssimulation bereit.
          </p>
          <Button asChild size="lg" className="w-full" data-testid="exam-sim-primary-cta">
            <Link to="/berufe">
              <Briefcase className="h-4 w-4 mr-2" />
              Beruf auswählen
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const primary = blueprints[0];
  const others = blueprints.slice(1);

  return (
    <div className="space-y-8 max-w-2xl mx-auto">
      {/* Hero / Primary CTA */}
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-display font-bold">Prüfungssimulation</h1>
        <p className="text-muted-foreground">
          {primary.title} · {primary.total_questions} Fragen · {primary.time_limit_minutes} Min.
        </p>
      </div>

      <Card className="glass-card border-primary/40 shadow-elev-2">
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center justify-center">
            <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
              Empfohlen für dich
            </Badge>
          </div>
          <p className="text-sm text-center text-muted-foreground">
            Diese Variante passt zu deinem Beruf und deinem aktuellen Lernstand.
          </p>
          <Button
            size="lg"
            className="w-full"
            data-testid="exam-sim-primary-cta"
            onClick={() => onSelect(primary.id, selectedMode)}
          >
            <Play className="h-4 w-4 mr-2" />
            Prüfungssimulation starten
          </Button>
          <p className="text-xs text-center text-muted-foreground">
            Modus: <span className="font-medium text-foreground">{labelForMode(selectedMode)}</span>
            {' · '}{descForMode(selectedMode)}
          </p>
          <div
            className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-xs text-muted-foreground text-center"
            data-testid="exam-sim-post-exam-hint"
          >
            Nach der Simulation erhältst du <span className="font-medium text-foreground">Auswertung</span>,
            erkannte <span className="font-medium text-foreground">Schwächen</span> und deine
            <span className="font-medium text-foreground"> nächste Lernempfehlung</span>.
          </div>
        </CardContent>
      </Card>

      {/* Mode Selection — secondary */}
      <details className="group" data-testid="exam-sim-mode-options">
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
          Modus anpassen — bestimmt, wie streng die Simulation läuft
        </summary>
        <div className="grid gap-3 mt-3">
          {([
            { value: 'simulation' as const, label: 'Realistische Simulation (empfohlen)', desc: 'Wie die echte Prüfung, aber mit Feedback nach jeder Frage — bestes Einstiegssetup.', icon: BookOpen },
            { value: 'practice' as const, label: 'Üben mit Erklärungen', desc: 'Antwort + Erklärung sofort sichtbar. Ideal zum Aufbauen von Sicherheit.', icon: Target },
            { value: 'timed_exam' as const, label: 'Ernstfall mit Zeitlimit', desc: 'Volles Zeitlimit, keine Hinweise — Generalprobe für den Prüfungstag.', icon: Clock },
            { value: 'adaptive' as const, label: 'Adaptive Übung (passt sich an)', desc: 'Fragen werden leichter oder schwerer, je nachdem wie du antwortest.', icon: Brain },
          ]).map(mode => (
            <button
              key={mode.value}
              onClick={() => setSelectedMode(mode.value)}
              className={cn(
                'flex items-center gap-4 p-4 rounded-xl border text-left transition-all',
                selectedMode === mode.value
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              )}
            >
              <mode.icon className={cn('h-6 w-6', selectedMode === mode.value ? 'text-primary' : 'text-muted-foreground')} />
              <div>
                <div className="font-medium">{mode.label}</div>
                <div className="text-sm text-muted-foreground">{mode.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </details>

      {/* Weitere Optionen — tertiary blueprint list */}
      {others.length > 0 && (
        <details className="group" data-testid="exam-sim-other-blueprints">
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
            Weitere Prüfungen ({others.length})
          </summary>
          <div className="grid gap-4 mt-3">
            {others.map(blueprint => (
              <Card key={blueprint.id} className="glass-card">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-base">{blueprint.title}</CardTitle>
                      {blueprint.description && (
                        <CardDescription className="mt-1">{blueprint.description}</CardDescription>
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
                </CardContent>
                <CardFooter>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => onSelect(blueprint.id, selectedMode)}
                  >
                    Diese Variante starten
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function labelForMode(mode: ExamMode): string {
  switch (mode) {
    case 'simulation': return 'Simulation';
    case 'practice': return 'Übungsmodus';
    case 'timed_exam': return 'Prüfungsmodus';
    case 'adaptive': return 'Adaptive Übung';
  }
}
