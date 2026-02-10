import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import {
  FileText, BookOpen, Users, HelpCircle, ArrowRight, Activity,
  TrendingUp, AlertTriangle, CheckCircle, Clock, Zap,
  ShieldCheck, Bot, Crown, BarChart3, Layers, Target,
  RefreshCw, ExternalLink
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { format, subDays, startOfDay } from 'date-fns';
import { de } from 'date-fns/locale';

interface PlatformStats {
  curricula: number;
  courses: number;
  publishedCourses: number;
  enrollments: number;
  questions: number;
  blueprints: number;
  activeUsers: number;
  examSessions: number;
  aiGenerations: number;
  councils: number;
}

interface SystemHealth {
  jobsTotal: number;
  jobsFailed: number;
  jobsPending: number;
  aiCostThisMonth: number;
  aiBudget: number;
  qualityGatesPassed: number;
  qualityGatesTotal: number;
}

interface RecentActivity {
  type: string;
  label: string;
  time: string;
  status?: string;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<PlatformStats>({
    curricula: 0, courses: 0, publishedCourses: 0, enrollments: 0,
    questions: 0, blueprints: 0, activeUsers: 0, examSessions: 0,
    aiGenerations: 0, councils: 0,
  });
  const [health, setHealth] = useState<SystemHealth>({
    jobsTotal: 0, jobsFailed: 0, jobsPending: 0,
    aiCostThisMonth: 0, aiBudget: 200,
    qualityGatesPassed: 0, qualityGatesTotal: 0,
  });
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    try {
      const sevenDaysAgo = subDays(new Date(), 7).toISOString();
      const monthStart = startOfDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1)).toISOString();

      const [
        curriculaRes, coursesRes, publishedRes, enrollmentsRes,
        questionsRes, blueprintsRes, examSessionsRes,
        aiGenRes, councilsRes,
        jobsTotalRes, jobsFailedRes, jobsPendingRes,
        aiCostRes, aiBudgetRes,
        qgPassedRes, qgTotalRes,
        recentEnrollRes, recentJobsRes,
      ] = await Promise.all([
        supabase.from('curricula').select('id', { count: 'exact', head: true }),
        supabase.from('courses').select('id', { count: 'exact', head: true }),
        supabase.from('courses').select('id', { count: 'exact', head: true }).eq('status', 'published'),
        supabase.from('course_enrollments').select('id', { count: 'exact', head: true }) as any,
        supabase.from('exam_questions').select('id', { count: 'exact', head: true }),
        supabase.from('question_blueprints').select('id', { count: 'exact', head: true }),
        supabase.from('exam_sessions').select('id', { count: 'exact', head: true }).gte('started_at', sevenDaysAgo),
        supabase.from('ai_generations').select('id', { count: 'exact', head: true }),
        supabase.from('councils').select('id', { count: 'exact', head: true }),
        supabase.from('job_queue').select('id', { count: 'exact', head: true }),
        supabase.from('job_queue').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
        supabase.from('job_queue').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('ai_usage_log').select('cost_eur').gte('created_at', monthStart),
        supabase.from('ai_cost_budgets').select('budget_eur, spent_eur').order('month', { ascending: false }).limit(1),
        supabase.from('ai_quality_gates').select('id', { count: 'exact', head: true }).eq('gate_status', 'passed'),
        supabase.from('ai_quality_gates').select('id', { count: 'exact', head: true }),
        supabase.from('course_enrollments').select('enrolled_at, user_id').order('enrolled_at', { ascending: false }).limit(5) as any,
        supabase.from('job_queue').select('job_type, status, created_at').order('created_at', { ascending: false }).limit(5),
      ]);

      // Calculate AI cost
      let totalAiCost = 0;
      if (aiCostRes.data) {
        totalAiCost = aiCostRes.data.reduce((sum, row) => sum + (row.cost_eur || 0), 0);
      }

      const budget = aiBudgetRes.data?.[0];

      setStats({
        curricula: curriculaRes.count || 0,
        courses: coursesRes.count || 0,
        publishedCourses: publishedRes.count || 0,
        enrollments: enrollmentsRes.count || 0,
        questions: questionsRes.count || 0,
        blueprints: blueprintsRes.count || 0,
        activeUsers: 0,
        examSessions: examSessionsRes.count || 0,
        aiGenerations: aiGenRes.count || 0,
        councils: councilsRes.count || 0,
      });

      setHealth({
        jobsTotal: jobsTotalRes.count || 0,
        jobsFailed: jobsFailedRes.count || 0,
        jobsPending: jobsPendingRes.count || 0,
        aiCostThisMonth: budget?.spent_eur ?? totalAiCost,
        aiBudget: budget?.budget_eur ?? 200,
        qualityGatesPassed: qgPassedRes.count || 0,
        qualityGatesTotal: qgTotalRes.count || 0,
      });

      // Build recent activity
      const activities: RecentActivity[] = [];
      if (recentEnrollRes.data) {
        (recentEnrollRes.data as any[]).forEach((e: any) => {
          activities.push({
            type: 'enrollment',
            label: 'Neue Einschreibung',
            time: e.enrolled_at,
            status: 'success',
          });
        });
      }
      if (recentJobsRes.data) {
        (recentJobsRes.data as any[]).forEach((j: any) => {
          activities.push({
            type: 'job',
            label: `Job: ${j.job_type}`,
            time: j.created_at,
            status: j.status,
          });
        });
      }
      activities.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
      setRecentActivity(activities.slice(0, 8));
    } catch (error) {
      console.error('Dashboard fetch error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const jobHealthPercent = health.jobsTotal > 0
    ? Math.round(((health.jobsTotal - health.jobsFailed) / health.jobsTotal) * 100)
    : 100;

  const aiCostPercent = health.aiBudget > 0
    ? Math.round((health.aiCostThisMonth / health.aiBudget) * 100)
    : 0;

  const qgPassRate = health.qualityGatesTotal > 0
    ? Math.round((health.qualityGatesPassed / health.qualityGatesTotal) * 100)
    : 100;

  const overallHealth = jobHealthPercent >= 95 && aiCostPercent < 80 && qgPassRate >= 80
    ? 'healthy'
    : jobHealthPercent < 80 || aiCostPercent >= 95
      ? 'critical'
      : 'warning';

  const Shimmer = () => (
    <div className="h-8 w-16 bg-muted animate-pulse rounded" />
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">
            Command Center
          </h1>
          <p className="text-muted-foreground mt-1">
            Plattform-Übersicht und System-Monitoring
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Aktualisieren
        </Button>
      </div>

      {/* System Health Banner */}
      <Card className={`border-2 ${
        overallHealth === 'healthy' ? 'border-success/40 bg-success/5' :
        overallHealth === 'warning' ? 'border-warning/40 bg-warning/5' :
        'border-destructive/40 bg-destructive/5'
      }`}>
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {overallHealth === 'healthy' ? (
              <CheckCircle className="h-6 w-6 text-success" />
            ) : overallHealth === 'warning' ? (
              <AlertTriangle className="h-6 w-6 text-warning" />
            ) : (
              <AlertTriangle className="h-6 w-6 text-destructive" />
            )}
            <div>
              <p className="font-semibold text-foreground">
                {overallHealth === 'healthy' ? 'Alle Systeme operational' :
                 overallHealth === 'warning' ? 'Aufmerksamkeit erforderlich' :
                 'Kritische Probleme erkannt'}
              </p>
              <p className="text-sm text-muted-foreground">
                Jobs: {jobHealthPercent}% · AI-Budget: {aiCostPercent}% · Quality Gates: {qgPassRate}%
              </p>
            </div>
          </div>
          <Link to="/admin-v2/system-health">
            <Button variant="ghost" size="sm" className="gap-1">
              Details <ExternalLink className="h-3 w-3" />
            </Button>
          </Link>
        </CardContent>
      </Card>

      {/* Primary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Curricula', value: stats.curricula, icon: FileText, link: '/admin-v2/curricula', gradient: 'gradient-primary' },
          { label: 'Kurse', value: stats.courses, sub: `${stats.publishedCourses} publiziert`, icon: BookOpen, link: '/admin-v2/courses', gradient: 'gradient-accent' },
          { label: 'Einschreibungen', value: stats.enrollments, icon: Users, link: '/admin-v2/crm', gradient: 'bg-success' },
          { label: 'Prüfungsfragen', value: stats.questions, sub: `${stats.blueprints} Blueprints`, icon: HelpCircle, link: '/admin-v2/questions', gradient: 'bg-warning' },
        ].map((stat) => (
          <Card key={stat.label} className="card-interactive group">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className={`p-2.5 rounded-xl ${stat.gradient}`}>
                  <stat.icon className="h-5 w-5 text-primary-foreground" />
                </div>
                {stat.link && (
                  <Link to={stat.link} className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                )}
              </div>
              <p className="text-2xl font-display font-bold text-foreground">
                {loading ? <Shimmer /> : stat.value.toLocaleString('de-DE')}
              </p>
              <p className="text-sm text-muted-foreground">{stat.label}</p>
              {stat.sub && !loading && (
                <p className="text-xs text-muted-foreground mt-1">{stat.sub}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Secondary metrics + System health */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* AI & Automation */}
        <Card className="card-elevated">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-accent" />
              <CardTitle className="text-base">AI & Automatisierung</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1.5">
                <span className="text-muted-foreground">AI-Budget Monat</span>
                <span className="font-medium text-foreground">
                  {loading ? '...' : `€${health.aiCostThisMonth.toFixed(2)} / €${health.aiBudget}`}
                </span>
              </div>
              <Progress
                value={loading ? 0 : aiCostPercent}
                className="h-2"
              />
              {!loading && aiCostPercent >= 80 && (
                <p className="text-xs text-warning mt-1 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Budget-Warnung
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-lg font-bold text-foreground">
                  {loading ? '...' : stats.aiGenerations.toLocaleString('de-DE')}
                </p>
                <p className="text-xs text-muted-foreground">AI-Generierungen</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-lg font-bold text-foreground">
                  {loading ? '...' : stats.councils}
                </p>
                <p className="text-xs text-muted-foreground">Councils aktiv</p>
              </div>
            </div>

            <Link to="/admin-v2/ai-workers" className="block">
              <Button variant="outline" size="sm" className="w-full gap-2">
                <Zap className="h-4 w-4" />
                AI Workers verwalten
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Job Health */}
        <Card className="card-elevated">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-info" />
              <CardTitle className="text-base">Job Pipeline</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-lg font-bold text-foreground">
                  {loading ? '...' : health.jobsTotal}
                </p>
                <p className="text-xs text-muted-foreground">Gesamt</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-lg font-bold text-warning">
                  {loading ? '...' : health.jobsPending}
                </p>
                <p className="text-xs text-muted-foreground">Ausstehend</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-lg font-bold text-destructive">
                  {loading ? '...' : health.jobsFailed}
                </p>
                <p className="text-xs text-muted-foreground">Fehlgeschlagen</p>
              </div>
            </div>

            <div>
              <div className="flex justify-between text-sm mb-1.5">
                <span className="text-muted-foreground">Erfolgsrate</span>
                <span className="font-medium text-foreground">{loading ? '...' : `${jobHealthPercent}%`}</span>
              </div>
              <Progress value={loading ? 0 : jobHealthPercent} className="h-2" />
            </div>

            <Link to="/admin-v2/jobs/dashboard" className="block">
              <Button variant="outline" size="sm" className="w-full gap-2">
                <Layers className="h-4 w-4" />
                Job Control Center
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Quality & Compliance */}
        <Card className="card-elevated">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-success" />
              <CardTitle className="text-base">Qualität & Compliance</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-lg font-bold text-foreground">
                  {loading ? '...' : `${qgPassRate}%`}
                </p>
                <p className="text-xs text-muted-foreground">Gate Pass Rate</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-lg font-bold text-foreground">
                  {loading ? '...' : stats.examSessions}
                </p>
                <p className="text-xs text-muted-foreground">Prüfungen (7d)</p>
              </div>
            </div>

            <div>
              <div className="flex justify-between text-sm mb-1.5">
                <span className="text-muted-foreground">Quality Gates</span>
                <span className="font-medium text-foreground">
                  {loading ? '...' : `${health.qualityGatesPassed} / ${health.qualityGatesTotal}`}
                </span>
              </div>
              <Progress value={loading ? 0 : qgPassRate} className="h-2" />
            </div>

            <div className="flex gap-2">
              <Link to="/admin-v2/quality-gates" className="flex-1">
                <Button variant="outline" size="sm" className="w-full gap-2">
                  <Target className="h-4 w-4" />
                  Quality Gates
                </Button>
              </Link>
              <Link to="/admin-v2/azav-compliance" className="flex-1">
                <Button variant="outline" size="sm" className="w-full gap-2">
                  <ShieldCheck className="h-4 w-4" />
                  AZAV
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bottom row: Recent Activity + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activity */}
        <Card className="card-elevated">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base">Letzte Aktivitäten</CardTitle>
              </div>
              <Badge variant="secondary" className="text-xs">Live</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[1,2,3,4].map(i => (
                  <div key={i} className="h-10 bg-muted animate-pulse rounded" />
                ))}
              </div>
            ) : recentActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Noch keine Aktivitäten
              </p>
            ) : (
              <div className="space-y-2">
                {recentActivity.map((act, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-lg p-2.5 hover:bg-muted/50 transition-colors">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      act.status === 'completed' || act.status === 'success' ? 'bg-success' :
                      act.status === 'failed' ? 'bg-destructive' :
                      act.status === 'pending' || act.status === 'processing' ? 'bg-warning' :
                      'bg-muted-foreground'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{act.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(act.time), 'dd. MMM, HH:mm', { locale: de })} Uhr
                      </p>
                    </div>
                    {act.status && (
                      <Badge
                        variant="secondary"
                        className={`text-xs ${
                          act.status === 'completed' || act.status === 'success' ? 'bg-success/10 text-success' :
                          act.status === 'failed' ? 'bg-destructive/10 text-destructive' :
                          ''
                        }`}
                      >
                        {act.status}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card className="card-elevated">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-warning" />
              <CardTitle className="text-base">Schnellaktionen</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            {[
              { to: '/admin-v2/curricula/new', icon: FileText, label: 'Curriculum importieren', color: 'text-primary' },
              { to: '/admin-v2/courses/new', icon: BookOpen, label: 'Kurs erstellen', color: 'text-accent' },
              { to: '/admin-v2/product-factory', icon: Layers, label: 'Produkt-Factory', color: 'text-info' },
              { to: '/admin-v2/council-control', icon: Crown, label: 'Council OS', color: 'text-warning' },
              { to: '/admin-v2/kpi-dashboard', icon: BarChart3, label: 'KPI Analytics', color: 'text-success' },
              { to: '/admin-v2/qc-dashboard', icon: ShieldCheck, label: 'QC Snapshot', color: 'text-destructive' },
            ].map((action) => (
              <Link key={action.to} to={action.to}>
                <Button
                  variant="outline"
                  className="w-full h-16 flex-col gap-1.5 hover:border-primary/30 hover:bg-muted/50"
                >
                  <action.icon className={`h-5 w-5 ${action.color}`} />
                  <span className="text-xs">{action.label}</span>
                </Button>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
