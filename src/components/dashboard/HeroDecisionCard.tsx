import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowRight, AlertTriangle, Target, Zap, Shield, BookOpen, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNextBestAction, type NextBestAction } from '@/hooks/useNextBestAction';

interface HeroDecisionCardProps {
  curriculumId: string;
}

const RISK_CONFIG = {
  high: {
    accent: 'from-destructive to-orange-500',
    bg: 'bg-destructive/5 border-destructive/20',
    icon: AlertTriangle,
    gaugeColor: 'text-destructive',
  },
  medium: {
    accent: 'from-yellow-500 to-orange-400',
    bg: 'bg-yellow-500/5 border-yellow-500/20',
    icon: Target,
    gaugeColor: 'text-yellow-500',
  },
  low: {
    accent: 'from-green-500 to-emerald-400',
    bg: 'bg-green-500/5 border-green-500/20',
    icon: Trophy,
    gaugeColor: 'text-green-500',
  },
};

const ACTION_ICONS: Record<string, typeof Zap> = {
  ONBOARDING: BookOpen,
  CRASH_COURSE: Zap,
  WEAKNESS_TRAINING: Shield,
  EXAM_SIMULATION: Target,
  EXAM_FINAL: Trophy,
};

export function HeroDecisionCard({ curriculumId }: HeroDecisionCardProps) {
  const { data: action, isLoading } = useNextBestAction(curriculumId);

  if (isLoading) {
    return (
      <Card className="glass-card">
        <CardContent className="p-8 flex items-center justify-center min-h-[200px]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!action) return null;

  const config = RISK_CONFIG[action.risk_level] || RISK_CONFIG.high;
  const ActionIcon = ACTION_ICONS[action.action] || Zap;
  const readiness = Math.round(action.readiness_score);

  return (
    <Card className={cn('overflow-hidden border-2 transition-all', config.bg)}>
      <CardContent className="p-0">
        <div className="flex items-stretch">
          {/* Accent strip */}
          <div className={cn('w-2 bg-gradient-to-b flex-shrink-0', config.accent)} />

          <div className="flex-1 p-5 sm:p-6">
            {/* Top row: Readiness gauge + status */}
            {action.action !== 'ONBOARDING' && (
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  {/* Mini gauge */}
                  <div className="relative">
                    <svg className="w-14 h-14 transform -rotate-90">
                      <circle cx="28" cy="28" r="22" fill="none" strokeWidth="4"
                        className="text-muted/20" stroke="currentColor" />
                      <circle cx="28" cy="28" r="22" fill="none" strokeWidth="4"
                        strokeDasharray={`${(readiness / 100) * 138} 138`}
                        strokeLinecap="round"
                        className={config.gaugeColor} stroke="currentColor" />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-sm font-bold">
                      {readiness}%
                    </span>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Prüfungsreife
                    </div>
                    <div className={cn('text-sm font-semibold', config.gaugeColor)}>
                      {action.risk_level === 'high' && 'Nicht bestanden'}
                      {action.risk_level === 'medium' && 'Fast geschafft'}
                      {action.risk_level === 'low' && 'Prüfungsbereit'}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Main content */}
            <h2 className="text-xl sm:text-2xl font-display font-bold leading-tight mb-1">
              {action.headline}
            </h2>

            {/* Bottleneck callout */}
            {action.bottleneck && (
              <div className="flex items-center gap-2 mt-2 mb-3 px-3 py-2 rounded-lg bg-muted/50 border border-border">
                <AlertTriangle className="h-4 w-4 text-orange-500 flex-shrink-0" />
                <div className="text-sm">
                  <span className="font-medium">Engpass:</span>{' '}
                  <span className="text-muted-foreground">
                    {action.bottleneck.title}
                    {action.bottleneck.field && ` (${action.bottleneck.field})`}
                  </span>
                </div>
              </div>
            )}

            {action.subline && (
              <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                {action.subline}
              </p>
            )}

            {/* Single CTA – the ONLY decision */}
            <Link to={action.route}>
              <Button
                size="lg"
                className={cn(
                  'w-full sm:w-auto font-bold text-base h-12 px-8 shadow-lg',
                  'bg-gradient-to-r text-white',
                  config.accent
                )}
              >
                <ActionIcon className="h-5 w-5 mr-2" />
                {action.cta}
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
