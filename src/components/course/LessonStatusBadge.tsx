import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  type LessonStatus,
  getStatusLabel,
  getStatusColor,
  getStatusIcon,
} from "@/hooks/useCourseProgress";
import { RefreshCw, CheckCircle, Circle, PlayCircle, XCircle, AlertCircle } from "lucide-react";

interface LessonStatusBadgeProps {
  status: LessonStatus;
  needsReview?: boolean;
  scorePercent?: number | null;
  showScore?: boolean;
  size?: "sm" | "md";
}

export function LessonStatusBadge({
  status,
  needsReview,
  scorePercent,
  showScore = false,
  size = "md",
}: LessonStatusBadgeProps) {
  const Icon = getStatusIconComponent(status);
  const label = getStatusLabel(status);

  const variants: Record<LessonStatus, "default" | "secondary" | "destructive" | "outline"> = {
    mastered: "default",
    partial: "secondary",
    not_mastered: "destructive",
    in_progress: "outline",
    not_started: "outline",
  };

  return (
    <div className="flex items-center gap-2">
      <Badge
        variant={variants[status]}
        className={cn(
          size === "sm" && "text-xs px-2 py-0.5",
          status === "mastered" && "bg-green-500 hover:bg-green-600",
          status === "partial" && "bg-yellow-500 hover:bg-yellow-600 text-yellow-950"
        )}
      >
        <Icon className={cn("mr-1", size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5")} />
        {label}
        {showScore && scorePercent !== null && scorePercent !== undefined && (
          <span className="ml-1">({scorePercent}%)</span>
        )}
      </Badge>

      {needsReview && (
        <Badge variant="outline" className="border-orange-500/50 text-orange-500">
          <RefreshCw className="h-3 w-3 mr-1" />
          Wiederholen
        </Badge>
      )}
    </div>
  );
}

function getStatusIconComponent(status: LessonStatus) {
  switch (status) {
    case "mastered":
      return CheckCircle;
    case "partial":
      return AlertCircle;
    case "not_mastered":
      return XCircle;
    case "in_progress":
      return PlayCircle;
    default:
      return Circle;
  }
}
