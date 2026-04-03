import { Link } from 'react-router-dom';
import { useReadinessScore, useAdaptiveRecommendation } from '@/hooks/useAdaptiveLearning';
import { useTerminology } from '@/hooks/useProgramType';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { 
  TrendingUp, 
  TrendingDown, 
  Minus,
  Target,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Calendar,
  BookOpen,
  Brain,
  Mic,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ReadinessWidgetProps {
  curriculumId: string;
  className?: string;
}

export function ReadinessWidget({ curriculumId, className }: ReadinessWidgetProps) {
  const { data: readiness, isLoading: readinessLoading } = useReadinessScore(curriculumId);
  const { data: recommendation, isLoading: recommendationLoading } = useAdaptiveRecommendation(curriculumId);
  
  const isLoading = readinessLoading || recommendationLoading;
  
  if (isLoading) {
    return (
      <Card className={cn("glass-card", className)}>
        <CardContent className="p-6 flex items-center justify-center min-h-[200px]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }
  
  const score = readiness?.overall_readiness || 0;
  const predictedScore = readiness?.predicted_exam_score || 0;
  const trend = readiness?.trend || 'stable';
  const daysUntilReady = readiness?.days_until_ready || 30;
  
  // Determine status color and icon
  const getStatusConfig = () => {
    if (score >= 80) {
      return { 
        color: 'text-green-500', 
        bgColor: 'bg-green-500/10', 
        borderColor: 'border-green-500/30',
        icon: CheckCircle2, 
        label: 'Prüfungsbereit' 
      };
    } else if (score >= 50) {
      return { 
        color: 'text-yellow-500', 
        bgColor: 'bg-yellow-500/10', 
        borderColor: 'border-yellow-500/30',
        icon: Target, 
        label: 'Auf gutem Weg' 
      };
    } else {
      return { 
        color: 'text-orange-500', 
        bgColor: 'bg-orange-500/10', 
        borderColor: 'border-orange-500/30',
        icon: AlertTriangle, 
        label: 'Training empfohlen' 
      };
    }
  };
  
  const getTrendIcon = () => {
    switch (trend) {
      case 'improving': return <TrendingUp className="h-4 w-4 text-green-500" />;
      case 'declining': return <TrendingDown className="h-4 w-4 text-red-500" />;
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
            <StatusIcon className={cn("h-5 w-5", status.color)} />
            Bestehens-Prognose
          </CardTitle>
          <Badge variant="outline" className={cn("gap-1", status.color)}>
            {getTrendIcon()}
            {status.label}
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="p-6 pt-4">
        {/* Main Score */}
        <div className="text-center mb-6">
          <div className="relative inline-flex items-center justify-center">
            <svg className="w-32 h-32 transform -rotate-90">
              <circle
                cx="64"
                cy="64"
                r="56"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                className="text-muted/20"
              />
              <circle
                cx="64"
                cy="64"
                r="56"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                strokeDasharray={`${(score / 100) * 352} 352`}
                strokeLinecap="round"
                className={status.color}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-4xl font-display font-bold">{Math.round(score)}%</span>
              <span className="text-xs text-muted-foreground">Bereitschaft</span>
            </div>
          </div>
        </div>
        
        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <div className="text-2xl font-bold text-primary">{Math.round(predictedScore)}%</div>
            <div className="text-xs text-muted-foreground">Progn. Ergebnis</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <div className="flex items-center justify-center gap-1">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-2xl font-bold">{daysUntilReady}</span>
            </div>
            <div className="text-xs text-muted-foreground">Tage bis bereit</div>
          </div>
        </div>
        
        {/* Weak Areas Preview */}
        {readiness?.weak_areas && readiness.weak_areas.length > 0 && (
          <div className="mb-4">
            <div className="text-sm font-medium mb-2 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              Schwache Bereiche
            </div>
            <div className="space-y-2">
              {readiness.weak_areas.slice(0, 3).map((area, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground truncate flex-1">{area.title}</span>
                  <Progress value={area.score} className="w-20 h-2 ml-2" />
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Adaptive Recommendation */}
        {recommendation && (
          <div className={cn(
            "p-4 rounded-lg border",
            recommendation.priority === 'high' ? 'border-primary bg-primary/5' : 'border-border bg-muted/30'
          )}>
            <div className="flex items-start gap-3">
              <div className={cn(
                "p-2 rounded-lg",
                recommendation.priority === 'high' ? 'bg-primary/10' : 'bg-muted'
              )}>
                {getActionIcon(recommendation.action)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium mb-1">Empfehlung</p>
                <p className="text-sm text-muted-foreground">{recommendation.reason}</p>
              </div>
            </div>
            <Link to={recommendation.route} className="block mt-3">
              <Button className="w-full gradient-primary text-primary-foreground">
                {recommendation.action === 'DIAGNOSTIC' ? 'Diagnosetest starten' : 
                 recommendation.action === 'COURSE' ? 'Zum Kurs' :
                 recommendation.action === 'WEAKNESS_MODE' ? 'Schwächenmodus' :
                 recommendation.action === 'ORAL_TRAINER' ? 'Mündlich üben' :
                 recommendation.action === 'SIMULATION' ? 'Simulation starten' : 'Weiter lernen'}
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
