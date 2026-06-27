import { Link } from 'react-router-dom';
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSimulationGate, type WeakCompetency } from '@/hooks/useExamReadiness';
import { AlertTriangle, BookOpen, ArrowRight, Loader2, Sparkles } from 'lucide-react';

interface SimulationGateGuardProps {
  curriculumId: string;
  children: React.ReactNode;
}

/**
 * SimulationGateGuard
 *
 * Soft-Recommendation-Gate (LIF/Unlock-Policy):
 *  - Hardlock NUR Paywall (wird woanders erzwungen).
 *  - Pädagogische Empfehlung ("noch nicht freigeschaltet") wird zur
 *    sichtbaren Empfehlung mit "Trotzdem starten" — Lernende dürfen ihre
 *    Lernreise nie sackgassenartig blockiert sehen.
 */
export function SimulationGateGuard({ curriculumId, children }: SimulationGateGuardProps) {
  const { data: gate, isLoading } = useSimulationGate(curriculumId);
  const [bypassed, setBypassed] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!gate || gate.allowed || bypassed) {
    return (
      <>
        {gate && !gate.allowed && bypassed && (
          <div className="container max-w-3xl pt-6">
            <Card className="glass-card border-warning/30 bg-warning-bg-subtle/30 mb-4">
              <CardContent className="p-3 text-xs text-muted-foreground flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-warning" />
                Du startest die Simulation ohne empfohlenes Training. Ergebnisse sind weiterhin gültig — nutze die Auswertung zum gezielten Nachschärfen.
              </CardContent>
            </Card>
          </div>
        )}
        {children}
      </>
    );
  }

  const weakComps = (gate.weak_competencies || []) as WeakCompetency[];

  return (
    <div className="container max-w-2xl py-12">
      <Card className="glass-card border-warning/40">
        <CardContent className="p-8">
          <div className="flex items-start gap-4 mb-6">
            <div className="w-14 h-14 rounded-2xl bg-warning-bg-subtle flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="h-7 w-7 text-warning" />
            </div>
            <div className="flex-1">
              <Badge variant="outline" className="mb-2 border-warning/40 text-warning bg-warning-bg-subtle/60">
                Empfehlung
              </Badge>
              <h2 className="text-2xl font-display font-bold mb-2">
                Wir empfehlen, vorher noch zu trainieren
              </h2>
              <p className="text-muted-foreground">
                {gate.blocked_reason || 'Es gibt offene Schwächen, die deine Simulation realistisch verzerren können.'} Du kannst die Simulation aber trotzdem starten.
              </p>
            </div>
          </div>

          {weakComps.length > 0 && (
            <div className="text-left mb-6">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" />
                Diese Kompetenzen würden wir vorher schärfen:
              </h3>
              <div className="space-y-2">
                {weakComps.slice(0, 8).map((c) => (
                  <div key={c.competency_id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border text-sm">
                    <span className="truncate">{c.title}</span>
                    <Badge variant={c.status === 'not_mastered' ? 'destructive' : 'secondary'} className="ml-2 flex-shrink-0">
                      {c.score}%
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              className="flex-1 gap-2"
              variant="default"
              onClick={() => setBypassed(true)}
              data-testid="simulation-gate-bypass"
            >
              Trotzdem Simulation starten
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Link to="/courses" className="flex-1">
              <Button variant="outline" className="w-full gap-2">
                <BookOpen className="h-4 w-4" />
                Schwächen trainieren
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
