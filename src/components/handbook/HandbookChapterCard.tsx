import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Clock, CheckCircle, Lock, BookOpen, Brain, Target, AlertTriangle, Mic, CalendarCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HandbookChapter, HandbookProgress } from '@/hooks/useHandbook';

interface HandbookChapterCardProps {
  chapter: HandbookChapter;
  progress?: HandbookProgress;
  hasAccess: boolean;
  index: number;
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  'building-2': BookOpen,
  'brain': Brain,
  'target': Target,
  'alert-triangle': AlertTriangle,
  'mic': Mic,
  'calendar-check': CalendarCheck,
  'book-open': BookOpen,
};

export function HandbookChapterCard({ chapter, progress, hasAccess, index }: HandbookChapterCardProps) {
  const IconComponent = iconMap[chapter.icon] || BookOpen;
  const isCompleted = !!progress?.completed_at;
  const isStarted = !!progress && !isCompleted;

  const progressPercent = isCompleted ? 100 : isStarted ? 50 : 0;

  return (
    <Link 
      to={hasAccess ? `/handbuch/${chapter.chapter_key}` : '/shop'}
      className="block group"
    >
      <Card className={cn(
        "h-full transition-all duration-300 hover:shadow-lg border-2",
        isCompleted && "border-green-500/50 bg-green-50/50 dark:bg-green-950/20",
        isStarted && "border-primary/50",
        !hasAccess && "opacity-75"
      )}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className={cn(
              "p-3 rounded-xl transition-colors",
              isCompleted ? "bg-green-100 dark:bg-green-900/50" : "bg-primary/10"
            )}>
              <IconComponent className={cn(
                "h-6 w-6",
                isCompleted ? "text-green-600" : "text-primary"
              )} />
            </div>
            <div className="flex items-center gap-2">
              {!hasAccess && (
                <Lock className="h-4 w-4 text-muted-foreground" />
              )}
              {isCompleted && (
                <Badge variant="outline" className="bg-green-100 text-green-700 border-green-300">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Abgeschlossen
                </Badge>
              )}
              <Badge variant="secondary" className="text-xs">
                Kapitel {index + 1}
              </Badge>
            </div>
          </div>
          <CardTitle className="text-xl group-hover:text-primary transition-colors mt-3">
            {chapter.title}
          </CardTitle>
          {chapter.subtitle && (
            <CardDescription className="text-sm font-medium text-primary/80">
              {chapter.subtitle}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm line-clamp-2">
            {chapter.description}
          </p>
          
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              <span>{chapter.estimated_reading_minutes} Min. Lesezeit</span>
            </div>
            {hasAccess && (isStarted || isCompleted) && (
              <span>{progressPercent}% abgeschlossen</span>
            )}
          </div>

          {hasAccess && (
            <Progress value={progressPercent} className="h-1.5" />
          )}

          {!hasAccess && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg p-2">
              <Lock className="h-4 w-4" />
              <span>Im Bundle enthalten</span>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
