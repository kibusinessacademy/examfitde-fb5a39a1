import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { Loader2, Lock } from 'lucide-react';
import { recordLearningEvent, snapshotExamReadiness } from '@/lib/learning-telemetry';
import { useMiniCheckMasterySync } from '@/features/mastery/hooks/useMiniCheckMasterySync';
import { useCertificationFromCurriculum } from '@/hooks/useCertificationFromCurriculum';
import { SurfaceHumorCard } from '@/components/humor/SurfaceHumorCard';

import type { Json, TablesUpdate } from '@/integrations/supabase/types';
import type { LessonStatus } from '@/hooks/useCourseProgress';

import LessonHeroHeader from '@/components/lesson/LessonHeroHeader';
import StepIndicator from '@/components/lesson/StepIndicator';
import LessonHero from '@/components/lesson/LessonHero';
import PageExplainer from '@/components/admin/PageExplainer';
import LessonContent from '@/components/lesson/LessonContent';
import LessonNavigation from '@/components/lesson/LessonNavigation';
import LessonTutorBox from '@/components/lesson/LessonTutorBox';
import LessonOralVisualSlot from '@/components/lesson/LessonOralVisualSlot';
import { LearningGoalFeedback } from '@/components/course/LearningGoalFeedback';

interface Lesson {
  id: string;
  title: string;
  step: string;
  content: Json | null;
  duration_minutes: number | null;
  module_id: string;
  sort_order: number | null;
  h5p_content_id: string | null;
  competency_id: string | null;
  exam_relevance_score: number | null;
}

interface Module {
  id: string;
  title: string;
  course_id: string;
}

interface Course {
  id: string;
  title: string;
  curriculum_id: string | null;
  thumbnail_url: string | null;
}

interface LessonProgress {
  id: string;
  completed: boolean | null;
  time_spent_seconds: number | null;
  score: number | null;
}

interface LessonOutcome {
  status: LessonStatus;
  scorePercent: number | null;
  needsReview: boolean;
  attempts: number;
  competencyTitle: string | null;
  competencyCode: string | null;
}

export default function LessonPlayer() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [module, setModule] = useState<Module | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [progress, setProgress] = useState<LessonProgress | null>(null);
  const [siblingLessons, setSiblingLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [startTime] = useState(Date.now());
  const [lessonOutcome, setLessonOutcome] = useState<LessonOutcome | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [miniCheckKey, setMiniCheckKey] = useState(0);
  const [progressionBlocked, setProgressionBlocked] = useState<{ blocked: boolean; reason?: string; prevLessonId?: string } | null>(null);
  const [competency, setCompetency] = useState<{ code: string | null; title: string | null }>({ code: null, title: null });
  const { syncMiniCheckResult } = useMiniCheckMasterySync();
  const certificationId = useCertificationFromCurriculum(course?.curriculum_id);

  const handleRetryMiniCheck = () => {
    setShowFeedback(false);
    setLessonOutcome(null);
    setMiniCheckKey(prev => prev + 1); // Force MiniCheckPlayer to remount
  };

  const fetchLessonOutcome = useCallback(async (lId: string) => {
    if (!user) return;

    const { data, error } = await supabase
      .from('lesson_outcomes')
      .select(`
        status,
        score_percent,
        needs_review,
        attempts,
        competency:competencies(title, code)
      `)
      .eq('lesson_id', lId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!error && data) {
      const competency = data.competency as { title: string; code: string } | null;
      setLessonOutcome({
        status: data.status as LessonStatus,
        scorePercent: data.score_percent,
        needsReview: data.needs_review,
        attempts: data.attempts,
        competencyTitle: competency?.title ?? null,
        competencyCode: competency?.code ?? null,
      });
    }
  }, [user]);

  const fetchLessonData = useCallback(async () => {
    if (!lessonId || !user) return;

    try {
      // Fetch lesson
      const { data: lessonData, error: lessonError } = await supabase
        .from('lessons')
        .select('*')
        .eq('id', lessonId)
        .single();

      if (lessonError || !lessonData) {
        toast({ title: 'Lektion nicht gefunden', variant: 'destructive' });
        navigate(-1);
        return;
      }

      setLesson(lessonData);

      // Fetch competency (learner-facing label SSOT)
      if (lessonData.competency_id) {
        const { data: compData } = await supabase
          .from('competencies')
          .select('code, title')
          .eq('id', lessonData.competency_id)
          .maybeSingle();
        if (compData) setCompetency({ code: compData.code ?? null, title: compData.title ?? null });
      } else {
        setCompetency({ code: null, title: null });
      }

      // Fetch module
      const { data: moduleData } = await supabase
        .from('modules')
        .select('*')
        .eq('id', lessonData.module_id)
        .single();

      if (moduleData) {
        setModule(moduleData);

        // Fetch course and sibling lessons in parallel
        const [courseResult, lessonsResult] = await Promise.all([
          supabase
            .from('courses')
            .select('id, title, curriculum_id, thumbnail_url')
            .eq('id', moduleData.course_id)
            .single(),
          supabase
            .from('lessons')
            .select('*')
            .eq('module_id', moduleData.id)
            .order('sort_order')
        ]);

        if (courseResult.data) {
          setCourse(courseResult.data);
        }

        if (lessonsResult.data) {
          setSiblingLessons(lessonsResult.data);
        }
      }

      // Fetch or create progress
      const { data: progressData } = await supabase
        .from('learning_progress')
        .select('*')
        .eq('lesson_id', lessonId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (progressData) {
        setProgress(progressData);
      } else {
        // Create progress record
        const { data: newProgress } = await supabase
          .from('learning_progress')
          .insert({
            lesson_id: lessonId,
            user_id: user.id,
            completed: false,
            time_spent_seconds: 0,
          })
          .select()
          .single();

        if (newProgress) {
          setProgress(newProgress);
        }
      }
    } catch (error) {
      console.error('Error fetching lesson data:', error);
      toast({ title: 'Fehler beim Laden', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [lessonId, user, navigate]);

  useEffect(() => {
    fetchLessonData();
  }, [fetchLessonData]);

  // Check lesson progression gate
  useEffect(() => {
    async function checkProgression() {
      if (!lessonId || !user) return;
      const { data, error } = await supabase.rpc('check_lesson_progression', {
        p_user_id: user.id,
        p_lesson_id: lessonId,
      });
      if (!error && data) {
        const gate = data as unknown as { allowed: boolean; reason?: string; previous_lesson_id?: string };
        if (!gate.allowed) {
          setProgressionBlocked({ blocked: true, reason: gate.reason, prevLessonId: gate.previous_lesson_id });
        } else {
          setProgressionBlocked(null);
        }
      }
    }
    checkProgression();
  }, [lessonId, user]);

  const completeLesson = async (score?: number, maxScore?: number) => {
    if (!user || !lesson || !progress) return;

    setCompleting(true);
    const timeSpent = Math.floor((Date.now() - startTime) / 1000);

    const updateData: TablesUpdate<'learning_progress'> = {
      completed: true,
      completed_at: new Date().toISOString(),
      time_spent_seconds: (progress.time_spent_seconds || 0) + timeSpent,
    };

    // Calculate score percent if score provided
    let scorePercent: number | null = null;
    if (score !== undefined && maxScore !== undefined && maxScore > 0) {
      scorePercent = Math.round((score / maxScore) * 100);
      updateData.score = scorePercent;
    }

    const { error } = await supabase
      .from('learning_progress')
      .update(updateData)
      .eq('id', progress.id);

    if (error) {
      toast({ title: 'Fehler beim Speichern', variant: 'destructive' });
      setCompleting(false);
      return;
    }

    // Update lesson_outcomes via RPC for mastery tracking (SSOT)
    if (scorePercent !== null) {
      const { error: outcomeError } = await supabase.rpc('update_lesson_outcome', {
        p_lesson_id: lesson.id,
        p_score_percent: scorePercent,
      });

      if (outcomeError) {
        console.error('Failed to update lesson outcome:', outcomeError);
      }
    }

    setProgress({ ...progress, completed: true, score: scorePercent });
    toast({ title: 'Lektion abgeschlossen!', description: 'Gut gemacht!' });
    setCompleting(false);

    // ── Telemetry: record lesson completion (snapshot triggered by caller) ──
    const curriculumId = course?.curriculum_id;
    recordLearningEvent({
      event_type: 'lesson_completed',
      curriculum_id: curriculumId ?? undefined,
      lesson_id: lesson.id,
      competency_id: lesson.competency_id ?? undefined,
      duration_seconds: timeSpent,
      score: scorePercent ?? undefined,
    });
  };

  const handleH5PCompleted = (score?: number, maxScore?: number) => {
    // Telemetrie-Parität mit MiniCheck — feuert auch bei Re-Completion
    const curriculumId = course?.curriculum_id;
    const scorePercent =
      score !== undefined && maxScore !== undefined && maxScore > 0
        ? Math.round((score / maxScore) * 100)
        : undefined;
    recordLearningEvent({
      event_type: 'h5p_completed',
      curriculum_id: curriculumId ?? undefined,
      lesson_id: lesson?.id,
      competency_id: lesson?.competency_id ?? undefined,
      score: scorePercent,
      payload: { raw_score: score ?? null, max_score: maxScore ?? null },
    });

    if (!progress?.completed) {
      completeLesson(score, maxScore);
      // Trigger snapshot after H5P-only completion
      if (curriculumId) snapshotExamReadiness(curriculumId);
    }
  };

  const handleMiniCheckCompleted = async (score: number, maxScore: number) => {
    if (!progress?.completed) {
      await completeLesson(score, maxScore);
    }

    // ── Telemetry: record minicheck completion ──
    const curriculumId = course?.curriculum_id;
    const scorePercent = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
    recordLearningEvent({
      event_type: 'minicheck_completed',
      curriculum_id: curriculumId ?? undefined,
      lesson_id: lessonId ?? undefined,
      score: scorePercent,
      payload: { correct_count: score, total_count: maxScore },
    });
    if (curriculumId) {
      snapshotExamReadiness(curriculumId);

      // ── Wave 3B: Mastery sync ──
      // If the lesson has a competency_id, update mastery based on MiniCheck score
      if (lesson?.competency_id) {
        const normalizedScore = maxScore > 0 ? score / maxScore : 0;
        syncMiniCheckResult({
          curriculumId,
          competencyScores: [
            { competencyId: lesson.competency_id, score: normalizedScore },
          ],
        }).catch((err) => console.error('[Mastery] Sync failed:', err));
      }
    }

    // Fetch updated outcome and show feedback
    if (lessonId) {
      await fetchLessonOutcome(lessonId);
      setShowFeedback(true);
    }
  };

  const handleH5PProgress = (progressPercent: number) => {
    // Could be used for real-time progress updates
    console.log('H5P Progress:', progressPercent);
  };

  const navigateToLesson = (targetLesson: Lesson) => {
    navigate(`/lesson/${targetLesson.id}`);
  };

  const getCurrentLessonIndex = () => {
    return siblingLessons.findIndex(l => l.id === lessonId);
  };

  const getPreviousLesson = () => {
    const idx = getCurrentLessonIndex();
    return idx > 0 ? siblingLessons[idx - 1] : null;
  };

  const getNextLesson = () => {
    const idx = getCurrentLessonIndex();
    return idx < siblingLessons.length - 1 ? siblingLessons[idx + 1] : null;
  };

  const getModuleProgress = () => {
    if (siblingLessons.length === 0) return 0;
    const currentIdx = getCurrentLessonIndex();
    return Math.round(((currentIdx + (progress?.completed ? 1 : 0)) / siblingLessons.length) * 100);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!lesson || !module || !course) return null;

  // Recommendation gate — never blocks the lesson hard (paywall is enforced
  // separately via purchase/entitlement checks). We surface a soft recommendation
  // banner inside the player below instead of replacing the page.
  const progressionRecommendation =
    progressionBlocked?.blocked
      ? {
          reason: progressionBlocked.reason ?? 'Vorheriger Lernschritt noch nicht abgeschlossen',
          prevLessonId: progressionBlocked.prevLessonId,
        }
      : null;

  const prevLesson = getPreviousLesson();
  const nextLesson = getNextLesson();

  return (
    <div className="min-h-screen bg-background" data-testid="lesson-player">
      <LessonHeroHeader
        courseId={course.id}
        courseTitle={course.title}
        moduleTitle={module.title}
        competencyTitle={competency.title}
        competencyCode={competency.code}
        stepKey={lesson.step}
        imageUrl={course.thumbnail_url}
        progress={getModuleProgress()}
        currentIndex={getCurrentLessonIndex()}
        totalLessons={siblingLessons.length}
        estimatedTimeLabel={
          lesson.duration_minutes ? `≈ ${lesson.duration_minutes} Min.` : undefined
        }
      />

      <div className="container mx-auto px-4 py-6">
        {progressionRecommendation && (
          <Card className="glass-card max-w-4xl mx-auto mb-4 border-warning/40 bg-warning-bg-subtle/40">
            <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-warning/15 flex items-center justify-center flex-shrink-0">
                  <Lock className="h-4 w-4 text-warning" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">Empfehlung</p>
                  <p className="text-sm text-muted-foreground break-words [text-wrap:balance]">
                    {progressionRecommendation.reason}. Du kannst die Lektion trotzdem öffnen — der größte Lernerfolg entsteht jedoch in der empfohlenen Reihenfolge.
                  </p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto sm:flex-shrink-0">
                {progressionRecommendation.prevLessonId && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      navigate(`/lesson/${progressionRecommendation.prevLessonId}`)
                    }
                    className="w-full sm:w-auto min-h-11 whitespace-normal text-center [text-wrap:balance]"
                  >
                    Zur empfohlenen Lektion
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setProgressionBlocked(null)}
                  data-testid="lesson-progression-bypass"
                  className="w-full sm:w-auto min-h-11 whitespace-normal text-center [text-wrap:balance]"
                >
                  Trotzdem hier weiterlernen
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <StepIndicator currentStep={lesson.step} />

        <LessonHero
          lessonId={lesson.id}
          rawTitle={lesson.title}
          content={lesson.content}
          competencyCode={competency.code}
          competencyTitle={competency.title}
          courseTitle={course.title}
          step={lesson.step}
          lessonNumber={getCurrentLessonIndex() + 1}
          totalLessons={siblingLessons.length}
          examRelevanceScore={lesson.exam_relevance_score ?? null}
          isCompleted={!!progress?.completed}
        />

        {/* Humor Intro */}
        {lesson.step !== 'mini_check' && (
          <SurfaceHumorCard
            certificationId={certificationId}
            surface="lesson_intro"
            competenceId={lesson.competency_id}
            lessonId={lesson.id}
            variant="inline"
            className="max-w-4xl mx-auto mb-4"
          />
        )}

        {/* Content Area */}
        <Card className="glass-card max-w-4xl mx-auto mb-8" data-testid="lesson-content-card">
          <CardContent className="p-6 md:p-10" data-testid="lesson-content">
            <LessonContent
              key={miniCheckKey}
              content={lesson.content}
              h5pContentId={lesson.h5p_content_id}
              lessonId={lesson.id}
              certificationId={certificationId}
              competenceId={lesson.competency_id}
              curriculumId={course.curriculum_id}
              competencyCode={competency.code}
              competencyTitle={competency.title}
              stepKey={lesson.step}
              onH5PCompleted={handleH5PCompleted}
              onH5PProgress={handleH5PProgress}
              onMiniCheckCompleted={handleMiniCheckCompleted}
            />

            {/* Learning Goal Feedback after Mini-Check */}
            {showFeedback && lessonOutcome && (
              <div className="mt-8 pt-6 border-t">
                <LearningGoalFeedback
                  competencyTitle={lessonOutcome.competencyTitle}
                  competencyCode={lessonOutcome.competencyCode}
                  status={lessonOutcome.status}
                  scorePercent={lessonOutcome.scorePercent}
                  needsReview={lessonOutcome.needsReview}
                  attempts={lessonOutcome.attempts}
                  onRetry={handleRetryMiniCheck}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Humor Outro (after content, before navigation) */}
        {lesson.step !== 'mini_check' && progress?.completed && (
          <SurfaceHumorCard
            certificationId={certificationId}
            surface="lesson_outro"
            competenceId={lesson.competency_id}
            lessonId={lesson.id}
            variant="inline"
            className="max-w-4xl mx-auto mb-4"
          />
        )}

        <LessonTutorBox
          context={{
            curriculumId: course.curriculum_id,
            competencyId: lesson.competency_id,
            lessonId: lesson.id,
            stepKey: lesson.step,
            competencyCode: competency.code,
            competencyTitle: competency.title,
          }}
        />


        <LessonNavigation
          prevLesson={prevLesson}
          nextLesson={nextLesson}
          courseId={course.id}
          isCompleted={progress?.completed || false}
          completing={completing}
          currentStep={lesson.step}
          onComplete={() => completeLesson()}
          onNavigate={navigateToLesson}
        />

        <div className="max-w-4xl mx-auto mt-10">
          <PageExplainer
            title="So funktioniert der Lernweg"
            description="Jede Lektion durchläuft mehrere Schritte (Einstieg, Verstehen, Anwenden, Wiederholen, Mini-Check). Mini-Checks geben Feedback zu deinem Lernstand. Ab 80% gilt ein Lernziel als gemeistert."
            actions={[
              '„Als abgeschlossen markieren" schließt den aktuellen Schritt ab',
              'Mini-Check prüft dein Wissen – bei < 80% kannst du wiederholen',
              'Über die Navigation wechselst du zum vorherigen oder nächsten Schritt',
            ]}
            tips={[
              'Vorherige Schritte müssen abgeschlossen sein, bevor der nächste freischaltet',
              'Bei H5P-Inhalten wird dein Score automatisch erfasst',
            ]}
          />
        </div>
      </div>
    </div>
  );
}
