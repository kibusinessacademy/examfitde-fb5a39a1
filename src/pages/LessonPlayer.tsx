import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

import type { Json } from '@/integrations/supabase/types';

import LessonHeader from '@/components/lesson/LessonHeader';
import StepIndicator from '@/components/lesson/StepIndicator';
import LessonContent from '@/components/lesson/LessonContent';
import LessonNavigation from '@/components/lesson/LessonNavigation';

interface Lesson {
  id: string;
  title: string;
  step: string;
  content: Json | null;
  duration_minutes: number | null;
  module_id: string;
  sort_order: number | null;
  h5p_content_id: string | null;
}

interface Module {
  id: string;
  title: string;
  course_id: string;
}

interface Course {
  id: string;
  title: string;
}

interface LessonProgress {
  id: string;
  completed: boolean;
  time_spent_seconds: number;
  score: number | null;
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
            .select('id, title')
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

  const completeLesson = async (score?: number, maxScore?: number) => {
    if (!user || !lesson || !progress) return;

    setCompleting(true);
    const timeSpent = Math.floor((Date.now() - startTime) / 1000);

    const updateData: Record<string, unknown> = {
      completed: true,
      completed_at: new Date().toISOString(),
      time_spent_seconds: (progress.time_spent_seconds || 0) + timeSpent,
    };

    // If H5P provided a score, save it
    if (score !== undefined && maxScore !== undefined && maxScore > 0) {
      updateData.score = Math.round((score / maxScore) * 100);
    }

    const { error } = await supabase
      .from('learning_progress')
      .update(updateData)
      .eq('id', progress.id);

    if (error) {
      toast({ title: 'Fehler beim Speichern', variant: 'destructive' });
    } else {
      setProgress({ ...progress, completed: true, score: updateData.score as number | null });
      toast({ title: 'Lektion abgeschlossen!', description: 'Gut gemacht!' });
    }

    setCompleting(false);
  };

  const handleH5PCompleted = (score?: number, maxScore?: number) => {
    if (!progress?.completed) {
      completeLesson(score, maxScore);
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

  if (!lesson || !module || !course) {
    return null;
  }

  const prevLesson = getPreviousLesson();
  const nextLesson = getNextLesson();

  return (
    <div className="min-h-screen bg-background">
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

        {/* Content Area */}
        <Card className="glass-card max-w-4xl mx-auto mb-8">
          <CardContent className="p-6 md:p-10">
            <LessonContent
              content={lesson.content}
              h5pContentId={lesson.h5p_content_id}
              onH5PCompleted={handleH5PCompleted}
              onH5PProgress={handleH5PProgress}
            />
          </CardContent>
        </Card>

        <LessonNavigation
          prevLesson={prevLesson}
          nextLesson={nextLesson}
          courseId={course.id}
          isCompleted={progress?.completed || false}
          completing={completing}
          onComplete={() => completeLesson()}
          onNavigate={navigateToLesson}
        />
      </div>
    </div>
  );
}
