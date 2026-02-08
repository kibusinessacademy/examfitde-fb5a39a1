import { cn } from "@/lib/utils";
import { type CourseProgressSummary } from "@/hooks/useCourseProgress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface SegmentedProgressBarProps {
  summary: CourseProgressSummary;
  className?: string;
  showLegend?: boolean;
  height?: "sm" | "md" | "lg";
}

const SEGMENT_COLORS = {
  mastered: "bg-green-500",
  partial: "bg-yellow-500",
  not_mastered: "bg-red-500",
  in_progress: "bg-blue-500",
  not_started: "bg-muted",
} as const;

const SEGMENT_LABELS = {
  mastered: "Gemeistert",
  partial: "Teilweise",
  not_mastered: "Wiederholen",
  in_progress: "In Bearbeitung",
  not_started: "Offen",
} as const;

export function SegmentedProgressBar({
  summary,
  className,
  showLegend = true,
  height = "md",
}: SegmentedProgressBarProps) {
  const total = summary.total_lessons;
  if (total === 0) return null;

  const segments = [
    { key: "mastered", count: summary.mastered, color: SEGMENT_COLORS.mastered, label: SEGMENT_LABELS.mastered },
    { key: "partial", count: summary.partial, color: SEGMENT_COLORS.partial, label: SEGMENT_LABELS.partial },
    { key: "not_mastered", count: summary.not_mastered, color: SEGMENT_COLORS.not_mastered, label: SEGMENT_LABELS.not_mastered },
    { key: "in_progress", count: summary.in_progress, color: SEGMENT_COLORS.in_progress, label: SEGMENT_LABELS.in_progress },
    { key: "not_started", count: summary.not_started, color: SEGMENT_COLORS.not_started, label: SEGMENT_LABELS.not_started },
  ].filter(s => s.count > 0);

  const heightClasses = {
    sm: "h-1.5",
    md: "h-2.5",
    lg: "h-4",
  };

  const progressPercent = Math.round(((summary.mastered + summary.partial) / total) * 100);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Fortschritt</span>
        <span className="font-medium">{progressPercent}%</span>
      </div>

      <TooltipProvider>
        <div className={cn("w-full rounded-full overflow-hidden flex bg-muted/50", heightClasses[height])}>
          {segments.map((segment) => {
            const percentage = (segment.count / total) * 100;
            if (percentage === 0) return null;

            return (
              <Tooltip key={segment.key}>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      segment.color,
                      "transition-all duration-300 hover:opacity-80 cursor-default",
                      height === "lg" && "first:rounded-l-full last:rounded-r-full"
                    )}
                    style={{ width: `${percentage}%` }}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  <p>{segment.label}: {segment.count} Lektionen ({Math.round(percentage)}%)</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>

      {showLegend && (
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {segments.map((segment) => (
            <span key={segment.key} className="flex items-center gap-1.5">
              <span className={cn("w-2 h-2 rounded-full", segment.color)} />
              {segment.count} {segment.label.toLowerCase()}
            </span>
          ))}
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        {summary.mastered + summary.partial} von {total} Lektionen abgeschlossen
        {summary.needs_review > 0 && (
          <span className="text-orange-500 ml-2">
            • {summary.needs_review} zur Wiederholung empfohlen
          </span>
        )}
      </div>
    </div>
  );
}
