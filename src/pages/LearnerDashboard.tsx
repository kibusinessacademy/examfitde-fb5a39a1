import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useDashboardSummary, type DashboardEnrollment } from '@/hooks/useDashboardSummary';
import { HeroDecisionCard } from '@/components/dashboard/HeroDecisionCard';
import { LearnerIntelligenceCard } from '@/components/dashboard/LearnerIntelligenceCard';
import { MobileReEntryCard } from '@/components/mobile/MobileReEntryCard';
import { ReadinessRadar } from '@/components/dashboard/ReadinessRadar';
import { TopGapsCard } from '@/components/dashboard/TopGapsCard';
import { ReadinessTrendCard } from '@/components/dashboard/ReadinessTrendCard';
import { ExamReadinessGauge } from '@/components/dashboard/ExamReadinessGauge';
import { SmartStreakWidget } from '@/components/dashboard/SmartStreakWidget';
import { ExamPreview } from '@/components/dashboard/ExamPreview';
import { BadgeHistory } from '@/components/dashboard/BadgeHistory';
import { MasteryDashboardSection } from '@/features/mastery/components/MasteryDashboardSection';
import { NextBestStepCard } from '@/features/mastery/components/NextBestStepCard';
import { MasteryHistoryChart } from '@/features/mastery/components/MasteryHistoryChart';
import { DailyHumorCard } from '@/components/dashboard/DailyHumorCard';
import { HumorSettings } from '@/components/settings/HumorSettings';
import { useSimulationGate } from '@/hooks/useExamReadiness';
import { useProductAccessByCurriculum } from '@/hooks/useProductAccess';
import { useTerminology } from '@/hooks/useProgramType';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Loader2,
  BookOpen,
  GraduationCap,
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
import { trackLearnerReality } from '@/lib/learnerInstrumentation';
import { CurriculumPickerGate } from '@/components/curriculum/CurriculumPickerGate';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  resolveDashboardNextStep,
  type ResolverEnrollment,
} from '@/features/activation/resolveDashboardNextStep';
import { RouteIdentityBlock } from '@/components/learner/RouteIdentityBlock';
import { OutcomeHintBlock } from '@/components/learner/OutcomeHintBlock';
import { useOsBeruf } from '@/lib/os/os-identity';

export default function LearnerDashboard() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const { data: dashboard, isLoading: loading } = useDashboardSummary();
  const [detailsOpen, setDetailsOpen] = useState(false);

  const enrollments = dashboard?.enrollments || [];
  const activeCurriculumId = dashboard?.active_curriculum_id || null;
  const { t } = useTerminology(activeCurriculumId);

  // #12: Auto-expand details after 3rd session
  useEffect(() => {
    if (!activeCurriculumId) return;
    const key = `dashboard_visits_${activeCurriculumId}`;
    const visits = parseInt(localStorage.getItem(key) || '0', 10) + 1;
    localStorage.setItem(key, String(visits));
    if (visits >= 3) setDetailsOpen(true);
  }, [activeCurriculumId]);

  const getCourseProgress = (e: DashboardEnrollment) => {
    if (!e.total_lessons || e.total_lessons === 0) return 0;
    return Math.round((e.completed_lessons / e.total_lessons) * 100);
  };

  // P0.3 (2026-06-05): NEVER early-return on loading. The Customer Reality
  // Gate treated a bare spinner as `white_screen` / `dead_cta` on /dashboard
  // whenever `useDashboardSummary` was slow or stuck (RLS, cold cache, learner
  // without enrollments). The Next-Step card must always render — the
  // resolver's terminal branch (`choose_beruf` → /berufe) guarantees a valid
  // CTA even when enrollments is empty. A small inline spinner replaces the
  // full-screen one.

  // ━━━ Deterministic Next-Step CTA (SSOT) ━━━
  // P0.3 (2026-06-05): the resolver lives in src/features/activation and is
  // unit-tested. Dashboard MUST NOT guess on its own — every branch is part
  // of the SSOT contract that the Customer Reality Gate asserts against
  // (`dead_cta` / `no next-step cta` on /dashboard must stay at zero).
  const firstEnrollment = enrollments[0];
  const resolverEnrollments: ResolverEnrollment[] = enrollments.map((e) => ({
    course_id: e.course_id,
    title: e.title,
    total_lessons: e.total_lessons || 0,
    completed_lessons: e.completed_lessons || 0,
  }));
  const nextStep = resolveDashboardNextStep({
    enrollments: resolverEnrollments,
    activeCurriculumId,
  });

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

        {/* ━━━ Reality-QA: ALWAYS-VISIBLE primary Next-Step + Quick-Actions ━━━
            P0.3: Next-Step kommt aus resolveDashboardNextStep (SSOT). Niemals
            leerer Zustand, niemals stiller Spinner-Loop, niemals dead CTA. */}
        <div
          className="mb-4"
          data-testid="dashboard-next-step"
          data-next-step-kind={nextStep.kind}
        >
          <Card className="glass-card border-primary/30">
            <CardContent className="p-4">
              <div className="flex items-center gap-3 justify-between">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Dein nächster Schritt
                  </p>
                  <p
                    className="text-sm sm:text-base font-semibold truncate"
                    data-testid="dashboard-next-step-rationale"
                  >
                    {nextStep.rationale}
                  </p>
                </div>
                <Button asChild size="sm" className="shrink-0">
                  <Link
                    to={nextStep.to}
                    aria-label="dashboard-next-step-cta"
                    data-testid="dashboard-next-step-cta"
                    data-cta-location="dashboard_next_step"
                    data-next-step-kind={nextStep.kind}
                  >
                    {nextStep.label}
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Link>
                </Button>
              </div>

              {/* Quick-Actions: immer 4 sichtbar, robuster Fallback */}
              <div
                className="mt-4 grid grid-cols-2 gap-2"
                data-testid="dashboard-quick-actions"
              >
                <Button asChild variant="outline" size="sm" className="justify-start h-auto py-2">
                  <Link
                    to={firstEnrollment?.course_id ? `/course/${firstEnrollment.course_id}` : '/berufe'}
                    data-cta-location="dashboard_quick_pruefung_starten"
                  >
                    <GraduationCap className="h-4 w-4 mr-2 shrink-0" />
                    <span className="truncate text-left">Prüfung starten</span>
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="justify-start h-auto py-2">
                  <Link
                    to={firstEnrollment?.course_id ? `/course/${firstEnrollment.course_id}` : '/courses'}
                    data-cta-location="dashboard_quick_weiterlernen"
                  >
                    <BookOpen className="h-4 w-4 mr-2 shrink-0" />
                    <span className="truncate text-left">Weiterlernen</span>
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="justify-start h-auto py-2">
                  <Link
                    to={activeCurriculumId ? `/minicheck?curriculum=${activeCurriculumId}` : '/minicheck'}
                    data-cta-location="dashboard_quick_minicheck"
                  >
                    <Brain className="h-4 w-4 mr-2 shrink-0" />
                    <span className="truncate text-left">MiniCheck fortsetzen</span>
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="justify-start h-auto py-2">
                  <Link
                    to={activeCurriculumId ? `/exam-simulation?curriculum=${activeCurriculumId}` : '/exam-simulation'}
                    data-cta-location="dashboard_quick_simulation"
                  >
                    <Target className="h-4 w-4 mr-2 shrink-0" />
                    <span className="truncate text-left">Prüfung simulieren</span>
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>


        {/* ━━━ HERO: Re-Entry + Intelligence (Above the Fold) ━━━ */}
        {activeCurriculumId && (
          <div className="mb-3">
            <MobileReEntryCard curriculumId={activeCurriculumId} />
          </div>
        )}
        {activeCurriculumId && (
          <div className="mb-4">
            <LearnerIntelligenceCard curriculumId={activeCurriculumId} />
          </div>
        )}
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

        {enrollments[0]?.course_id && (
          <div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <NextBestStepCard courseId={enrollments[0].course_id} />
            <MasteryHistoryChart courseId={enrollments[0].course_id} />
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
            <div className="space-y-2 premium-stagger">
              {enrollments.slice(0, 2).map((enrollment) => {
                const courseProgress = getCourseProgress(enrollment);
                return (
                  <Link key={enrollment.course_id} to={`/course/${enrollment.course_id}`}>
                    <Card className="glass-card hover:border-primary/30 transition-all premium-lift">
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

        {/* ━━━ Witz des Tages (nach Mastery, nicht im Task-Flow) ━━━ */}
        {activeCurriculumId && (
          <div className="mb-6">
            <DailyHumorCard curriculumId={activeCurriculumId} />
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

        {/* ━━━ SECTION 5: Quick Actions (consolidated – #3) ━━━ */}
        <QuickActionsGrid activeCurriculumId={activeCurriculumId} />

        {/* Empty state — No Dead Ends: führt direkt in den Beruf-Picker */}
        {enrollments.length === 0 && !activeCurriculumId && (
          <CurriculumPickerGate
            source="dashboard:empty"
            title={t('noTrainingYet') as string}
            description={t('startPrep') as string}
            primaryLabel="Beruf auswählen"
            primaryHref="/berufe"
            secondaryLabel="Alle Trainings"
            secondaryHref="/courses"
          />
        )}
      </div>
    </div>
  );
}

function QuickActionsGrid({ activeCurriculumId }: { activeCurriculumId: string | null }) {
  const navigate = useNavigate();
  const { data: gate } = useSimulationGate(activeCurriculumId ?? undefined);
  const { data: hasExamTrainer, isLoading: entitlementLoading } = useProductAccessByCurriculum(
    activeCurriculumId ?? undefined, 'exam_trainer'
  );
  const { t } = useTerminology(activeCurriculumId);
  const simulationBlocked = gate && !gate.allowed;
  const adaptiveBlocked = !entitlementLoading && !hasExamTrainer;

  // P0-A: Dashboard-CTA-Resolver — kein "?curriculum=null"-Dead-End mehr.
  // Wenn kein Curriculum aktiv ist: CTA navigiert in den Picker (/berufe)
  // und emittiert curriculum_picker_opened. Die CTAs bleiben klickbar.
  const curriculumQs = activeCurriculumId ? `?curriculum=${activeCurriculumId}` : '';
  const noCurriculum = !activeCurriculumId;
  const PICKER_ROUTE = '/berufe';

  type Action = {
    to: string;
    icon: typeof Zap;
    label: string;
    gradient: string;
    blocked: boolean;
    /** Soft-Block: navigates to picker on click instead of being dead. */
    needsCurriculum?: boolean;
  };

  const actions: Action[] = [
    { to: `/shuttle${curriculumQs}`, icon: Zap, label: 'Shuttle', gradient: 'bg-gradient-to-br from-primary to-secondary', blocked: false, needsCurriculum: noCurriculum },
    { to: `/daily-challenge${curriculumQs}`, icon: Flame, label: 'Daily', gradient: 'bg-gradient-to-br from-orange-500 to-amber-500', blocked: false, needsCurriculum: noCurriculum },
    { to: '/exam-trainer', icon: Target, label: t('examTrainer'), gradient: 'gradient-accent', blocked: false, needsCurriculum: noCurriculum },
    { to: '/exam-simulation', icon: GraduationCap, label: t('examSimulation'), gradient: 'gradient-primary', blocked: !!simulationBlocked, needsCurriculum: noCurriculum },
    { to: `/oral-exam${curriculumQs}`, icon: Mic, label: 'Mündlich', gradient: 'bg-gradient-to-br from-blue-500 to-cyan-500', blocked: false, needsCurriculum: noCurriculum },
    { to: `/heatmap${curriculumQs}`, icon: Grid3X3, label: 'Heatmap', gradient: 'bg-gradient-to-br from-emerald-500 to-green-500', blocked: false, needsCurriculum: noCurriculum },
    { to: '/spaced-repetition', icon: Brain, label: 'Wiederholen', gradient: 'bg-gradient-to-br from-purple-500 to-indigo-600', blocked: false },
    { to: '/exam-anxiety', icon: Heart, label: 'Stressabbau', gradient: 'bg-gradient-to-br from-rose-500 to-pink-600', blocked: false },
  ];

  const handleClick = (action: Action) => {
    trackLearnerReality('dashboard_cta_clicked', {
      cta: action.label,
      target: action.to,
      curriculum_id: activeCurriculumId,
      blocked: action.blocked,
      needs_curriculum: !!action.needsCurriculum,
    });
    if (action.blocked) return;
    if (action.needsCurriculum) {
      trackLearnerReality('curriculum_picker_opened', {
        source: `dashboard:${action.label}`,
        target: PICKER_ROUTE,
      });
      navigate(PICKER_ROUTE);
      return;
    }
    navigate(action.to);
  };

  return (
    <div className="mt-6">
      <h2 className="text-base font-display font-semibold mb-3">Schnellzugriff</h2>
      <div className="grid grid-cols-4 gap-2">
        {actions.map((action) => {
          const isHardBlocked = action.blocked;
          return (
            <button
              key={action.to}
              type="button"
              onClick={() => handleClick(action)}
              disabled={isHardBlocked}
              aria-label={
                action.needsCurriculum
                  ? `${action.label} — zuerst Beruf auswählen`
                  : action.label
              }
              className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl"
            >
              <Card className={cn(
                'glass-card transition-all touch-manipulation',
                isHardBlocked
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:border-primary/30 active:scale-[0.97]'
              )}>
                <CardContent className="p-2.5 text-center">
                  <div className={`p-2 rounded-lg ${action.gradient} inline-flex mb-1 ${isHardBlocked ? 'grayscale' : ''}`}>
                    <action.icon className="h-4 w-4 text-text-on-gradient" />
                  </div>
                  <h3 className="font-medium text-[10px] leading-tight">{action.label}</h3>
                  {action.needsCurriculum && (
                    <p className="text-[9px] text-muted-foreground mt-0.5">Beruf wählen</p>
                  )}
                </CardContent>
              </Card>
            </button>
          );
        })}
      </div>
    </div>
  );
}
