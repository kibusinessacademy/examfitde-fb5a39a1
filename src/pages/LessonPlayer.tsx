import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { Loader2, Lock, ArrowLeft } from 'lucide-react';
import { recordLearningEvent, snapshotExamReadiness } from '@/lib/learning-telemetry';
import { useMiniCheckMasterySync } from '@/features/mastery/hooks/useMiniCheckMasterySync';
import { useCertificationFromCurriculum } from '@/hooks/useCertificationFromCurriculum';
import { SurfaceHumorCard } from '@/components/humor/SurfaceHumorCard';

import type { Json } from '@/integrations/supabase/types';
import type { LessonStatus } from '@/hooks/useCourseProgress';

import LessonHeader from '@/components/lesson/LessonHeader';
import StepIndicator from '@/components/lesson/StepIndicator';
import PageExplainer from '@/components/admin/PageExplainer';
import LessonContent from '@/components/lesson/LessonContent';
import LessonNavigation from '@/components/lesson/LessonNavigation';
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
            .select('id, title, curriculum_id')
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

    const updateData: Record<string, unknown> = {
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
    if (!progress?.completed) {
      completeLesson(score, maxScore);
      // Trigger snapshot after H5P-only completion
      const curriculumId = course?.curriculum_id;
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

  // Mastery gate: block if previous lesson not passed
  if (progressionBlocked?.blocked) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <Card className="glass-card max-w-md w-full border-destructive/30">
          <CardContent className="p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
              <Lock className="h-8 w-8 text-destructive" />
            </div>
            <h2 className="text-xl font-display font-bold mb-2">Lektion gesperrt</h2>
            <p className="text-muted-foreground mb-6">{progressionBlocked.reason}</p>
            <div className="flex gap-3">
              {progressionBlocked.prevLessonId && (
                <Button
                  className="flex-1 gradient-primary text-primary-foreground"
                  onClick={() => navigate(`/lesson/${progressionBlocked.prevLessonId}`)}
                >
                  Zur vorherigen Lektion
                </Button>
              )}
              <Button variant="outline" className="flex-1 gap-2" onClick={() => navigate(-1)}>
                <ArrowLeft className="h-4 w-4" />
                Zurück
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const prevLesson = getPreviousLesson();
  const nextLesson = getNextLesson();

  return (
    <div className="min-h-screen bg-background" data-testid="lesson-player">
      <LessonHeader
        courseId={course.id}
        courseTitle={course.title}
        moduleTitle={module.title}
        progress={getModuleProgress()}
        currentIndex={getCurrentLessonIndex()}
        totalLessons={siblingLessons.length}
      />

      <div className="container mx-auto px-4 py-6">
        <StepIndicator 
          currentStep={lesson.step} 
          lessonTitle={lesson.title} 
        />

        <PageExplainer
          title="Wie funktioniert diese Lektion?"
          description="Jede Lektion folgt einem didaktischen Schritt: Einstieg, Verstehen, Anwenden, Wiederholen oder Mini-Check. Bei Mini-Checks bekommst du sofort Feedback zu deinem Lernstand. Ab 80% gilt das Lernziel als gemeistert."
          actions={[
            '"Abschließen" – Markiert die Lektion als erledigt und schaltet die nächste frei',
            'Mini-Check am Ende prüft dein Wissen – bei < 80% kannst du wiederholen',
            'Navigation unten → Wechsle zur vorherigen oder nächsten Lektion',
          ]}
          tips={[
            'Du musst die vorherige Lektion abschließen, bevor die nächste freigeschaltet wird',
            'Der Fortschrittsbalken oben zeigt deinen Modulfortschritt',
            'Bei H5P-Inhalten wird dein Score automatisch erfasst',
          ]}
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
      </div>
    </div>
  );
}
