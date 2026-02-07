import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useCourseProgress, type LessonStatus, getStatusBgColor, getStatusLabel } from '@/hooks/useCourseProgress';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/hooks/use-toast';
import { CourseProgressBar } from '@/components/course/CourseProgressBar';
import { LessonStatusBadge } from '@/components/course/LessonStatusBadge';
import { ContinueLearningCard } from '@/components/course/ContinueLearningCard';
import { 
  Loader2, 
  Clock, 
  BookOpen, 
  ArrowLeft, 
  CheckCircle, 
  PlayCircle,
  Lock,
  ChevronDown,
  ChevronUp,
  RotateCcw
} from 'lucide-react';

interface Course {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  estimated_duration: number | null;
}

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

interface LearningProgress {
  lesson_id: string;
  completed: boolean;
}

interface CompetencyProgress {
  competency_code: string;
  competency_title: string | null;
  status: LessonStatus;
  mastery_level: number;
  lesson_count: number;
}

export default function CourseDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [progress, setProgress] = useState<LearningProgress[]>([]);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());

  // Use the course progress hook for enrolled users
  const { data: courseProgress, isLoading: progressLoading } = useCourseProgress(
    isEnrolled ? slug : undefined
  );

  // Derive competency progress from lessons
  const competencyProgress = useMemo((): CompetencyProgress[] => {
    if (!courseProgress?.lessons) return [];

    const competencyMap = new Map<string, {
      code: string;
      title: string | null;
      scores: number[];
      statuses: LessonStatus[];
    }>();

    for (const lesson of courseProgress.lessons) {
      if (!lesson.competency_code) continue;
      
      const key = lesson.competency_code;
      if (!competencyMap.has(key)) {
        competencyMap.set(key, {
          code: lesson.competency_code,
          title: lesson.competency_title,
          scores: [],
          statuses: [],
        });
      }
      
      const entry = competencyMap.get(key)!;
      entry.statuses.push(lesson.status);
      if (lesson.score_percent !== null) {
        entry.scores.push(lesson.score_percent);
      }
    }

    return Array.from(competencyMap.values()).map(c => {
      const avgScore = c.scores.length > 0 
        ? c.scores.reduce((a, b) => a + b, 0) / c.scores.length 
        : 0;
      
      // Determine overall status based on lesson statuses
      let overallStatus: LessonStatus = 'not_started';
      if (c.statuses.every(s => s === 'mastered')) {
        overallStatus = 'mastered';
      } else if (c.statuses.some(s => s === 'not_mastered')) {
        overallStatus = 'not_mastered';
      } else if (c.statuses.some(s => s === 'partial')) {
        overallStatus = 'partial';
      } else if (c.statuses.some(s => s === 'in_progress' || s === 'mastered')) {
        overallStatus = 'in_progress';
      }

      return {
        competency_code: c.code,
        competency_title: c.title,
        status: overallStatus,
        mastery_level: avgScore,
        lesson_count: c.statuses.length,
      };
    });
  }, [courseProgress?.lessons]);

  useEffect(() => {
    if (slug) {
      fetchCourseData();
    }
  }, [slug, user]);

  const fetchCourseData = async () => {
    // Fetch course
    const { data: courseData, error: courseError } = await supabase
      .from('courses')
      .select('*')
      .eq('id', slug)
      .single();

    if (courseError || !courseData) {
      toast({ title: 'Kurs nicht gefunden', variant: 'destructive' });
      navigate('/courses');
      return;
    }

    setCourse(courseData);

    // Fetch modules
    const { data: modulesData } = await supabase
      .from('modules')
      .select('*')
      .eq('course_id', courseData.id)
      .order('sort_order');

    if (modulesData) {
      setModules(modulesData);
      // Expand first module by default
      if (modulesData.length > 0) {
        setExpandedModules(new Set([modulesData[0].id]));
      }
    }

    // Fetch lessons
    if (modulesData && modulesData.length > 0) {
      const moduleIds = modulesData.map(m => m.id);
      const { data: lessonsData } = await supabase
        .from('lessons')
        .select('*')
        .in('module_id', moduleIds)
        .order('sort_order');

      if (lessonsData) {
        setLessons(lessonsData);
      }
    }

    // Check enrollment and progress
    if (user) {
      const { data: enrollmentData } = await supabase
        .from('course_enrollments')
        .select('*')
        .eq('course_id', courseData.id)
        .eq('user_id', user.id)
        .single();

      setIsEnrolled(!!enrollmentData);

      // Fetch progress
      if (modulesData) {
        const moduleIds = modulesData.map(m => m.id);
        const { data: lessonsData } = await supabase
          .from('lessons')
          .select('id')
          .in('module_id', moduleIds);

        if (lessonsData) {
          const lessonIds = lessonsData.map(l => l.id);
          const { data: progressData } = await supabase
            .from('learning_progress')
            .select('lesson_id, completed')
            .in('lesson_id', lessonIds)
            .eq('user_id', user.id);

          if (progressData) {
            setProgress(progressData);
          }
        }
      }
    }

    setLoading(false);
  };

  const handleEnroll = async () => {
    if (!user) {
      navigate('/auth', { state: { from: `/course/${slug}` } });
      return;
    }

    setEnrolling(true);
    const { error } = await supabase
      .from('course_enrollments')
      .insert({
        user_id: user.id,
        course_id: course!.id
      });

    if (error) {
      toast({ title: 'Fehler bei der Einschreibung', variant: 'destructive' });
    } else {
      setIsEnrolled(true);
      toast({ title: 'Erfolgreich eingeschrieben!' });
    }
    setEnrolling(false);
  };

  const toggleModule = (moduleId: string) => {
    const newExpanded = new Set(expandedModules);
    if (newExpanded.has(moduleId)) {
      newExpanded.delete(moduleId);
    } else {
      newExpanded.add(moduleId);
    }
    setExpandedModules(newExpanded);
  };

  const isLessonCompleted = (lessonId: string) => {
    // Use courseProgress if available
    if (courseProgress?.lessons) {
      const lessonProgress = courseProgress.lessons.find(l => l.lesson_id === lessonId);
      return lessonProgress?.status === 'mastered' || lessonProgress?.status === 'partial';
    }
    return progress.some(p => p.lesson_id === lessonId && p.completed);
  };

  const getLessonStatus = (lessonId: string): LessonStatus => {
    if (courseProgress?.lessons) {
      const lessonProgress = courseProgress.lessons.find(l => l.lesson_id === lessonId);
      return lessonProgress?.status ?? 'not_started';
    }
    const lessonProgress = progress.find(p => p.lesson_id === lessonId);
    if (lessonProgress?.completed) return 'mastered';
    return 'not_started';
  };

  const getLessonNeedsReview = (lessonId: string): boolean => {
    if (courseProgress?.lessons) {
      const lessonProgress = courseProgress.lessons.find(l => l.lesson_id === lessonId);
      return lessonProgress?.needs_review ?? false;
    }
    return false;
  };

  const getLessonScore = (lessonId: string): number | null => {
    if (courseProgress?.lessons) {
      const lessonProgress = courseProgress.lessons.find(l => l.lesson_id === lessonId);
      return lessonProgress?.score_percent ?? null;
    }
    return null;
  };

  const getModuleLessons = (moduleId: string) => {
    return lessons.filter(l => l.module_id === moduleId);
  };

  const getModuleProgress = (moduleId: string) => {
    const moduleLessons = getModuleLessons(moduleId);
    if (moduleLessons.length === 0) return 0;
    const completed = moduleLessons.filter(l => isLessonCompleted(l.id)).length;
    return Math.round((completed / moduleLessons.length) * 100);
  };

  const getTotalProgress = () => {
    if (courseProgress) return courseProgress.progress_percent;
    if (lessons.length === 0) return 0;
    const completed = lessons.filter(l => isLessonCompleted(l.id)).length;
    return Math.round((completed / lessons.length) * 100);
  };

  const getNextLessonId = (): string | null => {
    if (courseProgress?.next_lesson) {
      return courseProgress.next_lesson.lesson_id;
    }
    // Fallback: find first incomplete lesson
    for (const module of modules) {
      const moduleLessons = getModuleLessons(module.id);
      for (const lesson of moduleLessons) {
        if (!isLessonCompleted(lesson.id)) {
          return lesson.id;
        }
      }
    }
    return lessons[0]?.id ?? null;
  };

  const handleContinue = () => {
    const nextId = getNextLessonId();
    if (nextId) {
      navigate(`/lesson/${nextId}`);
    }
  };

  const handleLessonClick = (lessonId: string, locked: boolean) => {
    if (locked) return;
    navigate(`/lesson/${lessonId}`);
  };

  const stepLabels: Record<string, string> = {
    einstieg: 'Einstieg',
    verstehen: 'Verstehen',
    anwenden: 'Anwenden',
    wiederholen: 'Wiederholen',
    mini_check: 'Mini-Check'
  };

  const stepColors: Record<string, string> = {
    einstieg: 'bg-blue-500',
    verstehen: 'bg-purple-500',
    anwenden: 'bg-green-500',
    wiederholen: 'bg-orange-500',
    mini_check: 'bg-pink-500'
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!course) {
    return null;
  }

  return (
    <div className="py-8 px-4">
      <div className="container mx-auto max-w-5xl">
        {/* Back Button */}
        <Link to="/courses" className="inline-flex items-center text-muted-foreground hover:text-foreground mb-6 transition-colors">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Zurück zu Kursen
        </Link>

        {/* Course Header */}
        <div className="glass-card rounded-2xl overflow-hidden mb-8">
          <div className="aspect-video md:aspect-[3/1] bg-muted relative">
            {course.thumbnail_url ? (
              <img 
                src={course.thumbnail_url} 
                alt={course.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center gradient-hero opacity-50">
                <BookOpen className="h-20 w-20 text-primary-foreground" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-background/90 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-6 md:p-8">
              <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2">
                {course.title}
              </h1>
              <p className="text-muted-foreground max-w-2xl mb-4">
                {course.description}
              </p>
              <div className="flex flex-wrap items-center gap-4">
                {course.estimated_duration && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    {course.estimated_duration} Minuten
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <BookOpen className="h-4 w-4" />
                  {modules.length} Module
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <PlayCircle className="h-4 w-4" />
                  {lessons.length} Lektionen
                </div>
              </div>
            </div>
          </div>

        {/* Enrollment / Progress Bar */}
          <div className="p-6 border-t border-border">
            {isEnrolled ? (
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex-1 w-full md:w-auto">
                  {courseProgress ? (
                    <CourseProgressBar 
                      summary={courseProgress.summary}
                      progressPercent={courseProgress.progress_percent}
                      showDetails={true}
                    />
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-muted-foreground">Fortschritt</span>
                        <span className="text-sm font-medium">{getTotalProgress()}%</span>
                      </div>
                      <Progress value={getTotalProgress()} className="h-2" />
                    </>
                  )}
                </div>
                <Button 
                  onClick={handleContinue}
                  className="gradient-primary text-primary-foreground shadow-glow-sm"
                >
                  <PlayCircle className="h-4 w-4 mr-2" />
                  {getTotalProgress() > 0 ? 'Fortsetzen' : 'Kurs starten'}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <p className="text-muted-foreground">
                  Melde dich an, um mit diesem Kurs zu beginnen und deinen Fortschritt zu speichern.
                </p>
                <Button 
                  onClick={handleEnroll} 
                  disabled={enrolling}
                  className="gradient-primary text-primary-foreground shadow-glow"
                >
                  {enrolling ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <PlayCircle className="h-4 w-4 mr-2" />
                  )}
                  {user ? 'Jetzt einschreiben' : 'Anmelden & Starten'}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Continue Learning Card for enrolled users with progress */}
        {isEnrolled && courseProgress && courseProgress.progress_percent > 0 && (
          <div className="mb-8">
            <ContinueLearningCard
              courseId={course.id}
              courseTitle={course.title}
              progress={courseProgress}
            />
          </div>
        )}

        {/* Competency Progress Section */}
        {isEnrolled && competencyProgress.length > 0 && (
          <div className="space-y-4 mb-8">
            <h2 className="text-2xl font-display font-bold">Kompetenz-Fortschritt</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {competencyProgress.map((c) => {
                const statusVariant = c.status === 'mastered' 
                  ? 'default' 
                  : c.status === 'not_mastered' 
                    ? 'destructive' 
                    : 'secondary';
                const statusClassName = c.status === 'mastered' 
                  ? 'bg-green-500' 
                  : c.status === 'partial' 
                    ? 'bg-yellow-500 text-yellow-950' 
                    : '';

                return (
                  <Card key={c.competency_code} className="glass-card">
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium truncate">{c.competency_title || 'Unbekannte Kompetenz'}</p>
                          <p className="text-xs text-muted-foreground truncate">{c.competency_code}</p>
                        </div>
                        <Badge variant={statusVariant} className={statusClassName}>
                          {getStatusLabel(c.status)}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{c.lesson_count} Lektionen</span>
                        <span>{Math.round(c.mastery_level)}%</span>
                      </div>
                      <Progress value={Math.max(0, Math.min(100, c.mastery_level))} className="h-2" />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Modules List */}
        <div className="space-y-4">
          <h2 className="text-2xl font-display font-bold">Kursinhalt</h2>
          
          {modules.length === 0 ? (
            <Card className="glass-card">
              <CardContent className="p-8 text-center">
                <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">
                  Dieser Kurs hat noch keine Module.
                </p>
              </CardContent>
            </Card>
          ) : (
            modules.map((module, index) => {
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
                    {isEnrolled && (
                      <Progress value={moduleProgress} className="h-1 mt-4" />
                    )}
                  </CardHeader>

                  {isExpanded && (
                    <CardContent className="pt-0 pb-4">
                      <div className="space-y-2">
                        {moduleLessons.map((lesson) => {
                          const status = getLessonStatus(lesson.id);
                          const needsReview = getLessonNeedsReview(lesson.id);
                          const score = getLessonScore(lesson.id);
                          const locked = !isEnrolled;
                          const completed = status === 'mastered' || status === 'partial';

                          return (
                            <div 
                              key={lesson.id}
                              onClick={() => handleLessonClick(lesson.id, locked)}
                              className={`flex items-center justify-between p-3 rounded-lg transition-colors border ${
                                locked 
                                  ? 'bg-muted/30 opacity-60 cursor-not-allowed' 
                                  : `${getStatusBgColor(status)} hover:bg-muted/50 cursor-pointer`
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                {locked ? (
                                  <Lock className="h-5 w-5 text-muted-foreground" />
                                ) : status === 'mastered' ? (
                                  <CheckCircle className="h-5 w-5 text-green-500" />
                                ) : needsReview ? (
                                  <RotateCcw className="h-5 w-5 text-orange-500" />
                                ) : (
                                  <PlayCircle className="h-5 w-5 text-primary" />
                                )}
                                <div className="flex-1">
                                  <span className="font-medium">{lesson.title}</span>
                                  <div className="flex flex-wrap items-center gap-2 mt-1">
                                    <Badge variant="secondary" className={`text-xs ${stepColors[lesson.step]} text-white`}>
                                      {stepLabels[lesson.step] || lesson.step}
                                    </Badge>
                                    {lesson.duration_minutes && (
                                      <span className="text-xs text-muted-foreground">
                                        {lesson.duration_minutes} Min.
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              
                              {/* Status Badge for enrolled users */}
                              {isEnrolled && status !== 'not_started' && (
                                <div className="hidden sm:block">
                                  <LessonStatusBadge 
                                    status={status}
                                    needsReview={needsReview}
                                    scorePercent={score}
                                    showScore={true}
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
            })
          )}
        </div>
      </div>
    </div>
  );
}
