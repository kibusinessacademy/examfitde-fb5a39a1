import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { type CourseProgressSummary } from "@/hooks/useCourseProgress";

interface CourseProgressBarProps {
  summary: CourseProgressSummary;
  progressPercent: number;
  className?: string;
  showDetails?: boolean;
}

export function CourseProgressBar({
  summary,
  progressPercent,
  className,
  showDetails = false,
}: CourseProgressBarProps) {
  const completedCount = summary.mastered + summary.partial;
  const totalCount = summary.total_lessons;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Fortschritt</span>
        <span className="font-medium">{progressPercent}%</span>
      </div>

      <Progress value={progressPercent} className="h-2" aria-label={`Kursfortschritt: ${progressPercent}%`} />

      {showDetails && (
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-2">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            {summary.mastered} gemeistert
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-yellow-500" />
            {summary.partial} teilweise
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            {summary.not_mastered} wiederholen
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-muted-foreground" />
            {summary.not_started} offen
          </span>
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        {completedCount} von {totalCount} Lektionen abgeschlossen
      </div>
    </div>
  );
}
