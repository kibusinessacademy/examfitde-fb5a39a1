import { Card, CardContent } from '@/components/ui/card';
import { useReadinessScore } from '@/hooks/useAdaptiveLearning';
import { AlertTriangle, Clock, RotateCcw, Frown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RiskCostWidgetProps {
  curriculumId: string;
}

export function RiskCostWidget({ curriculumId }: RiskCostWidgetProps) {
  const { data: readiness } = useReadinessScore(curriculumId);

  const score = readiness?.overall_readiness || 0;
  const failRisk = Math.max(0, Math.min(100, Math.round(100 - score * 1.1)));
  const weakAreas = readiness?.weak_areas || [];
  const worstArea = weakAreas[0];

  if (score >= 85) return null; // No risk to show

  const isHighRisk = failRisk > 50;

  return (
    <Card className={cn(
      'glass-card border-l-4 overflow-hidden',
      isHighRisk ? 'border-l-destructive' : 'border-l-warning'
    )}>
      <CardContent className="p-5">
        <div className="flex items-start gap-4">
          <div className={cn(
            'p-2.5 rounded-xl flex-shrink-0',
            isHighRisk ? 'bg-destructive-bg-subtle' : 'bg-warning-bg-subtle'
          )}>
            <AlertTriangle className={cn('h-5 w-5', isHighRisk ? 'text-destructive' : 'text-warning')} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-display font-bold text-sm mb-1">
              Was kostet dich dein Nicht-Wissen?
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              Wenn du <span className="font-semibold text-foreground">jetzt</span> in die Prüfung gehst,
              besteht eine <span className={cn('font-bold', isHighRisk ? 'text-destructive' : 'text-warning')}>{failRisk}%</span> Wahrscheinlichkeit,
              {worstArea ? (
                <> dass du den Bereich <span className="font-semibold text-foreground">„{worstArea.title}"</span> nicht bestehst.</>
              ) : (
                <> dass du kritische Teilbereiche nicht bestehst.</>
              )}
            </p>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                ~6 Monate Wartezeit bei Durchfall
              </span>
              <span className="flex items-center gap-1">
                <RotateCcw className="h-3.5 w-3.5" />
                Wiederholungsprüfung nötig
              </span>
              <span className="flex items-center gap-1">
                <Frown className="h-3.5 w-3.5" />
                Stress vermeidbar
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
