import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { HeroDecisionCard } from '@/components/dashboard/HeroDecisionCard';
import { ReadinessRadar } from '@/components/dashboard/ReadinessRadar';
import { TopGapsCard } from '@/components/dashboard/TopGapsCard';
import { ReadinessTrendCard } from '@/components/dashboard/ReadinessTrendCard';
import { ExamReadinessGauge } from '@/components/dashboard/ExamReadinessGauge';
import { SmartStreakWidget } from '@/components/dashboard/SmartStreakWidget';
import { ExamPreview } from '@/components/dashboard/ExamPreview';
import { BadgeHistory } from '@/components/dashboard/BadgeHistory';
import { MasteryDashboardSection } from '@/features/mastery/components/MasteryDashboardSection';
import { useSimulationGate } from '@/hooks/useExamReadiness';
import { useProductAccessByCurriculum } from '@/hooks/useProductAccess';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Loader2,
  BookOpen,
  GraduationCap,
  Clock,
  ArrowRight,
  Target,
  Brain,
  Heart,
  Sparkles,
  Mic,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

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
  const navigate = useNavigate();
  const [enrollments, setEnrollments] = useState<EnrolledCourse[]>([]);
  const [progress, setProgress] = useState<Map<string, CourseProgress>>(new Map());
  const [loading, setLoading] = useState(true);
  const [activeCurriculumId, setActiveCurriculumId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    if (user) {
      fetchDashboardData();
    }
  }, [user]);

  const fetchDashboardData = async () => {
    if (!user) return;

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
      const typedEnrollments = enrollmentData.map(e => ({
        ...e,
        course: e.course as unknown as EnrolledCourse['course'] & { curriculum_id?: string }
      })) as (EnrolledCourse & { course: EnrolledCourse['course'] & { curriculum_id?: string } })[];

      setEnrollments(typedEnrollments);

      if (typedEnrollments.length > 0 && typedEnrollments[0].course?.curriculum_id) {
        setActiveCurriculumId(typedEnrollments[0].course.curriculum_id);
      }

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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="py-4 sm:py-8 px-3 sm:px-4">
      <div className="container mx-auto max-w-3xl">
        {/* ━━━ Compact Header ━━━ */}
        <div className="mb-5">
          <h1 className="text-xl sm:text-2xl font-display font-bold leading-tight">
            Hallo,{' '}
            <span className="text-gradient">
              {user?.user_metadata?.full_name || user?.email?.split('@')[0]}
            </span>
          </h1>
          {isAdmin && (
            <Link to="/admin/command">
              <Button variant="ghost" size="sm" className="mt-1 h-8 text-xs">
                <Sparkles className="h-3 w-3 mr-1" />
                Admin
              </Button>
            </Link>
          )}
        </div>

        {/* ━━━ HERO: Single Decision Card (Above the Fold) ━━━ */}
        {activeCurriculumId && (
          <div className="mb-6">
            <HeroDecisionCard curriculumId={activeCurriculumId} />
          </div>
        )}

        {/* ━━━ SECTION 2: Mastery Overview (Readiness + Weakness) ━━━ */}
        {activeCurriculumId && (
          <div className="mb-6">
            <MasteryDashboardSection curriculumId={activeCurriculumId} />
          </div>
        )}

        {/* ━━━ SECTION 3: Meine Trainings (kompakt) ━━━ */}
        {enrollments.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-display font-semibold">Meine Trainings</h2>
              <Link to="/courses">
                <Button variant="ghost" size="sm" className="text-xs h-7">
                  Alle <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </Link>
            </div>
            <div className="space-y-2">
              {enrollments.slice(0, 2).map((enrollment) => {
                const courseProgress = getCourseProgress(enrollment.course_id);
                return (
                  <Link key={enrollment.course_id} to={`/course/${enrollment.course_id}`}>
                    <Card className="glass-card hover:border-primary/30 transition-all">
                      <CardContent className="p-3 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
                          {enrollment.course.thumbnail_url ? (
                            <img src={enrollment.course.thumbnail_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <BookOpen className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{enrollment.course.title}</div>
                          <Progress value={courseProgress} className="h-1 mt-1" />
                        </div>
                        <span className="text-xs font-medium text-muted-foreground flex-shrink-0">
                          {courseProgress}%
                        </span>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* ━━━ SECTION 4: Collapsible Details ━━━ */}
        <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full mb-4 h-10 justify-between">
              <span className="text-sm font-medium">
                {detailsOpen ? 'Details ausblenden' : 'Detaillierte Analyse anzeigen'}
              </span>
              <ChevronDown className={cn('h-4 w-4 transition-transform', detailsOpen && 'rotate-180')} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4">
            {activeCurriculumId && (
              <>
                {/* Readiness Trend + Gauge */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <ExamReadinessGauge curriculumId={activeCurriculumId} />
                  <ReadinessTrendCard curriculumId={activeCurriculumId} />
                </div>

                {/* Radar + Top Gaps */}
                <ReadinessRadar curriculumId={activeCurriculumId} />
                <TopGapsCard curriculumId={activeCurriculumId} />

                {/* Streak + Exam Preview */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <SmartStreakWidget />
                  <ExamPreview curriculumId={activeCurriculumId} />
                </div>

                {/* Badges */}
                <BadgeHistory />
              </>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* ━━━ SECTION 5: Quick Actions (kompakt) ━━━ */}
        <QuickActionsGrid activeCurriculumId={activeCurriculumId} />

        {/* Empty state */}
        {enrollments.length === 0 && !activeCurriculumId && (
          <Card className="glass-card mt-6">
            <CardContent className="p-10 text-center">
              <GraduationCap className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
              <h3 className="text-lg font-semibold mb-1">Noch kein Prüfungstraining</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Starte jetzt deine Prüfungsvorbereitung!
              </p>
              <Link to="/courses">
                <Button className="gradient-primary text-primary-foreground shadow-glow">
                  Training entdecken
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function QuickActionsGrid({ activeCurriculumId }: { activeCurriculumId: string | null }) {
  const { data: gate } = useSimulationGate(activeCurriculumId ?? undefined);
  const { data: hasExamTrainer, isLoading: entitlementLoading } = useProductAccessByCurriculum(
    activeCurriculumId ?? undefined, 'exam_trainer'
  );
  const simulationBlocked = gate && !gate.allowed;
  const adaptiveBlocked = !entitlementLoading && !hasExamTrainer;

  const actions = [
    { to: '/exam-trainer', icon: Target, label: 'Prüfungstrainer', gradient: 'gradient-accent', blocked: false },
    { to: '/exam-simulation', icon: GraduationCap, label: 'Simulation', gradient: 'gradient-primary', blocked: !!simulationBlocked },
    { to: '/oral-exam', icon: Mic, label: 'Mündlich', gradient: 'bg-gradient-to-br from-blue-500 to-cyan-500', blocked: false },
    { to: '/spaced-repetition', icon: Brain, label: 'Wiederholen', gradient: 'bg-gradient-to-br from-purple-500 to-indigo-600', blocked: false },
    { to: '/exam-anxiety', icon: Heart, label: 'Stressabbau', gradient: 'bg-gradient-to-br from-rose-500 to-pink-600', blocked: false },
  ];

  return (
    <div className="mt-6">
      <h2 className="text-base font-display font-semibold mb-3">Schnellzugriff</h2>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {actions.map((action) => {
          const content = (
            <Card className={cn(
              'glass-card transition-all touch-manipulation',
              action.blocked ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary/30 active:scale-[0.97]'
            )}>
              <CardContent className="p-3 text-center">
                <div className={`p-2 rounded-lg ${action.gradient} inline-flex mb-1.5 ${action.blocked ? 'grayscale' : ''}`}>
                  <action.icon className="h-4 w-4 text-white" />
                </div>
                <h3 className="font-medium text-xs leading-tight">{action.label}</h3>
              </CardContent>
            </Card>
          );

          if (action.blocked) {
            return <div key={action.to}>{content}</div>;
          }

          return <Link key={action.to} to={action.to}>{content}</Link>;
        })}
      </div>
    </div>
  );
}
