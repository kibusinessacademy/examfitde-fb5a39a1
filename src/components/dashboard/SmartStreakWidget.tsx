import { Card, CardContent } from '@/components/ui/card';
import { useDashboardStats } from '@/hooks/useDashboardStats';
import { Flame, Clock, Brain, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useTerminology } from '@/hooks/useProgramType';
import { motion } from 'framer-motion';

interface SmartStreakWidgetProps {
  curriculumId?: string;
}

export function SmartStreakWidget({ curriculumId }: SmartStreakWidgetProps) {
  const { data: stats } = useDashboardStats();
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

  const streakLevel = streak >= 7 ? 'fire' : streak >= 3 ? 'warm' : 'cold';

  return (
    <Card className="glass-card overflow-hidden">
      <div className={cn(
        "absolute inset-0 pointer-events-none",
        streakLevel === 'fire' ? 'bg-gradient-to-br from-orange-500/5 to-transparent' :
        streakLevel === 'warm' ? 'bg-gradient-to-br from-yellow-500/5 to-transparent' : ''
      )} />
      <CardContent className="relative p-5">
        <div className="flex items-center gap-4 mb-4">
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            className={cn(
              'p-3 rounded-2xl flex-shrink-0',
              streakLevel === 'fire' ? 'bg-orange-500/10' : streakLevel === 'warm' ? 'bg-yellow-500/10' : 'bg-muted'
            )}
          >
            <Flame className={cn('h-6 w-6', streakLevel === 'fire' ? 'text-orange-500' : streakLevel === 'warm' ? 'text-yellow-500' : 'text-muted-foreground')} />
          </motion.div>
          <div>
            <div className="flex items-baseline gap-2">
              <motion.span
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 200 }}
                className={cn(
                  'text-3xl font-display font-bold',
                  streakLevel === 'fire' ? 'text-orange-500' : streakLevel === 'warm' ? 'text-yellow-500' : 'text-foreground'
                )}
              >
                {streak}
              </motion.span>
              <span className="text-sm text-muted-foreground">Tage in Folge</span>
              {streak >= 7 && (
                <Badge className="bg-orange-500/10 text-orange-600 border-orange-500/20 text-xs ml-1">
                  <Zap className="h-3 w-3 mr-0.5" /> Max
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {streak > 0 && t('examRelevance')}
            </p>
          </div>
        </div>

        <div className="space-y-2.5">
          <motion.div
            initial={{ x: -8, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="flex items-center gap-2.5 text-sm"
          >
            <Brain className="h-4 w-4 text-primary flex-shrink-0" />
            <span className="text-muted-foreground">{getStreakMessage()}</span>
          </motion.div>
          <motion.div
            initial={{ x: -8, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="flex items-center gap-2.5 text-sm"
          >
            <Clock className="h-4 w-4 text-accent flex-shrink-0" />
            <span className="text-muted-foreground">{getTimeInsight()}</span>
          </motion.div>
          {successRate > 0 && (
            <motion.div
              initial={{ y: 5, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="mt-3 pt-3 border-t border-border"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Aktuelle Trefferquote</p>
                <span className="text-sm font-bold text-foreground">{Math.round(successRate)}%</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full mt-1.5 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${successRate}%` }}
                  transition={{ delay: 0.5, duration: 0.8, ease: 'easeOut' }}
                  className="h-full bg-primary rounded-full"
                />
              </div>
            </motion.div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
