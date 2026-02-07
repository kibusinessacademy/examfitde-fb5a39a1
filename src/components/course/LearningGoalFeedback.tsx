import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LessonStatusBadge } from "./LessonStatusBadge";
import { type LessonStatus } from "@/hooks/useCourseProgress";
import { Target, TrendingUp, AlertTriangle, CheckCircle2 } from "lucide-react";

interface LearningGoalFeedbackProps {
  competencyTitle: string | null;
  competencyCode: string | null;
  status: LessonStatus;
  scorePercent: number | null;
  needsReview: boolean;
  attempts: number;
  className?: string;
}

export function LearningGoalFeedback({
  competencyTitle,
  competencyCode,
  status,
  scorePercent,
  needsReview,
  attempts,
  className,
}: LearningGoalFeedbackProps) {
  const getFeedbackMessage = () => {
    if (status === "mastered") {
      return {
        icon: CheckCircle2,
        title: "Lernziel erreicht!",
        message: competencyTitle
          ? `Du hast die Kompetenz "${competencyTitle}" erfolgreich gemeistert.`
          : "Du hast diese Lektion erfolgreich abgeschlossen.",
        variant: "success" as const,
      };
    }
    if (status === "partial") {
      return {
        icon: TrendingUp,
        title: "Teilweise erreicht",
        message: competencyTitle
          ? `Du bist auf dem richtigen Weg zur Kompetenz "${competencyTitle}". Wiederholung wird empfohlen.`
          : "Du hast gute Fortschritte gemacht, aber eine Wiederholung könnte helfen.",
        variant: "warning" as const,
      };
    }
    if (status === "not_mastered") {
      return {
        icon: AlertTriangle,
        title: "Noch nicht erreicht",
        message: competencyTitle
          ? `Die Kompetenz "${competencyTitle}" erfordert noch Übung. Schau dir die Inhalte nochmal an.`
          : "Diese Lektion solltest du wiederholen, um das Lernziel zu erreichen.",
        variant: "error" as const,
      };
    }
    return {
      icon: Target,
      title: "Lernziel",
      message: competencyTitle
        ? `Kompetenz: ${competencyTitle}`
        : "Schließe den Mini-Check ab, um dein Lernziel zu überprüfen.",
      variant: "default" as const,
    };
  };

  const feedback = getFeedbackMessage();
  const Icon = feedback.icon;

  return (
    <Card
      className={cn(
        "border-2 transition-colors",
        feedback.variant === "success" && "border-green-500/30 bg-green-500/5",
        feedback.variant === "warning" && "border-yellow-500/30 bg-yellow-500/5",
        feedback.variant === "error" && "border-red-500/30 bg-red-500/5",
        feedback.variant === "default" && "border-border",
        className
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "p-2 rounded-lg",
              feedback.variant === "success" && "bg-green-500/10 text-green-500",
              feedback.variant === "warning" && "bg-yellow-500/10 text-yellow-500",
              feedback.variant === "error" && "bg-red-500/10 text-red-500",
              feedback.variant === "default" && "bg-primary/10 text-primary"
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-base">{feedback.title}</CardTitle>
            {competencyCode && (
              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                {competencyCode}
              </p>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{feedback.message}</p>

        <div className="flex items-center justify-between">
          <LessonStatusBadge
            status={status}
            needsReview={needsReview}
            scorePercent={scorePercent}
            showScore
            size="sm"
          />

          {attempts > 0 && (
            <span className="text-xs text-muted-foreground">
              {attempts} {attempts === 1 ? "Versuch" : "Versuche"}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
