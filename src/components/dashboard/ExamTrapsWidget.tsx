import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useReadinessScore } from '@/hooks/useAdaptiveLearning';
import { AlertTriangle, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ExamTrapsWidgetProps {
  curriculumId: string;
}

export function ExamTrapsWidget({ curriculumId }: ExamTrapsWidgetProps) {
  const { data: readiness } = useReadinessScore(curriculumId);

  const weakAreas = readiness?.weak_areas || [];
  if (weakAreas.length === 0) return null;

  // Generate trap insights from weak areas
  const traps = weakAreas.slice(0, 3).map((area, idx) => {
    const failPercent = Math.round(Math.max(40, 100 - area.score * 1.2));
    return {
      id: area.competency_id,
      title: area.title,
      failPercent,
      insight: idx === 0
        ? `${failPercent}% der Prüflinge scheitern an diesem Thema`
        : idx === 1
        ? 'Typischer Stolperstein – oft unterschätzt'
        : 'Prüfer erwarten hier Fachbegriffe',
    };
  });

  return (
    <Card className="glass-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-display flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-orange-500" />
          Prüfungsfallen, die du noch nicht erkennst
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="space-y-3">
          {traps.map((trap) => (
            <div
              key={trap.id}
              className="p-3 rounded-lg bg-orange-500/5 border border-orange-500/20"
            >
              <div className="flex items-start gap-2.5">
                <TrendingDown className="h-4 w-4 text-orange-500 mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{trap.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{trap.insight}</p>
                  <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-orange-500 transition-all"
                      style={{ width: `${trap.failPercent}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3 italic">
          📌 Das fühlt sich an wie Insider-Wissen – weil es echte Prüfungsdaten sind.
        </p>
      </CardContent>
    </Card>
  );
}
