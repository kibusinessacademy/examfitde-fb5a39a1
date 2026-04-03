import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useReadinessScore } from '@/hooks/useAdaptiveLearning';
import { AlertTriangle, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTerminology } from '@/hooks/useProgramType';

interface ExamTrapsWidgetProps {
  curriculumId: string;
}

export function ExamTrapsWidget({ curriculumId }: ExamTrapsWidgetProps) {
  const { data: readiness } = useReadinessScore(curriculumId);
  const { t } = useTerminology(curriculumId);

  const weakAreas = readiness?.weak_areas || [];
  if (weakAreas.length === 0) return null;

  const traps = weakAreas.slice(0, 3).map((area, idx) => {
    const riskLevel = area.score < 30 ? 'hoch' : area.score < 60 ? 'mittel' : 'niedrig';
    return {
      id: area.competency_id,
      title: area.title,
      failPercent: Math.round(Math.max(20, 100 - area.score)),
      insight: idx === 0
        ? `Dein schwächster Bereich – Risiko: ${riskLevel}`
        : idx === 1
        ? t('examTrapInsight')
        : t('examTermsExpected'),
    };
  });

  return (
    <Card className="glass-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-display flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-orange-500" />
          {t('examTraps')}
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
          {t('examTrapsFooter')}
        </p>
      </CardContent>
    </Card>
  );
}
