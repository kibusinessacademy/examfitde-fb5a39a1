import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CourseProgressBar } from "./CourseProgressBar";
import { LessonStatusBadge } from "./LessonStatusBadge";
import { type CourseProgress, type LessonStatus } from "@/hooks/useCourseProgress";
import { PlayCircle, RotateCcw, ArrowRight } from "lucide-react";

interface ContinueLearningCardProps {
  courseId: string;
  courseTitle: string;
  progress: CourseProgress;
}

export function ContinueLearningCard({
  courseId,
  courseTitle,
  progress,
}: ContinueLearningCardProps) {
  const nextLesson = progress.next_lesson;
  const lastActivity = progress.last_activity;
  const hasStarted = progress.progress_percent > 0;

  return (
    <Card className="glass-card">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">{courseTitle}</CardTitle>
            {lastActivity && (
              <p className="text-sm text-muted-foreground mt-1">
                Zuletzt: {lastActivity.lesson_title}
              </p>
            )}
          </div>
          {hasStarted && (
            <div className="text-2xl font-bold text-primary">
              {progress.progress_percent}%
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <CourseProgressBar
          summary={progress.summary}
          progressPercent={progress.progress_percent}
          showDetails={false}
        />

        {/* Lessons needing review */}
        {progress.summary.needs_review > 0 && (
          <div
            className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/30"
            role="status"
          >
            <div className="flex items-center gap-2 text-orange-500">
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              <span className="text-sm font-medium">
                {progress.summary.needs_review} Lektionen zur Wiederholung empfohlen
              </span>
            </div>
          </div>
        )}

        {/* Next lesson / Continue button */}
        <div className="flex items-center gap-3">
          {nextLesson ? (
            <Button asChild className="flex-1 min-h-11">
              <Link
                to={`/lesson/${nextLesson.lesson_id}`}
                aria-label={
                  hasStarted
                    ? `Training fortsetzen mit: ${nextLesson.module_title} – ${nextLesson.lesson_title}`
                    : `Training starten mit: ${nextLesson.module_title} – ${nextLesson.lesson_title}`
                }
              >
                <PlayCircle className="h-4 w-4 mr-2" aria-hidden="true" />
                {hasStarted ? "Fortsetzen" : "Training starten"}
                <ArrowRight className="h-4 w-4 ml-2" aria-hidden="true" />
              </Link>
            </Button>
          ) : (
            <Button
              variant="secondary"
              className="flex-1 min-h-11"
              disabled
              aria-disabled="true"
              aria-label="Training abgeschlossen – keine offenen Lektionen"
            >
              Training abgeschlossen
            </Button>
          )}

          <Button variant="outline" asChild className="min-h-11">
            <Link to={`/course/${courseId}`} aria-label={`Kursübersicht öffnen: ${courseTitle}`}>
              Übersicht
            </Link>
          </Button>
        </div>

        {/* Next lesson info */}
        {nextLesson && (
          <div className="text-sm text-muted-foreground">
            <span className="font-medium">Nächste Lektion:</span>{" "}
            {nextLesson.module_title} → {nextLesson.lesson_title}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
