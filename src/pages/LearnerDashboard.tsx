import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useDashboardSummary, type DashboardEnrollment } from '@/hooks/useDashboardSummary';
import { HeroDecisionCard } from '@/components/dashboard/HeroDecisionCard';
import { ReadinessRadar } from '@/components/dashboard/ReadinessRadar';
import { TopGapsCard } from '@/components/dashboard/TopGapsCard';
import { ReadinessTrendCard } from '@/components/dashboard/ReadinessTrendCard';
import { ExamReadinessGauge } from '@/components/dashboard/ExamReadinessGauge';
import { SmartStreakWidget } from '@/components/dashboard/SmartStreakWidget';
import { ExamPreview } from '@/components/dashboard/ExamPreview';
import { BadgeHistory } from '@/components/dashboard/BadgeHistory';
import { MasteryDashboardSection } from '@/features/mastery/components/MasteryDashboardSection';
import { DailyHumorCard } from '@/components/dashboard/DailyHumorCard';
import { HumorSettings } from '@/components/settings/HumorSettings';
import { useSimulationGate } from '@/hooks/useExamReadiness';
import { useProductAccessByCurriculum } from '@/hooks/useProductAccess';
import { useTerminology } from '@/hooks/useProgramType';
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
  Zap,
  Flame,
  Grid3X3,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

export default function LearnerDashboard() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const { data: dashboard, isLoading: loading } = useDashboardSummary();
  const [detailsOpen, setDetailsOpen] = useState(false);

  const enrollments = dashboard?.enrollments || [];
  const activeCurriculumId = dashboard?.active_curriculum_id || null;
  const { t } = useTerminology(activeCurriculumId);

  const getCourseProgress = (e: DashboardEnrollment) => {
    if (!e.total_lessons || e.total_lessons === 0) return 0;
    return Math.round((e.completed_lessons / e.total_lessons) * 100);
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

        {/* ━━━ Shuttle Mode Quick Launch ━━━ */}
        {activeCurriculumId && (
          <div className="mb-4">
            <button
              onClick={() => navigate(`/shuttle?curriculum=${activeCurriculumId}`)}
              className="w-full group"
            >
              <Card className="glass-card border-primary/20 hover:border-primary/40 transition-all hover:shadow-md">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Zap className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-sm font-semibold text-foreground">Shuttle Mode</div>
                    <div className="text-xs text-muted-foreground">Sofort trainieren – Frage für Frage</div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </CardContent>
              </Card>
            </button>
          </div>
        )}

        {/* ━━━ Daily Challenge Quick Launch ━━━ */}
        {activeCurriculumId && (
          <div className="mb-4">
            <button
              onClick={() => navigate(`/daily-challenge?curriculum=${activeCurriculumId}`)}
              className="w-full group"
            >
              <Card className="glass-card border-orange-500/20 hover:border-orange-500/40 transition-all hover:shadow-md">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                    <Flame className="h-5 w-5 text-orange-500" />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-sm font-semibold text-foreground">Daily Challenge</div>
                    <div className="text-xs text-muted-foreground">5 Fragen pro Tag – baue deinen Streak auf</div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-orange-500 transition-colors" />
                </CardContent>
              </Card>
            </button>
          </div>
        )}

        {/* ━━━ Exam Heatmap Quick Launch ━━━ */}
        {activeCurriculumId && (
          <div className="mb-4">
            <button
              onClick={() => navigate(`/heatmap?curriculum=${activeCurriculumId}`)}
              className="w-full group"
            >
              <Card className="glass-card border-emerald-500/20 hover:border-emerald-500/40 transition-all hover:shadow-md">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                    <Grid3X3 className="h-5 w-5 text-emerald-500" />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-sm font-semibold text-foreground">Prüfungs-Heatmap</div>
                    <div className="text-xs text-muted-foreground">Deine Stärken & Schwächen auf einen Blick</div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-emerald-500 transition-colors" />
                </CardContent>
              </Card>
            </button>
          </div>
        )}

        {/* ━━━ Witz des Tages ━━━ */}
        {activeCurriculumId && (
          <div className="mb-6">
            <DailyHumorCard curriculumId={activeCurriculumId} />
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
                const courseProgress = getCourseProgress(enrollment);
                return (
                  <Link key={enrollment.course_id} to={`/course/${enrollment.course_id}`}>
                    <Card className="glass-card hover:border-primary/30 transition-all">
                      <CardContent className="p-3 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
                          {enrollment.thumbnail_url ? (
                            <img src={enrollment.thumbnail_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <BookOpen className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{enrollment.title}</div>
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
                  <SmartStreakWidget curriculumId={activeCurriculumId} />
                  <ExamPreview curriculumId={activeCurriculumId} />
                </div>

                {/* Badges */}
                <BadgeHistory />

                {/* Humor Einstellungen */}
                <HumorSettings curriculumId={activeCurriculumId} />
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
              <h3 className="text-lg font-semibold mb-1">{t('noTrainingYet')}</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {t('startPrep')}
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
  const { t } = useTerminology(activeCurriculumId);
  const simulationBlocked = gate && !gate.allowed;
  const adaptiveBlocked = !entitlementLoading && !hasExamTrainer;

  const actions = [
    { to: '/exam-trainer', icon: Target, label: t('examTrainer'), gradient: 'gradient-accent', blocked: false },
    { to: '/exam-simulation', icon: GraduationCap, label: t('examSimulation'), gradient: 'gradient-primary', blocked: !!simulationBlocked },
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
