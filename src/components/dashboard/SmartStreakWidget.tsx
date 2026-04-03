import { Card, CardContent } from '@/components/ui/card';
import { useDashboardStats } from '@/hooks/useDashboardStats';
import { Flame, Clock, Brain } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SmartStreakWidgetProps {
  curriculumId?: string;
}

export function SmartStreakWidget({ curriculumId }: SmartStreakWidgetProps) {
  const { data: stats } = useDashboardStats();
  // Import dynamically to avoid circular deps – terminology is optional here
  const { useTerminology } = require('@/hooks/useProgramType');
  const { t } = useTerminology(curriculumId);

  const streak = stats?.streak ?? 0;
  const questionsToday = stats?.questions_answered ?? 0;
  const successRate = stats?.success_rate ?? 0;

  const getStreakMessage = () => {
    if (streak >= 7) return 'Dein Langzeitgedächtnis profitiert maximal von dieser Regelmäßigkeit.';
    if (streak >= 3) return 'Dein Gehirn bildet gerade stabile Verknüpfungen – weiter so.';
    if (streak === 1) return 'Guter Start – ein zweiter Tag in Folge verdoppelt die Wirkung.';
    return t('streakMotivation');
  };

  const getTimeInsight = () => {
    if (questionsToday > 20) return 'Optimale Trainingsintensität erkannt';
    if (questionsToday > 0) return `Heute ${questionsToday} Fragen – guter Lernslot`;
    return 'Noch kein Training heute – 10 Min reichen';
  };

  return (
    <Card className="glass-card">
      <CardContent className="p-5">
        <div className="flex items-center gap-4 mb-4">
          <div className={cn(
            'p-2.5 rounded-xl flex-shrink-0',
            streak >= 3 ? 'bg-orange-500/10' : 'bg-muted'
          )}>
            <Flame className={cn('h-5 w-5', streak >= 3 ? 'text-orange-500' : 'text-muted-foreground')} />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className={cn(
                'text-3xl font-display font-bold',
                streak >= 7 ? 'text-orange-500' : streak >= 3 ? 'text-yellow-500' : 'text-foreground'
              )}>
                {streak}
              </span>
              <span className="text-sm text-muted-foreground">Tage in Folge</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {streak > 0 && t('examRelevance')}
            </p>
          </div>
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center gap-2.5 text-sm">
            <Brain className="h-4 w-4 text-primary flex-shrink-0" />
            <span className="text-muted-foreground">{getStreakMessage()}</span>
          </div>
          <div className="flex items-center gap-2.5 text-sm">
            <Clock className="h-4 w-4 text-accent flex-shrink-0" />
            <span className="text-muted-foreground">{getTimeInsight()}</span>
          </div>
          {successRate > 0 && (
            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-xs text-muted-foreground">
                Aktuelle Trefferquote: <span className="font-semibold text-foreground">{Math.round(successRate)}%</span>
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
