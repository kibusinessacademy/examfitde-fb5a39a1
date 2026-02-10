import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import {
  Activity, AlertTriangle, ArrowUpRight, BarChart3, BookOpen,
  Brain, CheckCircle2, DollarSign, GraduationCap, Heart,
  Shield, TrendingUp, Users, Zap, XCircle, Clock
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
    <div className="space-y-6">
      {/* Health Banner */}
      <div className={`flex items-center justify-between p-4 rounded-xl border ${
        health.status === 'healthy' ? 'bg-success/5 border-success/20' :
        health.status === 'warning' ? 'bg-warning/5 border-warning/20' :
        'bg-destructive/5 border-destructive/20'
      }`}>
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${statusColors[health.status]}`}>
            <HealthIcon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-display font-bold text-foreground">AI Control Center</h1>
            <p className="text-sm text-muted-foreground">
              System Status: <strong className={health.status === 'healthy' ? 'text-success' : health.status === 'warning' ? 'text-warning' : 'text-destructive'}>{health.label}</strong>
              {' · '}{data.aiRuns} AI-Runs MTD · Budget {budgetPct}%
            </p>
          </div>
        </div>
        <Badge variant="outline" className={statusColors[health.status]}>
          <HealthIcon className="h-3 w-3 mr-1" /> {health.label}
        </Badge>
      </div>

      {/* Business KPIs */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <DollarSign className="h-3.5 w-3.5" /> Business
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard icon={Users} label="Einschreibungen" value={data.totalEnrollments} />
          <KPICard icon={BookOpen} label="Kurse (Published)" value={`${data.coursesPublished} / ${data.totalCourses}`} />
          <KPICard icon={GraduationCap} label="Curricula" value={data.totalCurricula} />
          <KPICard icon={BarChart3} label="Prüfungssessions" value={data.examSessions} />
        </div>
      </section>

      {/* Quality */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Shield className="h-3.5 w-3.5" /> Qualität
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard icon={CheckCircle2} label="Quality Gate Pass" value={`${gatePassRate}%`} trend={gatePassRate >= 90 ? 'up' : 'down'} />
          <KPICard icon={Brain} label="Prüfungsfragen" value={data.totalQuestions} />
          <KPICard icon={Zap} label="Blueprints" value={data.totalBlueprints} />
          <KPICard icon={Shield} label="Gates gesamt" value={data.gatesTotal} />
        </div>
      </section>

      {/* AI & Automation */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Brain className="h-3.5 w-3.5" /> AI & Automation
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="glass-card">
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground font-medium">AI-Budget MTD</p>
              <div className="flex items-end gap-2 mt-1">
                <span className="text-2xl font-bold text-foreground">€{data.aiCostMtd.toFixed(2)}</span>
                <span className="text-sm text-muted-foreground">/ €{data.aiBudget}</span>
              </div>
              <Progress value={budgetPct} className="mt-3 h-2" />
              <p className="text-xs text-muted-foreground mt-1">{budgetPct}% verbraucht</p>
            </CardContent>
          </Card>
          <Card className="glass-card">
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground font-medium">AI Runs</p>
              <span className="text-2xl font-bold text-foreground">{data.aiRuns}</span>
              <p className="text-xs text-muted-foreground mt-1">Generierungen & Validierungen</p>
            </CardContent>
          </Card>
          <Card className="glass-card">
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground font-medium">Ø Kosten / Run</p>
              <span className="text-2xl font-bold text-foreground">
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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard icon={Clock} label="Jobs Pending" value={data.jobsPending} trend={data.jobsPending > 20 ? 'down' : 'up'} />
          <KPICard icon={CheckCircle2} label="Jobs Completed" value={data.jobsCompleted} trend="up" />
          <KPICard icon={XCircle} label="Jobs Failed" value={data.jobsFailed} trend={data.jobsFailed > 0 ? 'down' : 'up'} />
          <KPICard icon={Heart} label="System Health" value={health.label} />
        </div>
      </section>

      {/* Quick Actions */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="sm"><Link to="/admin-v2/council-control"><Brain className="h-4 w-4 mr-1" /> Council OS</Link></Button>
          <Button asChild size="sm" variant="outline"><Link to="/admin-v2/product-factory"><Zap className="h-4 w-4 mr-1" /> Produkt-Factory</Link></Button>
          <Button asChild size="sm" variant="outline"><Link to="/admin-v2/quality-gates"><Shield className="h-4 w-4 mr-1" /> Quality Gates</Link></Button>
          <Button asChild size="sm" variant="outline"><Link to="/admin-v2/jobs/dashboard"><Activity className="h-4 w-4 mr-1" /> Job Queue</Link></Button>
          <Button asChild size="sm" variant="outline"><Link to="/admin-v2/qc-dashboard"><BarChart3 className="h-4 w-4 mr-1" /> QC Reports</Link></Button>
        </div>
      </section>
    </div>
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
      <CardContent className="pt-5">
        <div className="flex items-center justify-between mb-1">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {trend && (
            <TrendingUp className={`h-3 w-3 ${trend === 'up' ? 'text-success' : 'text-destructive rotate-180'}`} />
          )}
        </div>
        <span className="text-2xl font-bold text-foreground">{value}</span>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </CardContent>
    </Card>
  );
}
