import { Link } from 'react-router-dom';
import { useReadinessScore, useAdaptiveRecommendation } from '@/hooks/useAdaptiveLearning';
import { useTerminology } from '@/hooks/useProgramType';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { 
  TrendingUp, TrendingDown, Minus, Target, AlertTriangle,
  CheckCircle2, ArrowRight, Sparkles, Calendar, BookOpen,
  Brain, Mic, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

interface ReadinessWidgetProps {
  curriculumId: string;
  className?: string;
}

function AnimatedScoreRing({ score, color, size = 128 }: { score: number; color: string; size?: number }) {
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const [offset, setOffset] = useState(circumference);

  useEffect(() => {
    const timer = setTimeout(() => {
      setOffset(circumference - (score / 100) * circumference);
    }, 200);
    return () => clearTimeout(timer);
  }, [score, circumference]);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth={strokeWidth} opacity={0.3} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.3, type: 'spring', stiffness: 200 }}
          className="text-4xl font-display font-bold"
        >
          {Math.round(score)}%
        </motion.span>
        <span className="text-xs text-muted-foreground">Bereitschaft</span>
      </div>
    </div>
  );
}

export function ReadinessWidget({ curriculumId, className }: ReadinessWidgetProps) {
  const { data: readiness, isLoading: readinessLoading } = useReadinessScore(curriculumId);
  const { data: recommendation, isLoading: recommendationLoading } = useAdaptiveRecommendation(curriculumId);
  const { t } = useTerminology(curriculumId);
  
  const isLoading = readinessLoading || recommendationLoading;
  
  if (isLoading) {
    return (
      <Card className={cn("glass-card", className)}>
        <CardContent className="p-6 flex items-center justify-center min-h-[200px]">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="text-xs text-muted-foreground">Analyse läuft…</span>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  const score = readiness?.overall_readiness || 0;
  const predictedScore = readiness?.predicted_exam_score || 0;
  const trend = readiness?.trend || 'stable';
  const daysUntilReady = readiness?.days_until_ready || 30;
  
  const getStatusConfig = () => {
    if (score >= 80) return { 
      color: 'hsl(142, 71%, 45%)', tokenColor: 'text-green-500',
      bgColor: 'bg-green-500/10', borderColor: 'border-green-500/30',
      icon: CheckCircle2, label: t('examReady'),
    };
    if (score >= 50) return { 
      color: 'hsl(45, 93%, 47%)', tokenColor: 'text-yellow-500',
      bgColor: 'bg-yellow-500/10', borderColor: 'border-yellow-500/30',
      icon: Target, label: 'Auf gutem Weg',
    };
    return { 
      color: 'hsl(25, 95%, 53%)', tokenColor: 'text-orange-500',
      bgColor: 'bg-orange-500/10', borderColor: 'border-orange-500/30',
      icon: AlertTriangle, label: 'Training empfohlen',
    };
  };
  
  const getTrendIcon = () => {
    switch (trend) {
      case 'improving': return <TrendingUp className="h-4 w-4 text-green-500" />;
      case 'declining': return <TrendingDown className="h-4 w-4 text-destructive" />;
      default: return <Minus className="h-4 w-4 text-muted-foreground" />;
    }
  };
  
  const getActionIcon = (action: string) => {
    switch (action) {
      case 'DIAGNOSTIC': return <Sparkles className="h-4 w-4" />;
      case 'COURSE': return <BookOpen className="h-4 w-4" />;
      case 'SIMULATION': return <Target className="h-4 w-4" />;
      case 'ORAL_TRAINER': return <Mic className="h-4 w-4" />;
      case 'WEAKNESS_MODE': return <Brain className="h-4 w-4" />;
      default: return <ArrowRight className="h-4 w-4" />;
    }
  };
  
  const status = getStatusConfig();
  const StatusIcon = status.icon;
  
  return (
    <Card className={cn("glass-card overflow-hidden", status.borderColor, className)}>
      <CardHeader className={cn("pb-2", status.bgColor)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-display flex items-center gap-2">
            <StatusIcon className={cn("h-5 w-5", status.tokenColor)} />
            Bestehens-Prognose
          </CardTitle>
          <Badge variant="outline" className={cn("gap-1", status.tokenColor)}>
            {getTrendIcon()}
            {status.label}
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="p-6 pt-4">
        {/* Animated Score Ring */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="text-center mb-6"
        >
          <div className="inline-flex items-center justify-center">
            <AnimatedScoreRing score={score} color={status.color} />
          </div>
        </motion.div>
        
        {/* Stats Grid */}
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.4 }}
          className="grid grid-cols-2 gap-3 mb-6"
        >
          <div className="text-center p-3 rounded-xl bg-muted/50 border border-border/50">
            <div className="text-2xl font-bold text-primary">{Math.round(predictedScore)}%</div>
            <div className="text-xs text-muted-foreground">Progn. Ergebnis</div>
          </div>
          <div className="text-center p-3 rounded-xl bg-muted/50 border border-border/50">
            <div className="flex items-center justify-center gap-1">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-2xl font-bold">{daysUntilReady}</span>
            </div>
            <div className="text-xs text-muted-foreground">Tage bis bereit</div>
          </div>
        </motion.div>
        
        {/* Weak Areas */}
        {readiness?.weak_areas && readiness.weak_areas.length > 0 && (
          <motion.div
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.4 }}
            className="mb-4"
          >
            <div className="text-sm font-medium mb-2 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              Schwache Bereiche
            </div>
            <div className="space-y-2">
              {readiness.weak_areas.slice(0, 3).map((area, idx) => (
                <motion.div
                  key={idx}
                  initial={{ x: -10, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 0.5 + idx * 0.1 }}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-muted-foreground truncate flex-1">{area.title}</span>
                  <Progress value={area.score} className="w-20 h-2 ml-2" />
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
        
        {/* Adaptive Recommendation */}
        {recommendation && (
          <motion.div
            initial={{ y: 15, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.4 }}
            className={cn(
              "p-4 rounded-xl border",
              recommendation.priority === 'high' ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/30'
            )}
          >
            <div className="flex items-start gap-3">
              <div className={cn(
                "p-2.5 rounded-xl",
                recommendation.priority === 'high' ? 'bg-primary/10' : 'bg-muted'
              )}>
                {getActionIcon(recommendation.action)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold mb-1">Empfehlung</p>
                <p className="text-sm text-muted-foreground leading-relaxed">{recommendation.reason}</p>
              </div>
            </div>
            <Link to={recommendation.route} className="block mt-3">
              <Button className="w-full gradient-primary text-primary-foreground shadow-glow-sm h-10">
                {recommendation.action === 'DIAGNOSTIC' ? 'Diagnosetest starten' : 
                 recommendation.action === 'COURSE' ? 'Zum Kurs' :
                 recommendation.action === 'WEAKNESS_MODE' ? 'Schwächenmodus' :
                 recommendation.action === 'ORAL_TRAINER' ? 'Mündlich üben' :
                 recommendation.action === 'SIMULATION' ? 'Simulation starten' : 'Weiter lernen'}
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}
