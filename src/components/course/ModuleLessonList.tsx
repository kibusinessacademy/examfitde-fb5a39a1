import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { LessonStatusBadge } from "./LessonStatusBadge";
import { 
  type LessonStatus, 
  type LessonProgress,
  getStatusBgColor 
} from "@/hooks/useCourseProgress";
import { 
  ChevronDown, 
  ChevronUp, 
  Lock, 
  CheckCircle, 
  PlayCircle, 
  RotateCcw,
  BookOpen
} from "lucide-react";

interface Module {
  id: string;
  title: string;
  description: string | null;
  sort_order: number | null;
}

interface Lesson {
  id: string;
  title: string;
  step: string;
  duration_minutes: number | null;
  module_id: string;
  sort_order: number | null;
}

interface ModuleLessonListProps {
  modules: Module[];
  lessons: Lesson[];
  lessonProgress?: LessonProgress[];
  isEnrolled: boolean;
  defaultExpandedModuleId?: string;
}

const STEP_LABELS: Record<string, string> = {
  einstieg: "Einstieg",
  verstehen: "Verstehen",
  anwenden: "Anwenden",
  wiederholen: "Wiederholen",
  mini_check: "Mini-Check",
};

const STEP_COLORS: Record<string, string> = {
  einstieg: "bg-blue-500",
  verstehen: "bg-purple-500",
  anwenden: "bg-green-500",
  wiederholen: "bg-orange-500",
  mini_check: "bg-pink-500",
};

export function ModuleLessonList({
  modules,
  lessons,
  lessonProgress,
  isEnrolled,
  defaultExpandedModuleId,
}: ModuleLessonListProps) {
  const navigate = useNavigate();
  const [expandedModules, setExpandedModules] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (defaultExpandedModuleId) {
      initial.add(defaultExpandedModuleId);
    } else if (modules.length > 0) {
      initial.add(modules[0].id);
    }
    return initial;
  });

  const toggleModule = useCallback((moduleId: string) => {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) {
        next.delete(moduleId);
      } else {
        next.add(moduleId);
      }
      return next;
    });
  }, []);

  const getModuleLessons = useCallback(
    (moduleId: string) => lessons.filter((l) => l.module_id === moduleId),
    [lessons]
  );

  const getLessonProgressData = useCallback(
    (lessonId: string) => lessonProgress?.find((l) => l.lesson_id === lessonId),
    [lessonProgress]
  );

  const getModuleProgress = useCallback(
    (moduleId: string) => {
      const moduleLessons = getModuleLessons(moduleId);
      if (moduleLessons.length === 0) return 0;
      const completed = moduleLessons.filter((l) => {
        const progress = getLessonProgressData(l.id);
        return progress?.status === "mastered" || progress?.status === "partial";
      }).length;
      return Math.round((completed / moduleLessons.length) * 100);
    },
    [getModuleLessons, getLessonProgressData]
  );

  const handleLessonClick = (lessonId: string, locked: boolean) => {
    if (locked) return;
    navigate(`/lesson/${lessonId}`);
  };

  if (modules.length === 0) {
    return (
      <Card className="glass-card">
        <CardContent className="p-8 text-center">
          <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Dieser Kurs hat noch keine Module.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-display font-bold">Kursinhalt</h2>

      {modules.map((module, index) => {
        const moduleLessons = getModuleLessons(module.id);
        const isExpanded = expandedModules.has(module.id);
        const moduleProgress = getModuleProgress(module.id);

        return (
          <Card key={module.id} className="glass-card border-border overflow-hidden">
            <CardHeader
              className="cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => toggleModule(module.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center text-primary-foreground font-bold">
                    {index + 1}
                  </div>
                  <div>
                    <CardTitle className="text-lg">{module.title}</CardTitle>
                    {module.description && (
                      <p className="text-sm text-muted-foreground mt-1">{module.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {isEnrolled && (
                    <div className="text-right hidden sm:block">
                      <span className="text-sm text-muted-foreground">
                        {moduleProgress}% abgeschlossen
                      </span>
                    </div>
                  )}
                  {isExpanded ? (
                    <ChevronUp className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
              </div>
              {isEnrolled && <Progress value={moduleProgress} className="h-1 mt-4" />}
            </CardHeader>

            {isExpanded && (
              <CardContent className="pt-0 pb-4">
                <div className="space-y-2">
                  {moduleLessons.map((lesson) => {
                    const progressData = getLessonProgressData(lesson.id);
                    const status: LessonStatus = progressData?.status ?? "not_started";
                    const needsReview = progressData?.needs_review ?? false;
                    const score = progressData?.score_percent ?? null;
                    const locked = !isEnrolled;

                    return (
                      <div
                        key={lesson.id}
                        onClick={() => handleLessonClick(lesson.id, locked)}
                        className={`flex items-center justify-between p-3 rounded-lg transition-colors border ${
                          locked
                            ? "bg-muted/30 opacity-60 cursor-not-allowed"
                            : `${getStatusBgColor(status)} hover:bg-muted/50 cursor-pointer`
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {locked ? (
                            <Lock className="h-5 w-5 text-muted-foreground" />
                          ) : status === "mastered" ? (
                            <CheckCircle className="h-5 w-5 text-green-500" />
                          ) : needsReview ? (
                            <RotateCcw className="h-5 w-5 text-orange-500" />
                          ) : (
                            <PlayCircle className="h-5 w-5 text-primary" />
                          )}
                          <div className="flex-1">
                            <span className="font-medium">{lesson.title}</span>
                            <div className="flex flex-wrap items-center gap-2 mt-1">
                              <Badge
                                variant="secondary"
                                className={`text-xs ${STEP_COLORS[lesson.step] || ""} text-white`}
                              >
                                {STEP_LABELS[lesson.step] || lesson.step}
                              </Badge>
                              {lesson.duration_minutes && (
                                <span className="text-xs text-muted-foreground">
                                  {lesson.duration_minutes} Min.
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {isEnrolled && status !== "not_started" && (
                          <div className="hidden sm:block">
                            <LessonStatusBadge
                              status={status}
                              needsReview={needsReview}
                              scorePercent={score}
                              showScore
                              size="sm"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
