import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { 
  Loader2, 
  ArrowLeft, 
  ArrowRight, 
  CheckCircle,
  PlayCircle,
  BookOpen,
  Lightbulb,
  PenTool,
  RotateCcw,
  ClipboardCheck,
  Home
} from 'lucide-react';

import type { Json } from '@/integrations/supabase/types';

interface Lesson {
  id: string;
  title: string;
  step: string;
  content: Json | null;
  duration_minutes: number | null;
  module_id: string;
  sort_order: number | null;
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

const stepConfig: Record<string, { 
  label: string; 
  description: string;
  icon: React.ElementType; 
  color: string;
  bgColor: string;
}> = {
  einstieg: { 
    label: 'Einstieg', 
    description: 'Aktivierung des Vorwissens',
    icon: Lightbulb, 
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/20'
  },
  verstehen: { 
    label: 'Verstehen', 
    description: 'Neues Wissen aufnehmen',
    icon: BookOpen, 
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/20'
  },
  anwenden: { 
    label: 'Anwenden', 
    description: 'Wissen praktisch nutzen',
    icon: PenTool, 
    color: 'text-green-400',
    bgColor: 'bg-green-500/20'
  },
  wiederholen: { 
    label: 'Wiederholen', 
    description: 'Gelerntes festigen',
    icon: RotateCcw, 
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/20'
  },
  mini_check: { 
    label: 'Mini-Check', 
    description: 'Wissen überprüfen',
    icon: ClipboardCheck, 
    color: 'text-pink-400',
    bgColor: 'bg-pink-500/20'
  },
};

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

  useEffect(() => {
    if (lessonId && user) {
      fetchLessonData();
    }
  }, [lessonId, user]);

  const fetchLessonData = async () => {
    if (!lessonId) return;

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

      // Fetch course
      const { data: courseData } = await supabase
        .from('courses')
        .select('id, title')
        .eq('id', moduleData.course_id)
        .single();

      if (courseData) {
        setCourse(courseData);
      }

      // Fetch sibling lessons in this module
      const { data: lessonsData } = await supabase
        .from('lessons')
        .select('*')
        .eq('module_id', moduleData.id)
        .order('sort_order');

      if (lessonsData) {
        setSiblingLessons(lessonsData);
      }
    }

    // Fetch or create progress
    if (user) {
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
    }

    setLoading(false);
  };

  const completeLesson = async () => {
    if (!user || !lesson || !progress) return;

    setCompleting(true);
    const timeSpent = Math.floor((Date.now() - startTime) / 1000);

    const { error } = await supabase
      .from('learning_progress')
      .update({
        completed: true,
        completed_at: new Date().toISOString(),
        time_spent_seconds: (progress.time_spent_seconds || 0) + timeSpent,
      })
      .eq('id', progress.id);

    if (error) {
      toast({ title: 'Fehler beim Speichern', variant: 'destructive' });
    } else {
      setProgress({ ...progress, completed: true });
      toast({ title: 'Lektion abgeschlossen!', description: 'Gut gemacht!' });
    }

    setCompleting(false);
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

  const stepInfo = stepConfig[lesson.step] || stepConfig.einstieg;
  const StepIcon = stepInfo.icon;
  const prevLesson = getPreviousLesson();
  const nextLesson = getNextLesson();

  return (
    <div className="min-h-screen bg-background">
      {/* Top Navigation Bar */}
      <div className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            {/* Left: Back & Course Info */}
            <div className="flex items-center gap-4 min-w-0">
              <Link to={`/course/${course.id}`}>
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              </Link>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">{course.title}</p>
                <p className="text-sm font-medium truncate">{module.title}</p>
              </div>
            </div>

            {/* Center: Progress */}
            <div className="hidden md:flex items-center gap-3 flex-1 max-w-md">
              <Progress value={getModuleProgress()} className="h-2" />
              <span className="text-sm text-muted-foreground whitespace-nowrap">
                {getCurrentLessonIndex() + 1}/{siblingLessons.length}
              </span>
            </div>

            {/* Right: Home */}
            <Link to="/dashboard">
              <Button variant="ghost" size="icon">
                <Home className="h-5 w-5" />
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* 5-Step Progress Indicator */}
      <div className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-center gap-2 mb-8">
          {Object.entries(stepConfig).map(([key, config], idx) => {
            const Icon = config.icon;
            const isActive = key === lesson.step;
            const isPast = Object.keys(stepConfig).indexOf(lesson.step) > idx;

            return (
              <div key={key} className="flex items-center">
                <div 
                  className={`
                    w-10 h-10 rounded-full flex items-center justify-center transition-all
                    ${isActive ? `${config.bgColor} ring-2 ring-offset-2 ring-offset-background ring-primary` : 
                      isPast ? 'bg-primary/20' : 'bg-muted'}
                  `}
                >
                  <Icon className={`h-5 w-5 ${isActive ? config.color : isPast ? 'text-primary' : 'text-muted-foreground'}`} />
                </div>
                {idx < Object.keys(stepConfig).length - 1 && (
                  <div className={`w-8 h-0.5 ${isPast ? 'bg-primary' : 'bg-muted'}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Step Header */}
        <div className="text-center mb-8">
          <Badge className={`${stepInfo.bgColor} ${stepInfo.color} border-0 mb-3`}>
            <StepIcon className="h-4 w-4 mr-1" />
            {stepInfo.label}
          </Badge>
          <h1 className="text-2xl md:text-3xl font-display font-bold">{lesson.title}</h1>
          <p className="text-muted-foreground mt-2">{stepInfo.description}</p>
        </div>

        {/* Content Area */}
        <Card className="glass-card max-w-4xl mx-auto mb-8">
          <CardContent className="p-6 md:p-10">
            {lesson.content ? (
              <div className="prose prose-invert max-w-none">
                {/* Render H5P or custom content based on lesson.content */}
                {(lesson.content as Record<string, unknown>).type === 'h5p' ? (
                  <div className="aspect-video bg-muted rounded-xl flex items-center justify-center">
                    <div className="text-center">
                      <PlayCircle className="h-16 w-16 text-primary mx-auto mb-4" />
                      <p className="text-muted-foreground">H5P Inhalt wird geladen...</p>
                      <p className="text-xs text-muted-foreground mt-2">
                        Content ID: {String((lesson.content as Record<string, unknown>).h5pContentId || 'N/A')}
                      </p>
                    </div>
                  </div>
                ) : (lesson.content as Record<string, unknown>).type === 'text' ? (
                  <div className="space-y-4">
                    <div dangerouslySetInnerHTML={{ 
                      __html: String((lesson.content as Record<string, unknown>).html || '') 
                    }} />
                  </div>
                ) : (lesson.content as Record<string, unknown>).type === 'quiz' ? (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold">Wissensüberprüfung</h3>
                    <p className="text-muted-foreground">
                      Beantworten Sie die folgenden Fragen, um Ihr Verständnis zu testen.
                    </p>
                    <div className="p-6 bg-muted/30 rounded-xl text-center">
                      <ClipboardCheck className="h-12 w-12 text-primary mx-auto mb-3" />
                      <p>Quiz-Komponente wird geladen...</p>
                    </div>
                  </div>
                ) : (
                  <pre className="text-sm bg-muted/30 p-4 rounded-xl overflow-auto">
                    {JSON.stringify(lesson.content, null, 2)}
                  </pre>
                )}
              </div>
            ) : (
              <div className="text-center py-12">
                <BookOpen className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">Inhalte werden erstellt</h3>
                <p className="text-muted-foreground max-w-md mx-auto">
                  Die Lerninhalte für diese Lektion werden noch von der KI generiert. 
                  Bitte schauen Sie später wieder vorbei.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Bottom Navigation */}
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <div>
            {prevLesson && (
              <Button variant="outline" onClick={() => navigateToLesson(prevLesson)}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Vorherige</span>
              </Button>
            )}
          </div>

          <div className="flex-1 flex justify-center">
            {!progress?.completed ? (
              <Button 
                onClick={completeLesson}
                disabled={completing}
                className="gradient-primary text-primary-foreground shadow-glow"
              >
                {completing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4 mr-2" />
                )}
                Als abgeschlossen markieren
              </Button>
            ) : (
              <Badge className="bg-green-500/20 text-green-400 border-0 py-2 px-4">
                <CheckCircle className="h-4 w-4 mr-2" />
                Abgeschlossen
              </Badge>
            )}
          </div>

          <div>
            {nextLesson ? (
              <Button 
                onClick={() => navigateToLesson(nextLesson)}
                className={progress?.completed ? 'gradient-primary text-primary-foreground shadow-glow-sm' : ''}
                variant={progress?.completed ? 'default' : 'outline'}
              >
                <span className="hidden sm:inline">Nächste</span>
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            ) : progress?.completed ? (
              <Link to={`/course/${course.id}`}>
                <Button className="gradient-accent text-accent-foreground">
                  Modul beenden
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
