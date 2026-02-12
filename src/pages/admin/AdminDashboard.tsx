import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import {
  Activity, AlertTriangle, ArrowRight, ArrowUpRight, BarChart3, BookOpen,
  Brain, CheckCircle2, DollarSign, Download, GraduationCap, Heart,
  ListChecks, Package, Shield, TrendingUp, Users, Zap, XCircle, Clock
} from 'lucide-react';

interface DashboardData {
  totalEnrollments: number;
  coursesPublished: number;
  totalCourses: number;
  totalQuestions: number;
  totalBlueprints: number;
  totalCurricula: number;
  aiCostMtd: number;
  aiBudget: number;
  aiRuns: number;
  jobsPending: number;
  jobsFailed: number;
  jobsCompleted: number;
  gatesPassed: number;
  gatesTotal: number;
  examSessions: number;
}

type HealthStatus = 'healthy' | 'warning' | 'critical';

function getHealthStatus(data: DashboardData): { status: HealthStatus; label: string } {
  const budgetPct = data.aiBudget > 0 ? (data.aiCostMtd / data.aiBudget) * 100 : 0;
  const jobFailRate = (data.jobsCompleted + data.jobsFailed) > 0
    ? (data.jobsFailed / (data.jobsCompleted + data.jobsFailed)) * 100 : 0;
  if (budgetPct > 95 || jobFailRate > 20) return { status: 'critical', label: 'Kritisch' };
  if (budgetPct > 80 || jobFailRate > 10 || data.jobsPending > 50) return { status: 'warning', label: 'Achtung' };
  return { status: 'healthy', label: 'Operational' };
}

const statusColors: Record<HealthStatus, string> = {
  healthy: 'bg-success text-success-foreground',
  warning: 'bg-warning text-warning-foreground',
  critical: 'bg-destructive text-destructive-foreground',
};
const statusIcons: Record<HealthStatus, React.ElementType> = {
  healthy: CheckCircle2, warning: AlertTriangle, critical: XCircle,
};

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [
          curricula, courses, enrollments, questions, blueprints,
          jobQueue, aiUsage, aiBudgets, qualityGates, examSessions,
        ] = await Promise.all([
          supabase.from('curricula').select('id', { count: 'exact', head: true }),
          supabase.from('courses').select('id, status', { count: 'exact' }),
          supabase.from('course_enrollments').select('id', { count: 'exact', head: true }),
          supabase.from('exam_questions').select('id', { count: 'exact', head: true }),
          supabase.from('question_blueprints').select('id', { count: 'exact', head: true }),
          supabase.from('job_queue').select('id, status'),
          supabase.from('ai_usage_log').select('cost_eur, job_type'),
          supabase.from('ai_cost_budgets').select('budget_eur, spent_eur').order('month', { ascending: false }).limit(1),
          supabase.from('ai_quality_gates').select('id, gate_status'),
          supabase.from('exam_sessions').select('id', { count: 'exact', head: true }),
        ]);

        const coursesData = courses.data || [];
        const jobsData = jobQueue.data || [];
        const aiData = aiUsage.data || [];
        const budgetData = aiBudgets.data?.[0];
        const gatesData = qualityGates.data || [];

        setData({
          totalCurricula: curricula.count || 0,
          totalCourses: coursesData.length,
          coursesPublished: coursesData.filter(c => c.status === 'published').length,
          totalEnrollments: enrollments.count || 0,
          totalQuestions: questions.count || 0,
          totalBlueprints: blueprints.count || 0,
          aiCostMtd: aiData.reduce((sum, r) => sum + (r.cost_eur || 0), 0),
          aiBudget: budgetData?.budget_eur || 200,
          aiRuns: aiData.length,
          jobsPending: jobsData.filter(j => j.status === 'pending').length,
          jobsFailed: jobsData.filter(j => j.status === 'failed').length,
          jobsCompleted: jobsData.filter(j => j.status === 'completed').length,
          gatesPassed: gatesData.filter(g => g.gate_status === 'passed').length,
          gatesTotal: gatesData.length,
          examSessions: examSessions.count || 0,
        });
      } catch (err) {
        console.error('Dashboard fetch error:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-16 w-full" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      </div>
    );
  }

  const health = getHealthStatus(data);
  const HealthIcon = statusIcons[health.status];
  const budgetPct = data.aiBudget > 0 ? Math.round((data.aiCostMtd / data.aiBudget) * 100) : 0;
  const gatePassRate = data.gatesTotal > 0 ? Math.round((data.gatesPassed / data.gatesTotal) * 100) : 100;

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Health Banner */}
      <div className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 sm:p-4 rounded-xl border ${
        health.status === 'healthy' ? 'bg-success/5 border-success/20' :
        health.status === 'warning' ? 'bg-warning/5 border-warning/20' :
        'bg-destructive/5 border-destructive/20'
      }`}>
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${statusColors[health.status]}`}>
            <HealthIcon className="h-4 w-4 sm:h-5 sm:w-5" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-display font-bold text-foreground">AI Control Center</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Status: <strong className={health.status === 'healthy' ? 'text-success' : health.status === 'warning' ? 'text-warning' : 'text-destructive'}>{health.label}</strong>
              {' · '}{data.aiRuns} Runs · {budgetPct}%
            </p>
          </div>
        </div>
        <Badge variant="outline" className={`${statusColors[health.status]} self-end sm:self-auto`}>
          <HealthIcon className="h-3 w-3 mr-1" /> {health.label}
        </Badge>
      </div>

      {/* ⬇ Next Admin Actions */}
      <NextAdminActions />

      {/* Business KPIs */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <DollarSign className="h-3.5 w-3.5" /> Business
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <KPICard icon={Users} label="Einschreibungen" value={data.totalEnrollments} />
          <KPICard icon={BookOpen} label="Kurse (Pub.)" value={`${data.coursesPublished}/${data.totalCourses}`} />
          <KPICard icon={GraduationCap} label="Curricula" value={data.totalCurricula} />
          <KPICard icon={BarChart3} label="Prüfungen" value={data.examSessions} />
        </div>
      </section>

      {/* Quality */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Shield className="h-3.5 w-3.5" /> Qualität
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <KPICard icon={CheckCircle2} label="Gate Pass" value={`${gatePassRate}%`} trend={gatePassRate >= 90 ? 'up' : 'down'} />
          <KPICard icon={Brain} label="Fragen" value={data.totalQuestions} />
          <KPICard icon={Zap} label="Blueprints" value={data.totalBlueprints} />
          <KPICard icon={Shield} label="Gates" value={data.gatesTotal} />
        </div>
      </section>

      {/* AI & Automation */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Brain className="h-3.5 w-3.5" /> AI & Automation
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          <Card className="glass-card">
            <CardContent className="pt-4 sm:pt-5 p-4 sm:p-6">
              <p className="text-xs text-muted-foreground font-medium">AI-Budget MTD</p>
              <div className="flex items-end gap-2 mt-1">
                <span className="text-xl sm:text-2xl font-bold text-foreground">€{data.aiCostMtd.toFixed(2)}</span>
                <span className="text-xs sm:text-sm text-muted-foreground">/ €{data.aiBudget}</span>
              </div>
              <Progress value={budgetPct} className="mt-3 h-2" />
              <p className="text-xs text-muted-foreground mt-1">{budgetPct}% verbraucht</p>
            </CardContent>
          </Card>
          <Card className="glass-card">
            <CardContent className="pt-4 sm:pt-5 p-4 sm:p-6">
              <p className="text-xs text-muted-foreground font-medium">AI Runs</p>
              <span className="text-xl sm:text-2xl font-bold text-foreground">{data.aiRuns}</span>
              <p className="text-xs text-muted-foreground mt-1">Generierungen & Validierungen</p>
            </CardContent>
          </Card>
          <Card className="glass-card sm:col-span-2 lg:col-span-1">
            <CardContent className="pt-4 sm:pt-5 p-4 sm:p-6">
              <p className="text-xs text-muted-foreground font-medium">Ø Kosten / Run</p>
              <span className="text-xl sm:text-2xl font-bold text-foreground">
                €{data.aiRuns > 0 ? (data.aiCostMtd / data.aiRuns).toFixed(3) : '0.000'}
              </span>
              <p className="text-xs text-muted-foreground mt-1">pro AI-Aufruf</p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Tech & Jobs */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Activity className="h-3.5 w-3.5" /> Technik & Jobs
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <KPICard icon={Clock} label="Pending" value={data.jobsPending} trend={data.jobsPending > 20 ? 'down' : 'up'} />
          <KPICard icon={CheckCircle2} label="Completed" value={data.jobsCompleted} trend="up" />
          <KPICard icon={XCircle} label="Failed" value={data.jobsFailed} trend={data.jobsFailed > 0 ? 'down' : 'up'} />
          <KPICard icon={Heart} label="Health" value={health.label} />
        </div>
      </section>

      {/* Council Observability */}
      <CouncilObservability />

      {/* Decision Queue */}
      <DecisionQueue />

      {/* Risk Overview */}
      <RiskOverview />

      {/* Blocked Courses */}
      <BlockedCourses />

      {/* Quick Actions */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Quick Actions</h2>
        <div className="flex flex-wrap gap-2 sm:gap-3">
          <Button asChild size="sm"><Link to="/admin/council"><Brain className="h-4 w-4 mr-1" /> Council</Link></Button>
          <Button asChild size="sm" variant="outline"><Link to="/admin/content/exports"><Download className="h-4 w-4 mr-1" /> Exporte</Link></Button>
          <Button asChild size="sm" variant="outline"><Link to="/admin/content/workflows"><Zap className="h-4 w-4 mr-1" /> Workflows</Link></Button>
          <Button asChild size="sm" variant="outline"><Link to="/admin/content/quality-gates"><Shield className="h-4 w-4 mr-1" /> Gates</Link></Button>
          <Button asChild size="sm" variant="outline"><Link to="/admin/system/jobs"><Activity className="h-4 w-4 mr-1" /> Jobs</Link></Button>
          <Button asChild size="sm" variant="outline"><Link to="/admin/council/quality"><BarChart3 className="h-4 w-4 mr-1" /> QC</Link></Button>
        </div>
      </section>
    </div>
  );
}

function NextAdminActions() {
  const [actions, setActions] = useState<Array<{
    id: string; label: string; detail: string; link: string;
    icon: React.ElementType; priority: 'high' | 'medium' | 'low';
  }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const items: typeof actions = [];

        // 1. Courses needing attention (generating or draft with content)
        const { data: ungatedCourses } = await supabase
          .from('courses')
          .select('id, title, status, is_ready_for_publish')
          .in('status', ['generating', 'draft'])
          .eq('is_ready_for_publish', false)
          .limit(5);
        (ungatedCourses || []).forEach(c => {
          items.push({
            id: `gate-${c.id}`,
            label: c.status === 'generating' ? 'Generierung läuft' : 'Quality Gate prüfen',
            detail: c.title || c.id.substring(0, 8),
            link: '/admin/content/health',
            icon: c.status === 'generating' ? Clock : Shield,
            priority: 'medium',
          });
        });

        // 2. Pending council reviews
        const { count: pendingReviews } = await supabase
          .from('content_versions')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'under_review');
        if (pendingReviews && pendingReviews > 0) {
          items.push({
            id: 'council-reviews',
            label: `${pendingReviews} Council Reviews offen`,
            detail: 'Content-Versionen warten auf Freigabe',
            link: '/admin/council',
            icon: Brain,
            priority: pendingReviews > 10 ? 'high' : 'medium',
          });
        }

        // 3. Failed jobs
        const { count: failedJobs } = await supabase
          .from('job_queue')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'failed');
        if (failedJobs && failedJobs > 0) {
          items.push({
            id: 'failed-jobs',
            label: `${failedJobs} fehlgeschlagene Jobs`,
            detail: 'Jobs benötigen Aufmerksamkeit',
            link: '/admin/system/jobs',
            icon: XCircle,
            priority: failedJobs > 5 ? 'high' : 'medium',
          });
        }

        // 4. Courses ready for export (published but no recent export)
        const { data: publishedCourses } = await supabase
          .from('courses')
          .select('id, title')
          .eq('status', 'published')
          .limit(3);
        if (publishedCourses && publishedCourses.length > 0) {
          items.push({
            id: 'export-ready',
            label: `${publishedCourses.length} Kurse exportbereit`,
            detail: 'QC-Export zur Überprüfung erstellen',
            link: '/admin/content/exports',
            icon: Package,
            priority: 'low',
          });
        }

        // Sort: high → medium → low
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        items.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
        setActions(items.slice(0, 8));
      } catch (e) {
        console.error('NextAdminActions load error:', e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <Skeleton className="h-40 w-full" />;
  if (actions.length === 0) {
    return (
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <ListChecks className="h-3.5 w-3.5" /> Nächste Schritte
        </h2>
        <Card className="glass-card border-success/20 bg-success/5">
          <CardContent className="py-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-success" />
            <p className="text-sm text-foreground font-medium">Alles erledigt – keine offenen Aufgaben.</p>
          </CardContent>
        </Card>
      </section>
    );
  }

  const priorityStyles = {
    high: 'border-destructive/30 bg-destructive/5',
    medium: 'border-warning/30 bg-warning/5',
    low: 'border-border',
  };
  const badgeStyles = {
    high: 'bg-destructive/20 text-destructive border-destructive/30',
    medium: 'bg-warning/20 text-warning border-warning/30',
    low: 'bg-muted text-muted-foreground',
  };
  const badgeLabels = { high: 'Dringend', medium: 'Offen', low: 'Optional' };

  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
        <ListChecks className="h-3.5 w-3.5" /> Nächste Schritte ({actions.length})
      </h2>
      <div className="space-y-2">
        {actions.map(a => {
          const Icon = a.icon;
          return (
            <Link key={a.id} to={a.link} className="block">
              <Card className={`${priorityStyles[a.priority]} hover:shadow-md transition-shadow`}>
                <CardContent className="py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{a.label}</p>
                      <p className="text-xs text-muted-foreground truncate">{a.detail}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className={`text-xs ${badgeStyles[a.priority]}`}>
                      {badgeLabels[a.priority]}
                    </Badge>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function DecisionQueue() {
  const [decisions, setDecisions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const { data, error } = await supabase.functions.invoke('decision-engine', {
          body: { action: 'aggregate' },
        });
        if (!error && data?.decisions) setDecisions(data.decisions);
      } catch (e) {
        console.error('Decision engine error:', e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleDecide = async (itemId: string, decision: string) => {
    await supabase.functions.invoke('decision-engine', {
      body: { action: 'decide', itemId, decision },
    });
    setDecisions(prev => prev.filter(d => d.id !== itemId));
  };

  if (loading) return <Skeleton className="h-32 w-full" />;
  if (decisions.length === 0) return null;

  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
        <Brain className="h-3.5 w-3.5" /> Decision Queue
      </h2>
      <div className="space-y-3">
        {decisions.map((d: any) => (
          <Card key={d.id} className="glass-card">
450:             <CardContent className="pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
451:               <div className="flex-1 min-w-0">
452:                 <div className="flex items-center gap-2 mb-1 flex-wrap">
453:                   <Badge variant="outline" className="text-xs">{d.council_id}</Badge>
454:                   <span className="text-xs text-muted-foreground">Impact: {d.impact_score} · Risk: {d.risk_score}</span>
455:                 </div>
456:                 <p className="text-sm font-medium text-foreground truncate">{d.title}</p>
457:                 {d.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{d.description}</p>}
458:               </div>
459:               <div className="flex gap-2 shrink-0">
460:                 <Button size="sm" variant="outline" onClick={() => handleDecide(d.id, 'approved')} className="text-xs">
461:                   <CheckCircle2 className="h-3 w-3 mr-1" /> OK
462:                 </Button>
463:                 <Button size="sm" variant="ghost" onClick={() => handleDecide(d.id, 'dismissed')} className="text-xs">
464:                   <XCircle className="h-3 w-3 mr-1" /> Nein
465:                 </Button>
466:               </div>
467:             </CardContent>
468:           </Card>
        ))}
      </div>
    </section>
  );
}

function RiskOverview() {
  const [risks, setRisks] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const { data, error } = await supabase.functions.invoke('decision-engine', {
          body: { action: 'aggregate' },
        });
        if (!error && data?.risks) setRisks(data.risks);
      } catch (e) { /* silent */ }
    }
    load();
  }, []);

  if (risks.length === 0) return null;

  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5" /> Risiko-Übersicht
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {risks.map((r: any) => (
          <Card key={`${r.scope}-${r.scope_id}-${r.risk_type}`} className="glass-card">
            <CardContent className="pt-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-muted-foreground font-medium uppercase">{r.risk_type.replace('_', ' ')}</p>
                <Badge variant={r.score > 60 ? 'destructive' : r.score > 30 ? 'outline' : 'secondary'} className="text-xs">
                  {r.score}
                </Badge>
              </div>
              <Progress value={r.score} className={`h-2 ${r.score > 60 ? '[&>div]:bg-destructive' : r.score > 30 ? '[&>div]:bg-warning' : ''}`} />
              <p className="text-xs text-muted-foreground mt-2">{r.scope_id}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function BlockedCourses() {
  const [blocked, setBlocked] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const { data } = await supabase
          .from('courses')
          .select('id, title, status, is_ready_for_publish')
          .eq('is_ready_for_publish', false)
          .neq('status', 'draft')
          .limit(10);
        setBlocked(data || []);
      } catch (e) { /* silent */ }
    }
    load();
  }, []);

  if (blocked.length === 0) return null;

  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-destructive mb-3 flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5" /> Blockierte Kurse
      </h2>
      <div className="space-y-2">
        {blocked.map((c) => (
          <Card key={c.id} className="border-destructive/20 bg-destructive/5">
            <CardContent className="py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">{c.title || c.id}</p>
                <p className="text-xs text-muted-foreground">Status: {c.status} · Publish-Ready: Nein</p>
              </div>
              <Badge variant="destructive" className="text-xs">Blockiert</Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function CouncilObservability() {
  const [stats, setStats] = useState<{ pending: number; approved: number; rejected: number; revise: number; avgScore: number; topBlockers: string[] }>({ pending: 0, approved: 0, rejected: 0, revise: 0, avgScore: 0, topBlockers: [] });

  useEffect(() => {
    async function load() {
      try {
        const [versions, verdicts] = await Promise.all([
          supabase.from('content_versions').select('id, status, quality_score, created_at').gte('created_at', new Date(Date.now() - 86400000 * 7).toISOString()),
          supabase.from('council_verdicts').select('final_decision, required_fixes').gte('decided_at', new Date(Date.now() - 86400000 * 7).toISOString()),
        ]);
        const vd = versions.data || [];
        const vr = verdicts.data || [];
        const scores = vd.map(v => v.quality_score).filter(Boolean) as number[];
        const blockerMap: Record<string, number> = {};
        vr.filter(v => v.final_decision !== 'approved' && v.required_fixes).forEach(v => {
          const fixes = v.required_fixes as any[];
          if (Array.isArray(fixes)) fixes.forEach(f => {
            const key = f?.fix?.slice(0, 40) || 'unknown';
            blockerMap[key] = (blockerMap[key] || 0) + 1;
          });
        });
        const topBlockers = Object.entries(blockerMap).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} (${v}x)`);
        setStats({
          pending: vd.filter(v => v.status === 'under_review').length,
          approved: vr.filter(v => v.final_decision === 'approved').length,
          rejected: vr.filter(v => v.final_decision === 'rejected').length,
          revise: vr.filter(v => v.final_decision === 'revise').length,
          avgScore: scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
          topBlockers,
        });
      } catch { /* silent */ }
    }
    load();
  }, []);

  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
        <Brain className="h-3.5 w-3.5" /> Council Queue (7d)
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        <KPICard icon={Clock} label="Pending" value={stats.pending} trend={stats.pending > 10 ? 'down' : 'up'} />
        <KPICard icon={CheckCircle2} label="Approved" value={stats.approved} trend="up" />
        <KPICard icon={XCircle} label="Rejected" value={stats.rejected} trend={stats.rejected > 5 ? 'down' : 'up'} />
        <KPICard icon={AlertTriangle} label="Revise" value={stats.revise} />
        <KPICard icon={BarChart3} label="Ø Score" value={stats.avgScore} />
      </div>
      {stats.topBlockers.length > 0 && (
        <Card className="mt-3 glass-card">
          <CardContent className="pt-4">
            <p className="text-xs font-medium text-muted-foreground mb-2">Top Blocker Reasons</p>
            <ul className="text-xs text-foreground space-y-1">
              {stats.topBlockers.map((b, i) => <li key={i} className="flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-warning" /> {b}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function KPICard({ icon: Icon, label, value, trend }: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  trend?: 'up' | 'down';
}) {
  return (
    <Card className="glass-card">
      <CardContent className="pt-4 sm:pt-5 p-3 sm:p-6">
        <div className="flex items-center justify-between mb-1">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {trend && (
            <TrendingUp className={`h-3 w-3 ${trend === 'up' ? 'text-success' : 'text-destructive rotate-180'}`} />
          )}
        </div>
        <span className="text-xl sm:text-2xl font-bold text-foreground">{value}</span>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{label}</p>
      </CardContent>
    </Card>
  );
}
