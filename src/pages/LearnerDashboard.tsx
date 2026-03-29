import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useDashboardStats } from '@/hooks/useDashboardStats';
import { ReadinessRadar } from '@/components/dashboard/ReadinessRadar';
import { RiskCostWidget } from '@/components/dashboard/RiskCostWidget';
import { NextBestAction } from '@/components/dashboard/NextBestAction';
import { NextBestActionCard } from '@/components/dashboard/NextBestActionCard';
import { SmartStreakWidget } from '@/components/dashboard/SmartStreakWidget';
import { ExamTrapsWidget } from '@/components/dashboard/ExamTrapsWidget';
import { CoachHint } from '@/components/dashboard/CoachHint';
import { ExamPreview } from '@/components/dashboard/ExamPreview';
import { SilentMotivation } from '@/components/dashboard/SilentMotivation';
import { DailyHumorCard } from '@/components/dashboard/DailyHumorCard';
import ProgressNarrative from '@/components/dashboard/ProgressNarrative';
import { BadgeHistory } from '@/components/dashboard/BadgeHistory';
import { ExamReadinessGauge } from '@/components/dashboard/ExamReadinessGauge';
import { WeaknessLoopWidget } from '@/components/dashboard/WeaknessLoopWidget';
import { TopGapsCard } from '@/components/dashboard/TopGapsCard';
import { SmartRecommendationsCard } from '@/components/dashboard/SmartRecommendationsCard';
import { ReadinessTrendCard } from '@/components/dashboard/ReadinessTrendCard';
import { ExamFitInsightsPanel } from '@/components/learner/ExamFitInsightsPanel';
import { MasteryDashboardSection } from '@/features/mastery/components/MasteryDashboardSection';
import { useConversionEngine } from '@/features/conversion/hooks/useConversionEngine';
import { ConversionCard } from '@/features/conversion/components/ConversionCard';
import { useSimulationGate } from '@/hooks/useExamReadiness';
import { useProductAccessByCurriculum } from '@/hooks/useProductAccess';
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
  Brain,
  Heart,
  Sparkles,
  Mic,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import PageExplainer from '@/components/admin/PageExplainer';

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
  const navigate = useNavigate();
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
      <div className="container mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-5 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold mb-1 leading-tight">
            Willkommen zurück,{' '}
            <span className="text-gradient">
              {user?.user_metadata?.full_name || user?.email?.split('@')[0]}
            </span>
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground mb-4">
            Dein Prüfungscockpit – du weißt genau, wo du stehst.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/exam-simulation">
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow font-bold h-12 sm:h-14 px-6 sm:px-8 touch-manipulation">
                <Target className="h-5 w-5 mr-2" />
                Prüfung starten
              </Button>
            </Link>
            {isAdmin && (
              <Link to="/admin/command">
                <Button variant="outline" size="sm" className="h-10 touch-manipulation">
                  <Sparkles className="h-4 w-4 mr-2" />
                  Admin
                </Button>
              </Link>
            )}
          </div>
        </div>

        <PageExplainer
          title="Wie funktioniert dein Dashboard?"
          description="Dein persönliches Prüfungscockpit zeigt dir deinen aktuellen Lernstand, Prüfungsreife und empfiehlt dir die nächsten Schritte. Alles ist darauf ausgerichtet, dich optimal auf deine IHK-Prüfung vorzubereiten."
          workflow={[
            { label: 'Diagnose' },
            { label: 'Lernen' },
            { label: 'Üben' },
            { label: 'Dashboard', active: true },
            { label: 'Prüfung' },
          ]}
          actions={[
            '"Prüfung starten" – Starte eine Prüfungssimulation unter Echtbedingungen',
            'Klick auf ein Training → Öffnet die Kursübersicht mit Modulen und Lektionen',
            'Quick Actions unten → Direktzugriff auf Trainer, Simulation, Mündlich, Wiederholung',
          ]}
          tips={[
            'Der Readiness-Gauge zeigt deine geschätzte Bestehenswahrscheinlichkeit',
            'Coach-Hinweise geben dir personalisierte Lernempfehlungen',
            'Die Schwächenanalyse identifiziert deine größten Lücken automatisch',
          ]}
        />

        {/* Silent Motivation Banner */}
        {activeCurriculumId && (
          <div className="mb-4">
            <SilentMotivation curriculumId={activeCurriculumId} />
          </div>
        )}

        {/* ━━━ SECTION 0: ExamFit v2 Insights ━━━ */}
        {activeCurriculumId && (
          <div className="mb-6">
            <ExamFitInsightsPanel curriculumId={activeCurriculumId} />
          </div>
        )}

        {/* ━━━ SECTION 0a: Mastery Readiness + Weakness Map ━━━ */}
        {activeCurriculumId && (
          <div className="mb-6">
            <MasteryDashboardSection curriculumId={activeCurriculumId} />
          </div>
        )}

        {/* ━━━ SECTION 0b: Conversion Card ━━━ */}
        {activeCurriculumId && (
          <div className="mb-6">
            <ConversionCardWrapper curriculumId={activeCurriculumId} navigate={navigate} />
          </div>
        )}

        {/* ━━━ SECTION 0c: Growth Council Nudge ━━━ */}
        <div className="mb-4">
          <NextBestActionCard />
        </div>

        {/* ━━━ SECTION 1: Smart Recommendations + Next Best Action + Coach Hint ━━━ */}
        {activeCurriculumId && (
          <div className="space-y-4 mb-6">
            <SmartRecommendationsCard curriculumId={activeCurriculumId} />
            <NextBestAction curriculumId={activeCurriculumId} />
            <CoachHint curriculumId={activeCurriculumId} />
          </div>
        )}

        {/* ━━━ SECTION 2: Risk Cost Warning ━━━ */}
        {activeCurriculumId && (
          <div className="mb-6">
            <RiskCostWidget curriculumId={activeCurriculumId} />
          </div>
        )}

        {/* ━━━ SECTION 2b: Weakness Loop ━━━ */}
        {activeCurriculumId && (
          <div className="mb-6">
            <WeaknessLoopWidget curriculumId={activeCurriculumId} />
          </div>
        )}

        {/* ━━━ SECTION 3: Readiness Gauge + Radar + Trend + Gaps ━━━ */}
        {activeCurriculumId && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 mb-6">
            <div className="space-y-4">
              <ExamReadinessGauge curriculumId={activeCurriculumId} />
              <ReadinessTrendCard curriculumId={activeCurriculumId} />
            </div>
            <div className="lg:col-span-2 space-y-4">
              <ReadinessRadar curriculumId={activeCurriculumId} />
              <TopGapsCard curriculumId={activeCurriculumId} />
            </div>
          </div>
        )}

        {/* Streak + Exam Preview */}
        {activeCurriculumId && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mb-6">
            <SmartStreakWidget />
            <ExamPreview curriculumId={activeCurriculumId} />
          </div>
        )}

        {/* ━━━ SECTION 4: Exam Traps ━━━ */}
        {activeCurriculumId && (
          <div className="mb-6">
            <ExamTrapsWidget curriculumId={activeCurriculumId} />
          </div>
        )}

        {/* ━━━ SECTION 4b: Progress Narrative + Badge History + Daily Humor ━━━ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <ProgressNarrative />
          <div className="space-y-4">
            <BadgeHistory />
            {activeCurriculumId && <DailyHumorCard certificationId={activeCurriculumId} />}
          </div>
        </div>

        {/* ━━━ SECTION 5: Enrolled Courses ━━━ */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-display font-semibold">Meine Prüfungstrainings</h2>
            <Link to="/courses">
              <Button variant="ghost" size="sm">
                Alle Trainings
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </div>

          {enrollments.length === 0 ? (
            <Card className="glass-card">
              <CardContent className="p-12 text-center">
                <GraduationCap className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-xl font-semibold mb-2">Noch kein Prüfungstraining</h3>
                <p className="text-muted-foreground mb-6">
                  Starte jetzt deine Prüfungsvorbereitung!
                </p>
                <Link to="/courses">
                  <Button className="gradient-primary text-primary-foreground shadow-glow">
                    Prüfungstraining entdecken
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {enrollments.map((enrollment) => {
                const courseProgress = getCourseProgress(enrollment.course_id);
                const isCompleted = enrollment.completed_at != null;

                return (
                  <Card key={enrollment.course_id} className="glass-card hover:border-primary/30 transition-all group overflow-hidden">
                    <div className="flex flex-col sm:flex-row">
                      <div className="w-full h-32 sm:w-28 sm:h-28 flex-shrink-0 bg-muted rounded-t-lg sm:rounded-l-lg sm:rounded-tr-none overflow-hidden">
                        {enrollment.course.thumbnail_url ? (
                          <img
                            src={enrollment.course.thumbnail_url}
                            alt={enrollment.course.title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center gradient-primary opacity-50">
                            <BookOpen className="h-6 w-6 text-primary-foreground" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 p-4">
                        <CardHeader className="p-0 pb-1.5">
                          <CardTitle className="text-base font-display group-hover:text-primary transition-colors line-clamp-1">
                            {enrollment.course.title}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                          <div className="mb-2">
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="text-muted-foreground">Prüfungsreife</span>
                              <span className="font-medium">{courseProgress}%</span>
                            </div>
                            <Progress value={courseProgress} className="h-1.5" />
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              {enrollment.course.estimated_duration && (
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {enrollment.course.estimated_duration} Min.
                                </span>
                              )}
                            </div>
                            <Link to={`/course/${enrollment.course_id}`}>
                              <Button size="sm" className="gradient-primary text-primary-foreground text-xs h-7">
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

        {/* ━━━ SECTION 6: Quick Actions ━━━ */}
        <QuickActionsGrid activeCurriculumId={activeCurriculumId} />
      </div>
    </div>
  );
}

function ConversionCardWrapper({ curriculumId, navigate }: { curriculumId: string; navigate: (path: string) => void }) {
  const conversion = useConversionEngine({ readiness: null });

  return (
    <ConversionCard
      headline={conversion.headline}
      subline={conversion.subline}
      cta={conversion.cta}
      onClick={() => {
        switch (conversion.intent) {
          case 'weakness_training':
            navigate(`/course/${curriculumId}`);
            break;
          case 'exam_simulation':
          case 'exam_final':
            navigate('/exam-simulation');
            break;
          default:
            navigate('/courses');
        }
      }}
    />
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
    { to: '/exam-trainer', icon: Target, label: 'Prüfungstrainer', desc: 'Schriftlich üben', gradient: 'gradient-accent', glow: 'shadow-glow-accent', blocked: false },
    { to: '/exam-simulation', icon: GraduationCap, label: 'Simulation', desc: simulationBlocked ? '🔒 Noch gesperrt' : 'Prüfung simulieren', gradient: 'gradient-primary', glow: 'shadow-glow-sm', blocked: !!simulationBlocked },
    { to: adaptiveBlocked ? '/exam-trainer' : `/exam-simulation?mode=adaptive&curriculum=${activeCurriculumId ?? ''}`, icon: Sparkles, label: 'Adaptive Prüfung', desc: adaptiveBlocked ? '🔒 Premium' : 'Schwächen-basiert', gradient: 'bg-gradient-to-br from-violet-500 to-purple-600', glow: 'shadow-glow-sm', blocked: adaptiveBlocked },
    { to: '/oral-exam', icon: Mic, label: 'Mündlich', desc: 'Mündliche Prüfung', gradient: 'bg-gradient-to-br from-blue-500 to-cyan-500', glow: '', blocked: false },
    { to: '/spaced-repetition', icon: Brain, label: 'Wiederholen', desc: 'Spaced Repetition', gradient: 'bg-gradient-to-br from-purple-500 to-indigo-600', glow: '', blocked: false },
    { to: '/exam-anxiety', icon: Heart, label: 'Prüfungsangst', desc: 'Stressabbau', gradient: 'bg-gradient-to-br from-rose-500 to-pink-600', glow: '', blocked: false },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
      {actions.map((action) => {
        const content = (
          <Card className={cn(
            'glass-card transition-all h-full touch-manipulation',
            action.blocked ? 'opacity-60 cursor-not-allowed' : 'hover:border-primary/30 active:scale-[0.97]'
          )}>
            <CardContent className="p-4 sm:p-5 text-center">
              <div className={`p-3 rounded-xl ${action.gradient} ${action.glow} inline-flex mb-3 ${action.blocked ? 'grayscale' : ''}`}>
                <action.icon className="h-5 w-5 text-white" />
              </div>
              <h3 className="font-display font-bold text-sm">{action.label}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{action.desc}</p>
            </CardContent>
          </Card>
        );

        if (action.blocked) {
          return <div key={action.to} className="block" title="Trainiere zuerst offene Schwächen">{content}</div>;
        }

        return <Link key={action.to} to={action.to} className="block">{content}</Link>;
      })}
    </div>
  );
}