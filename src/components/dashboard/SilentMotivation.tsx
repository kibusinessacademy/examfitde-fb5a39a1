import { useReadinessScore } from '@/hooks/useAdaptiveLearning';
import { useDashboardStats } from '@/hooks/useDashboardStats';
import { cn } from '@/lib/utils';

interface SilentMotivationProps {
  curriculumId: string;
}

export function SilentMotivation({ curriculumId }: SilentMotivationProps) {
  const { data: readiness } = useReadinessScore(curriculumId);
  const { data: stats } = useDashboardStats();

  const score = readiness?.overall_readiness || 0;
  const successRate = stats?.success_rate ?? 0;
  const weakCount = readiness?.weak_areas?.length ?? 0;

  const getMessage = (): { text: string; tone: 'neutral' | 'positive' | 'push' } | null => {
    if (score >= 80) {
      return { text: 'Du bist jetzt über dem Durchschnitt der Prüflinge.', tone: 'positive' };
    }
    if (successRate >= 75 && weakCount <= 2) {
      return { text: `Noch ${weakCount} kritische Lücken – dann grün.`, tone: 'push' };
    }
    if (score >= 50) {
      return { text: 'Diese Kompetenz-Stufe trennt Besteher von Durchfallern.', tone: 'neutral' };
    }
    return null;
  };

  const message = getMessage();
  if (!message) return null;

  return (
    <div className={cn(
      'text-center py-2 px-4 text-xs rounded-lg',
      message.tone === 'positive' && 'bg-green-500/10 text-green-700 dark:text-green-400',
      message.tone === 'push' && 'bg-primary/10 text-primary',
      message.tone === 'neutral' && 'bg-muted text-muted-foreground',
    )}>
      {message.text}
    </div>
  );
}
