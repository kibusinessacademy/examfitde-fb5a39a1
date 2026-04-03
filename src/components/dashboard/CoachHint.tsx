import { Card, CardContent } from '@/components/ui/card';
import { useReadinessScore } from '@/hooks/useAdaptiveLearning';
import { useDashboardStats } from '@/hooks/useDashboardStats';
import { GraduationCap } from 'lucide-react';
import { useTerminology } from '@/hooks/useProgramType';

interface CoachHintProps {
  curriculumId: string;
}

export function CoachHint({ curriculumId }: CoachHintProps) {
  const { data: readiness } = useReadinessScore(curriculumId);
  const { data: stats } = useDashboardStats();
  const { t } = useTerminology(curriculumId);

  const score = readiness?.overall_readiness || 0;
  const streak = stats?.streak ?? 0;
  const successRate = stats?.success_rate ?? 0;
  const weakCount = readiness?.weak_areas?.length ?? 0;

  const getHint = (): string | null => {
    if (streak > 5 && weakCount > 2) {
      return t('coachHintLinear');
    }
    if (successRate > 80 && score < 70) {
      return t('coachHintLowReadiness');
    }
    if (score >= 80) {
      return t('coachHintAlmostReady');
    }
    if (weakCount >= 3) {
      return `Du hast ${weakCount} ${t('coachHintGaps')}`;
    }
    if (streak === 0) {
      return t('coachHintStreak');
    }
    return null;
  };

  const hint = getHint();
  if (!hint) return null;

  return (
    <Card className="glass-card border-primary/20 bg-primary/[0.03]">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-primary/10 flex-shrink-0">
            <GraduationCap className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-primary mb-1">
              {t('examCoach')}
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {hint}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
