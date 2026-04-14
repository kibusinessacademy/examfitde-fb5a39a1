import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useExamReadiness } from '@/hooks/useExamReadiness';
import { Loader2, ShieldCheck, ShieldAlert, Shield, AlertTriangle, CheckCircle2, Lock, Target, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTerminology } from '@/hooks/useProgramType';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

interface ExamReadinessGaugeProps {
  curriculumId: string;
}

function AnimatedGaugeRing({ value, color, size = 144 }: { value: number; color: string; size?: number }) {
  const sw = 10;
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const [offset, setOffset] = useState(circ);

  useEffect(() => {
    const t = setTimeout(() => setOffset(circ - (value / 100) * circ), 200);
    return () => clearTimeout(t);
  }, [value, circ]);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={sw} opacity={0.2} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.3, type: 'spring', stiffness: 200 }}
          className="text-4xl font-display font-bold"
        >{Math.round(value)}%</motion.span>
        <span className="text-xs text-muted-foreground">Gesamt</span>
      </div>
    </div>
  );
}

export function ExamReadinessGauge({ curriculumId }: ExamReadinessGaugeProps) {
  const { data: readiness, isLoading } = useExamReadiness(curriculumId);
  const { t } = useTerminology(curriculumId);

  if (isLoading) {
    return (
      <Card className="glass-card">
        <CardContent className="p-6 flex items-center justify-center min-h-[200px]">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="text-xs text-muted-foreground">Readiness wird berechnet…</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!readiness) return null;

  const { readiness_level, overall_readiness, mastery_score, simulation_score, mastered_count, partial_count, not_mastered_count, total_competencies, simulation_allowed, active_weakness_count } = readiness;

  const config = readiness_level === 'ready'
    ? { icon: ShieldCheck, color: 'hsl(142, 71%, 45%)', tokenColor: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500/30', label: t('examReadyFull') }
    : readiness_level === 'almost_ready'
    ? { icon: Shield, color: 'hsl(45, 93%, 47%)', tokenColor: 'text-yellow-500', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', label: t('almostReady') }
    : { icon: ShieldAlert, color: 'hsl(25, 95%, 53%)', tokenColor: 'text-orange-500', bg: 'bg-orange-500/10', border: 'border-orange-500/30', label: t('notReady') };

  const Icon = config.icon;

  return (
    <Card className={cn('glass-card overflow-hidden', config.border)}>
      <CardHeader className={cn('pb-2', config.bg)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-display flex items-center gap-2">
            <Icon className={cn('h-5 w-5', config.tokenColor)} />
            {t('examReadinessScore')}
          </CardTitle>
          <Badge variant="outline" className={cn('gap-1', config.tokenColor)}>
            {config.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-6 pt-4">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-6"
        >
          <div className="inline-flex">
            <AnimatedGaugeRing value={overall_readiness} color={config.color} />
          </div>
        </motion.div>

        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="grid grid-cols-2 gap-3 mb-5"
        >
          <div className="text-center p-3 rounded-xl bg-muted/50 border border-border/50">
            <div className="text-xl font-bold text-primary">{Math.round(mastery_score)}%</div>
            <div className="text-xs text-muted-foreground">Kurs-Mastery</div>
          </div>
          <div className="text-center p-3 rounded-xl bg-muted/50 border border-border/50">
            <div className="text-xl font-bold text-primary">{Math.round(simulation_score)}%</div>
            <div className="text-xs text-muted-foreground">Sim.-Ergebnis</div>
          </div>
        </motion.div>

        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="space-y-2 mb-5"
        >
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
        </motion.div>

        <motion.div
          initial={{ y: 15, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-5"
        >
          {simulation_allowed ? (
            <Link to="/exam-simulation">
              <Button className="w-full gradient-primary text-primary-foreground shadow-glow-sm gap-2 h-11">
                <Target className="h-4 w-4" />
                Simulation starten
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          ) : (
            <div className="space-y-2">
              <Button className="w-full gap-2 h-11" disabled variant="outline">
                <Lock className="h-4 w-4" />
                Simulation gesperrt
              </Button>
              <div className="p-3 rounded-xl border border-destructive/30 bg-destructive/5 text-sm text-muted-foreground">
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
        </motion.div>
      </CardContent>
    </Card>
  );
}
