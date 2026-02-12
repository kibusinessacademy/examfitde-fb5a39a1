import { useActiveCourse } from '@/contexts/ActiveCourseContext';
import { Badge } from '@/components/ui/badge';
import { Shield, Brain, Activity, Lock, Clock, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { de } from 'date-fns/locale';

export default function ActiveCourseBar() {
  const { course, loading } = useActiveCourse();

  if (!course || loading) return null;

  const healthColor = course.healthScore >= 95 ? 'text-success' :
    course.healthScore >= 80 ? 'text-warning' : 'text-destructive';
  const healthBg = course.healthScore >= 95 ? 'bg-success/10' :
    course.healthScore >= 80 ? 'bg-warning/10' : 'bg-destructive/10';

  const statusLabel: Record<string, string> = {
    planning: 'Draft', council_review: 'Council Review', building: 'Build läuft',
    qa: 'QA', published: 'Live', failed: 'Fehler',
  };

  const statusColor: Record<string, string> = {
    planning: 'bg-muted text-muted-foreground', council_review: 'bg-warning/20 text-warning',
    building: 'bg-primary/20 text-primary', qa: 'bg-accent/20 text-accent-foreground',
    published: 'bg-success/20 text-success', failed: 'bg-destructive/20 text-destructive',
  };

  return (
    <div className="sticky top-0 z-30 bg-card/95 backdrop-blur-sm border-b border-border px-4 py-2.5">
      <div className="flex items-center gap-4 flex-wrap text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="font-semibold text-sm text-foreground truncate">{course.title}</span>
        </div>

        <Badge variant="outline" className={cn("text-[10px]", statusColor[course.status] || '')}>
          {statusLabel[course.status] || course.status}
        </Badge>

        <div className={cn("flex items-center gap-1 px-2 py-0.5 rounded-full", healthBg)}>
          <Activity className={cn("h-3 w-3", healthColor)} />
          <span className={cn("font-bold", healthColor)}>{course.healthScore}%</span>
        </div>

        {course.integrityPassed && (
          <span className="flex items-center gap-1 text-success"><Shield className="h-3 w-3" /> Integrity OK</span>
        )}
        {course.councilApproved && (
          <span className="flex items-center gap-1 text-success"><Brain className="h-3 w-3" /> Council OK</span>
        )}

        <span className="text-muted-foreground">
          Fragen: <strong className="text-foreground">{course.examQuestionCount}</strong>
        </span>

        {course.tutorIndexVersion !== null && (
          <span className="text-muted-foreground">Tutor: v{course.tutorIndexVersion}</span>
        )}

        {course.lockActive && (
          <span className="flex items-center gap-1 text-warning">
            <Lock className="h-3 w-3" />
            {course.lockSince ? `seit ${formatDistanceToNow(new Date(course.lockSince), { locale: de })}` : 'gesperrt'}
          </span>
        )}

        {course.lastBuildAt && (
          <span className="text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDistanceToNow(new Date(course.lastBuildAt), { locale: de, addSuffix: true })}
          </span>
        )}
      </div>
    </div>
  );
}
