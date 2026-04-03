import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAdaptiveRecommendation } from '@/hooks/useAdaptiveLearning';
import { Loader2, Sparkles, BookOpen, Target, Mic, Brain, ArrowRight, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTerminology } from '@/hooks/useProgramType';

interface NextBestActionProps {
  curriculumId: string;
}

export function NextBestAction({ curriculumId }: NextBestActionProps) {
  const { data: recommendation, isLoading } = useAdaptiveRecommendation(curriculumId);
  const { t } = useTerminology(curriculumId);

  const ACTION_CONFIG = {
    DIAGNOSTIC: { icon: Sparkles, label: 'Diagnosetest starten', accent: 'from-purple-500 to-indigo-600' },
    COURSE: { icon: BookOpen, label: t('examUnit'), accent: 'from-primary to-secondary' },
    SIMULATION: { icon: Target, label: t('examSimStart'), accent: 'from-accent to-green-500' },
    ORAL_TRAINER: { icon: Mic, label: 'Mündlich üben', accent: 'from-blue-500 to-cyan-500' },
    WEAKNESS_MODE: { icon: Brain, label: 'Schwächenmodus starten', accent: 'from-orange-500 to-red-500' },
    CONTINUE: { icon: ArrowRight, label: 'Weiter trainieren', accent: 'from-primary to-accent' },
  };

  if (isLoading) {
    return (
      <Card className="glass-card">
        <CardContent className="p-6 flex items-center justify-center min-h-[100px]">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!recommendation) return null;

  const config = ACTION_CONFIG[recommendation.action] || ACTION_CONFIG.CONTINUE;
  const Icon = config.icon;

  return (
    <Card className="glass-card border-primary/30 overflow-hidden">
      <CardContent className="p-0">
        <div className="flex items-stretch">
          <div className={cn('w-1.5 bg-gradient-to-b', config.accent)} />

          <div className="flex-1 p-5">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                Dein nächster Schritt
              </span>
            </div>

            <div className="flex items-center gap-4">
              <div className={cn('p-3 rounded-xl bg-gradient-to-br text-white flex-shrink-0', config.accent)}>
                <Icon className="h-6 w-6" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-muted-foreground mb-2">{recommendation.reason}</p>
                <Link to={recommendation.route}>
                  <Button className="gradient-primary text-primary-foreground shadow-glow-sm">
                    {config.label}
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
