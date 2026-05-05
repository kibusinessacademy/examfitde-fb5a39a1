import { useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
  BookOpen,
  Filter,
  AlertCircle
} from "lucide-react";
import { cn } from "@/lib/utils";

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
  const [showOnlyReview, setShowOnlyReview] = useState(false);

  // Count lessons needing review
  const reviewCount = useMemo(() => {
    if (!lessonProgress) return 0;
    return lessonProgress.filter((l) => l.needs_review).length;
  }, [lessonProgress]);

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

  // Get filtered lessons for a module
  const getFilteredModuleLessons = useCallback(
    (moduleId: string) => {
      const moduleLessons = getModuleLessons(moduleId);
      if (!showOnlyReview) return moduleLessons;
      return moduleLessons.filter((l) => {
        const progress = getLessonProgressData(l.id);
        return progress?.needs_review;
      });
    },
    [getModuleLessons, getLessonProgressData, showOnlyReview]
  );

  // Count review lessons per module
  const getModuleReviewCount = useCallback(
    (moduleId: string) => {
      const moduleLessons = getModuleLessons(moduleId);
      return moduleLessons.filter((l) => {
        const progress = getLessonProgressData(l.id);
        return progress?.needs_review;
      }).length;
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
        <CardContent className="p-8 text-center" role="status">
          <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" aria-hidden="true" />
          <h3 className="text-lg font-semibold mb-2">Noch keine Module verfügbar</h3>
          <p className="text-muted-foreground">
            Die Lerninhalte für diesen Kurs werden gerade vorbereitet. Schau bald wieder vorbei.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-display font-bold">Kursinhalt</h2>
        
        {/* Review Filter Toggle */}
        {isEnrolled && reviewCount > 0 && (
          <div 
            className={cn(
              "flex items-center gap-3 p-3 rounded-lg border transition-all",
              showOnlyReview 
                ? "bg-orange-500/10 border-orange-500/30" 
                : "bg-muted/30 border-border hover:border-orange-500/30"
            )}
          >
            <RotateCcw className={cn(
              "h-4 w-4 transition-colors",
              showOnlyReview ? "text-orange-500" : "text-muted-foreground"
            )} />
            <Label 
              htmlFor="review-filter" 
              className={cn(
                "text-sm cursor-pointer select-none transition-colors",
                showOnlyReview ? "text-orange-500 font-medium" : "text-muted-foreground"
              )}
            >
              Nur Wiederholungen ({reviewCount})
            </Label>
            <Switch
              id="review-filter"
              checked={showOnlyReview}
              onCheckedChange={setShowOnlyReview}
              className="data-[state=checked]:bg-orange-500"
            />
          </div>
        )}
      </div>

      {/* No review lessons message when filter is active */}
      {showOnlyReview && reviewCount === 0 && (
        <Card className="glass-card border-green-500/30 bg-green-500/5">
          <CardContent className="p-6 text-center">
            <CheckCircle className="h-10 w-10 text-green-500 mx-auto mb-3" />
            <p className="text-green-500 font-medium">Keine Lektionen zur Wiederholung!</p>
            <p className="text-sm text-muted-foreground mt-1">
              Du hast alle Inhalte erfolgreich gemeistert.
            </p>
          </CardContent>
        </Card>
      )}

      {modules.map((module, index) => {
        const filteredLessons = getFilteredModuleLessons(module.id);
        const isExpanded = expandedModules.has(module.id);
        const moduleProgress = getModuleProgress(module.id);
        const moduleReviewCount = getModuleReviewCount(module.id);

        // Skip modules with no lessons when filter is active
        if (showOnlyReview && filteredLessons.length === 0) return null;

        return (
          <Card 
            key={module.id} 
            className={cn(
              "glass-card border-border overflow-hidden transition-all",
              showOnlyReview && moduleReviewCount > 0 && "border-orange-500/30"
            )}
          >
            <CardHeader
              role="button"
              tabIndex={0}
              aria-expanded={isExpanded}
              aria-controls={`module-panel-${module.id}`}
              aria-label={`Modul ${index + 1}: ${module.title}, ${isExpanded ? 'eingeklappt' : 'ausklappen'}`}
              className="cursor-pointer hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
              onClick={() => toggleModule(module.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleModule(module.id);
                }
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center font-bold transition-colors",
                    showOnlyReview && moduleReviewCount > 0
                      ? "bg-orange-500 text-white"
                      : "gradient-primary text-primary-foreground"
                  )} aria-hidden="true">
                    {index + 1}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg">{module.title}</CardTitle>
                      {moduleReviewCount > 0 && !showOnlyReview && (
                        <Badge variant="outline" className="border-orange-500/50 text-orange-500 text-xs" aria-label={`${moduleReviewCount} Lektionen zur Wiederholung`}>
                          <RotateCcw className="h-3 w-3 mr-1" aria-hidden="true" />
                          {moduleReviewCount}
                        </Badge>
                      )}
                    </div>
                    {module.description && (
                      <p className="text-sm text-muted-foreground mt-1">{module.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {isEnrolled && !showOnlyReview && (
                    <div className="text-right hidden sm:block">
                      <span className="text-sm text-muted-foreground">
                        {moduleProgress}% abgeschlossen
                      </span>
                    </div>
                  )}
                  {isExpanded ? (
                    <ChevronUp className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                  )}
                </div>
              </div>
              {isEnrolled && !showOnlyReview && (
                <Progress
                  value={moduleProgress}
                  className="h-1 mt-4"
                  aria-label={`Modul-Fortschritt ${moduleProgress} Prozent`}
                />
              )}
            </CardHeader>

            {isExpanded && (
              <CardContent
                id={`module-panel-${module.id}`}
                role="region"
                aria-label={`Lektionen in Modul ${module.title}`}
                className="pt-0 pb-4 animate-fade-in"
              >
                {filteredLessons.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2" role="status">
                    {showOnlyReview
                      ? 'Keine Wiederholungs-Lektionen in diesem Modul.'
                      : 'Dieses Modul enthält noch keine Lektionen.'}
                  </p>
                ) : (
                <ul className="space-y-2 list-none p-0 m-0">
                  {filteredLessons.map((lesson) => {
                    const progressData = getLessonProgressData(lesson.id);
                    const status: LessonStatus = progressData?.status ?? "not_started";
                    const needsReview = progressData?.needs_review ?? false;
                    const score = progressData?.score_percent ?? null;
                    const locked = !isEnrolled;
                    const stepLabel = STEP_LABELS[lesson.step] || lesson.step;
                    const ariaLabel = locked
                      ? `Gesperrt: ${lesson.title} (${stepLabel}). Schreibe dich ein, um zu starten.`
                      : `${status === 'mastered' ? 'Abgeschlossen' : needsReview ? 'Zur Wiederholung' : 'Lektion starten'}: ${lesson.title} (${stepLabel})`;

                    return (
                      <li key={lesson.id}>
                        <button
                          type="button"
                          onClick={() => handleLessonClick(lesson.id, locked)}
                          disabled={locked}
                          aria-disabled={locked}
                          aria-label={ariaLabel}
                          className={cn(
                            "w-full text-left flex items-center justify-between p-3 min-h-12 rounded-lg transition-all border animate-fade-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            locked
                              ? "bg-muted/30 opacity-60 cursor-not-allowed"
                              : `${getStatusBgColor(status)} hover:bg-muted/50 cursor-pointer hover:scale-[1.01]`,
                            needsReview && "ring-1 ring-orange-500/50"
                          )}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {locked ? (
                              <Lock className="h-5 w-5 text-muted-foreground shrink-0" aria-hidden="true" />
                            ) : status === "mastered" ? (
                              <CheckCircle className="h-5 w-5 text-green-500 shrink-0" aria-hidden="true" />
                            ) : needsReview ? (
                              <RotateCcw className="h-5 w-5 text-orange-500 animate-pulse shrink-0" aria-hidden="true" />
                            ) : (
                              <PlayCircle className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
                            )}
                            <div className="flex-1 min-w-0">
                              <span className="font-medium block truncate">{lesson.title}</span>
                              <div className="flex flex-wrap items-center gap-2 mt-1">
                                <Badge
                                  variant="secondary"
                                  className={`text-xs ${STEP_COLORS[lesson.step] || ""} text-white`}
                                >
                                  {stepLabel}
                                </Badge>
                                {lesson.duration_minutes && (
                                  <span className="text-xs text-muted-foreground">
                                    <span className="sr-only">Dauer: </span>
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
                        </button>
                      </li>
                    );
                  })}
                </ul>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
