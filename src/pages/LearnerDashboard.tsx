import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useDashboardStats } from '@/hooks/useDashboardStats';
import { ReadinessWidget } from '@/components/dashboard/ReadinessWidget';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { 
  Loader2, 
  BookOpen, 
  GraduationCap, 
  Clock,
  ArrowRight,
  Target,
  Award,
  Calendar,
  Brain,
  Heart,
  Sparkles,
} from 'lucide-react';

interface EnrolledCourse {
  course_id: string;
  enrolled_at: string;
  last_accessed_at: string | null;
  completed_at: string | null;
  course: {
    id: string;
    title: string;
    description: string | null;
    thumbnail_url: string | null;
    estimated_duration: number | null;
  };
}

interface CourseProgress {
  courseId: string;
  totalLessons: number;
  completedLessons: number;
}

export default function LearnerDashboard() {
  const { user, isAdmin } = useAuth();
  const { data: dashboardStats } = useDashboardStats();
  const [enrollments, setEnrollments] = useState<EnrolledCourse[]>([]);
  const [progress, setProgress] = useState<Map<string, CourseProgress>>(new Map());
  const [loading, setLoading] = useState(true);
  const [activeCurriculumId, setActiveCurriculumId] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      fetchDashboardData();
    }
  }, [user]);

  const fetchDashboardData = async () => {
    if (!user) return;

    // Fetch enrolled courses with curriculum info
    const { data: enrollmentData } = await supabase
      .from('course_enrollments')
      .select(`
        course_id,
        enrolled_at,
        last_accessed_at,
        completed_at,
        course:courses(id, title, description, thumbnail_url, estimated_duration, curriculum_id)
      `)
      .eq('user_id', user.id)
      .order('last_accessed_at', { ascending: false, nullsFirst: false });

    if (enrollmentData) {
      // Type assertion for the nested query result
      const typedEnrollments = enrollmentData.map(e => ({
        ...e,
        course: e.course as unknown as EnrolledCourse['course'] & { curriculum_id?: string }
      })) as (EnrolledCourse & { course: EnrolledCourse['course'] & { curriculum_id?: string } })[];
      
      setEnrollments(typedEnrollments);
      
      // Set active curriculum from most recent course
      if (typedEnrollments.length > 0 && typedEnrollments[0].course?.curriculum_id) {
        setActiveCurriculumId(typedEnrollments[0].course.curriculum_id);
      }

      // Fetch progress for each course
      const progressMap = new Map<string, CourseProgress>();
      
      for (const enrollment of typedEnrollments) {
        const { data: modules } = await supabase
          .from('modules')
          .select('id')
          .eq('course_id', enrollment.course_id);

        if (modules && modules.length > 0) {
          const moduleIds = modules.map(m => m.id);
          
          const { data: lessons } = await supabase
            .from('lessons')
            .select('id')
            .in('module_id', moduleIds);

          if (lessons) {
            const lessonIds = lessons.map(l => l.id);
            
            const { data: progressData } = await supabase
              .from('learning_progress')
              .select('lesson_id')
              .in('lesson_id', lessonIds)
              .eq('user_id', user.id)
              .eq('completed', true);

            progressMap.set(enrollment.course_id, {
              courseId: enrollment.course_id,
              totalLessons: lessons.length,
              completedLessons: progressData?.length || 0
            });
          }
        }
      }
      
      setProgress(progressMap);
    }

    setLoading(false);
  };

  const getCourseProgress = (courseId: string) => {
    const p = progress.get(courseId);
    if (!p || p.totalLessons === 0) return 0;
    return Math.round((p.completedLessons / p.totalLessons) * 100);
  };

  const getCompletedCoursesCount = () => {
    return enrollments.filter(e => e.completed_at).length;
  };

  const getTotalCompletedLessons = () => {
    let total = 0;
    progress.forEach(p => {
      total += p.completedLessons;
    });
    return total;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="py-8 px-4">
      <div className="container mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl font-display font-bold mb-2">
            Willkommen zurück,{' '}
            <span className="text-gradient">
              {user?.user_metadata?.full_name || user?.email?.split('@')[0]}
            </span>
          </h1>
          <p className="text-muted-foreground">
            Hier ist eine Übersicht deiner Lernfortschritte.
          </p>
          {isAdmin && (
            <Link to="/admin-v2/dashboard">
              <Button variant="outline" size="sm" className="mt-3">
                <Sparkles className="h-4 w-4 mr-2" />
                Admin Control Center öffnen
              </Button>
            </Link>
          )}
        </div>

        {/* Readiness Widget - shows adaptive recommendations */}
        {activeCurriculumId && (
          <div className="mb-8">
            <ReadinessWidget curriculumId={activeCurriculumId} />
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card className="glass-card">
            <CardContent className="p-6 text-center">
              <BookOpen className="h-8 w-8 text-primary mx-auto mb-2" />
              <div className="text-3xl font-display font-bold text-gradient">
                {enrollments.length}
              </div>
              <div className="text-sm text-muted-foreground">Kurse eingeschrieben</div>
            </CardContent>
          </Card>
          
          <Card className="glass-card">
            <CardContent className="p-6 text-center">
              <Award className="h-8 w-8 text-green-500 mx-auto mb-2" />
              <div className="text-3xl font-display font-bold text-green-500">
                {getCompletedCoursesCount()}
              </div>
              <div className="text-sm text-muted-foreground">Kurse abgeschlossen</div>
            </CardContent>
          </Card>
          
          <Card className="glass-card">
            <CardContent className="p-6 text-center">
              <Target className="h-8 w-8 text-accent mx-auto mb-2" />
              <div className="text-3xl font-display font-bold text-gradient-accent">
                {getTotalCompletedLessons()}
              </div>
              <div className="text-sm text-muted-foreground">Lektionen abgeschlossen</div>
            </CardContent>
          </Card>
          
          <Card className="glass-card">
            <CardContent className="p-6 text-center">
              <Calendar className="h-8 w-8 text-orange-500 mx-auto mb-2" />
              <div className="text-3xl font-display font-bold text-orange-500">
                {dashboardStats?.streak ?? 0}
              </div>
              <div className="text-sm text-muted-foreground">Tage Streak</div>
            </CardContent>
          </Card>
        </div>

        {/* Enrolled Courses */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-display font-semibold">Meine Kurse</h2>
            <Link to="/courses">
              <Button variant="ghost" size="sm">
                Alle Kurse
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </div>

          {enrollments.length === 0 ? (
            <Card className="glass-card">
              <CardContent className="p-12 text-center">
                <GraduationCap className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-xl font-semibold mb-2">Noch keine Kurse</h3>
                <p className="text-muted-foreground mb-6">
                  Du hast dich noch für keinen Kurs eingeschrieben. 
                  Entdecke unsere Kurse und starte dein Lernen!
                </p>
                <Link to="/courses">
                  <Button className="gradient-primary text-primary-foreground shadow-glow">
                    Kurse entdecken
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 gap-6">
              {enrollments.map((enrollment) => {
                const courseProgress = getCourseProgress(enrollment.course_id);
                const isCompleted = enrollment.completed_at != null;

                return (
                  <Card key={enrollment.course_id} className="glass-card border-border hover:border-primary/30 transition-all group">
                    <div className="flex">
                      {/* Thumbnail */}
                      <div className="w-32 h-32 flex-shrink-0 bg-muted rounded-l-lg overflow-hidden">
                        {enrollment.course.thumbnail_url ? (
                          <img 
                            src={enrollment.course.thumbnail_url} 
                            alt={enrollment.course.title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center gradient-primary opacity-50">
                            <BookOpen className="h-8 w-8 text-primary-foreground" />
                          </div>
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 p-4">
                        <CardHeader className="p-0 pb-2">
                          <CardTitle className="text-lg font-display group-hover:text-primary transition-colors line-clamp-1">
                            {enrollment.course.title}
                          </CardTitle>
                          <CardDescription className="line-clamp-1">
                            {enrollment.course.description || 'Keine Beschreibung'}
                          </CardDescription>
                        </CardHeader>
                        
                        <CardContent className="p-0">
                          {/* Progress */}
                          <div className="mb-3">
                            <div className="flex items-center justify-between text-sm mb-1">
                              <span className="text-muted-foreground">Fortschritt</span>
                              <span className="font-medium">{courseProgress}%</span>
                            </div>
                            <Progress value={courseProgress} className="h-2" />
                          </div>

                          {/* Meta Info */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                              {enrollment.course.estimated_duration && (
                                <div className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {enrollment.course.estimated_duration} Min.
                                </div>
                              )}
                            </div>
                            
                            <Link to={`/course/${enrollment.course_id}`}>
                              <Button size="sm" className="gradient-primary text-primary-foreground text-xs">
                                {isCompleted ? 'Wiederholen' : 'Fortsetzen'}
                              </Button>
                            </Link>
                          </div>
                        </CardContent>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="glass-card group hover:border-accent/30 transition-all">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl gradient-accent shadow-glow-accent">
                  <Target className="h-6 w-6 text-accent-foreground" />
                </div>
                <div className="flex-1">
                  <h3 className="font-display font-bold text-lg mb-1">Prüfungstrainer</h3>
                  <p className="text-muted-foreground text-sm mb-4">
                    KI-generierte Prüfungsfragen
                  </p>
                  <Link to="/exam-trainer">
                    <Button variant="outline" size="sm" className="group-hover:border-accent/50">
                      Zum Trainer
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card group hover:border-primary/30 transition-all">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl gradient-primary shadow-glow-sm">
                  <Brain className="h-6 w-6 text-primary-foreground" />
                </div>
                <div className="flex-1">
                  <h3 className="font-display font-bold text-lg mb-1">Spaced Repetition</h3>
                  <p className="text-muted-foreground text-sm mb-4">
                    Optimales Lernen mit SM-2
                  </p>
                  <Link to="/spaced-repetition">
                    <Button variant="outline" size="sm" className="group-hover:border-primary/50">
                      Lernen starten
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card group hover:border-rose-500/30 transition-all">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 shadow-lg">
                  <Heart className="h-6 w-6 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="font-display font-bold text-lg mb-1">Prüfungsangst</h3>
                  <p className="text-muted-foreground text-sm mb-4">
                    Entspannungstechniken
                  </p>
                  <Link to="/exam-anxiety">
                    <Button variant="outline" size="sm" className="group-hover:border-rose-500/50">
                      Übungen starten
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card group hover:border-yellow-500/30 transition-all">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-gradient-to-br from-yellow-500 to-orange-600 shadow-lg">
                  <Sparkles className="h-6 w-6 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="font-display font-bold text-lg mb-1">VARK Lerntyp</h3>
                  <p className="text-muted-foreground text-sm mb-4">
                    Finde deinen Lernstil
                  </p>
                  <Link to="/vark-test">
                    <Button variant="outline" size="sm" className="group-hover:border-yellow-500/50">
                      Test starten
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
