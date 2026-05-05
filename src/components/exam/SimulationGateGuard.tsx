import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSimulationGate, type WeakCompetency } from '@/hooks/useExamReadiness';
import { Lock, AlertTriangle, BookOpen, ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SimulationGateGuardProps {
  curriculumId: string;
  children: React.ReactNode;
}

export function SimulationGateGuard({ curriculumId, children }: SimulationGateGuardProps) {
  const { data: gate, isLoading } = useSimulationGate(curriculumId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // If no gate data or allowed, render children
  if (!gate || gate.allowed) {
    return <>{children}</>;
  }

  // Blocked – show gate screen
  const weakComps = (gate.weak_competencies || []) as WeakCompetency[];

  return (
    <div className="container max-w-2xl py-12">
      <Card className="glass-card border-destructive/30">
        <CardContent className="p-8 text-center">
          <div className="w-20 h-20 rounded-full bg-destructive-bg-subtle flex items-center justify-center mx-auto mb-6">
            <Lock className="h-10 w-10 text-destructive" />
          </div>

          <h2 className="text-2xl font-display font-bold mb-3">
            Simulation noch nicht freigeschaltet
          </h2>

          <p className="text-muted-foreground mb-6">
            {gate.blocked_reason || 'Du musst zuerst offene Schwächen nachtrainieren.'}
          </p>

          {/* Weak competencies list */}
          {weakComps.length > 0 && (
            <div className="text-left mb-6">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-orange-500" />
                Diese Kompetenzen brauchen Training:
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

          <div className="flex gap-3">
            <Link to="/courses" className="flex-1">
              <Button className="w-full gradient-primary text-primary-foreground gap-2">
                <BookOpen className="h-4 w-4" />
                Jetzt nachtrainieren
              </Button>
            </Link>
            <Link to="/dashboard" className="flex-1">
              <Button variant="outline" className="w-full gap-2">
                Zum Dashboard
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
