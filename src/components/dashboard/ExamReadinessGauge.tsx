import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useExamReadiness } from '@/hooks/useExamReadiness';
import { Loader2, ShieldCheck, ShieldAlert, Shield, AlertTriangle, CheckCircle2, Lock, Target, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTerminology } from '@/hooks/useProgramType';

interface ExamReadinessGaugeProps {
  curriculumId: string;
}

export function ExamReadinessGauge({ curriculumId }: ExamReadinessGaugeProps) {
  const { data: readiness, isLoading } = useExamReadiness(curriculumId);
  const { t } = useTerminology(curriculumId);

  if (isLoading) {
    return (
      <Card className="glass-card">
        <CardContent className="p-6 flex items-center justify-center min-h-[200px]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!readiness) return null;

  const { readiness_level, overall_readiness, mastery_score, simulation_score, mastered_count, partial_count, not_mastered_count, total_competencies, simulation_allowed, active_weakness_count } = readiness;

  const config = readiness_level === 'ready'
    ? { icon: ShieldCheck, color: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500/30', label: t('examReadyFull'), ring: 'text-green-500' }
    : readiness_level === 'almost_ready'
    ? { icon: Shield, color: 'text-yellow-500', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', label: t('almostReady'), ring: 'text-yellow-500' }
    : { icon: ShieldAlert, color: 'text-orange-500', bg: 'bg-orange-500/10', border: 'border-orange-500/30', label: t('notReady'), ring: 'text-orange-500' };

  const Icon = config.icon;

  return (
    <Card className={cn('glass-card overflow-hidden', config.border)}>
      <CardHeader className={cn('pb-2', config.bg)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-display flex items-center gap-2">
            <Icon className={cn('h-5 w-5', config.color)} />
            {t('examReadinessScore')}
          </CardTitle>
          <Badge variant="outline" className={cn('gap-1', config.color)}>
            {config.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-6 pt-4">
        <div className="text-center mb-6">
          <div className="relative inline-flex items-center justify-center">
            <svg className="w-36 h-36 transform -rotate-90">
              <circle cx="72" cy="72" r="60" fill="none" stroke="currentColor" strokeWidth="10" className="text-muted/20" />
              <circle cx="72" cy="72" r="60" fill="none" stroke="currentColor" strokeWidth="10"
                strokeDasharray={`${(overall_readiness / 100) * 377} 377`}
                strokeLinecap="round"
                className={config.ring}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-4xl font-display font-bold">{Math.round(overall_readiness)}%</span>
              <span className="text-xs text-muted-foreground">Gesamt</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <div className="text-xl font-bold text-primary">{Math.round(mastery_score)}%</div>
            <div className="text-xs text-muted-foreground">Kurs-Mastery</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <div className="text-xl font-bold text-primary">{Math.round(simulation_score)}%</div>
            <div className="text-xs text-muted-foreground">Sim.-Ergebnis</div>
          </div>
        </div>

        <div className="space-y-2 mb-5">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
              Gemeistert
            </span>
            <span className="font-medium">{mastered_count} / {total_competencies}</span>
          </div>
          <Progress value={total_competencies > 0 ? (mastered_count / total_competencies) * 100 : 0} className="h-2" />
          
          {partial_count > 0 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Teilweise</span>
              <span>{partial_count}</span>
            </div>
          )}
          {not_mastered_count > 0 && (
            <div className="flex items-center justify-between text-sm text-destructive">
              <span className="flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" />
                Nicht bestanden
              </span>
              <span className="font-medium">{not_mastered_count}</span>
            </div>
          )}
        </div>

        <div className="mt-5">
          {simulation_allowed ? (
            <Link to="/exam-simulation">
              <Button className="w-full gradient-primary text-primary-foreground shadow-glow-sm gap-2">
                <Target className="h-4 w-4" />
                Simulation starten
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          ) : (
            <div className="space-y-2">
              <Button className="w-full gap-2" disabled variant="outline">
                <Lock className="h-4 w-4" />
                Simulation gesperrt
              </Button>
              <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/5 text-sm text-muted-foreground">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                  <div>
                    {not_mastered_count > 0 && <p>{not_mastered_count} Kompetenzen nachtrainieren</p>}
                    {active_weakness_count > 0 && <p>{active_weakness_count} offene Schwächen beheben</p>}
                    {not_mastered_count === 0 && active_weakness_count === 0 && <p>Trainiere weiter, um die Simulation freizuschalten</p>}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
