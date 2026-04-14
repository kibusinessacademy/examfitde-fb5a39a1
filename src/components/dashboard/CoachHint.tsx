import { Card, CardContent } from '@/components/ui/card';
import { useReadinessScore } from '@/hooks/useAdaptiveLearning';
import { useDashboardStats } from '@/hooks/useDashboardStats';
import { GraduationCap, Lightbulb } from 'lucide-react';
import { useTerminology } from '@/hooks/useProgramType';
import { motion, AnimatePresence } from 'framer-motion';

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
    if (streak > 5 && weakCount > 2) return t('coachHintLinear');
    if (successRate > 80 && score < 70) return t('coachHintLowReadiness');
    if (score >= 80) return t('coachHintAlmostReady');
    if (weakCount >= 3) return `Du hast ${weakCount} ${t('coachHintGaps')}`;
    if (streak === 0) return t('coachHintStreak');
    return null;
  };

  const hint = getHint();
  if (!hint) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: -10, opacity: 0, height: 0 }}
        animate={{ y: 0, opacity: 1, height: 'auto' }}
        exit={{ y: -10, opacity: 0, height: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        <Card className="glass-card border-primary/20 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-accent/5 pointer-events-none" />
          <CardContent className="relative p-4">
            <div className="flex items-start gap-3">
              <motion.div
                initial={{ scale: 0.5, rotate: -20 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
                className="p-2.5 rounded-xl bg-primary/10 flex-shrink-0"
              >
                <Lightbulb className="h-4 w-4 text-primary" />
              </motion.div>
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
      </motion.div>
    </AnimatePresence>
  );
}
