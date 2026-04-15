import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  BarChart3, TrendingUp, Users, Euro, BookOpen, Activity, 
  Sparkles, Loader2, RefreshCw, Target, Zap, ShieldCheck
} from 'lucide-react';
import { toast } from 'sonner';

/* ── AI Helper ── */
async function callKpiAI(payload: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('admin-ai-assistant', { body: payload });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data?.result as string;
}

/* ── Hooks ── */
function useRevenueKPIs() {
  return useQuery({
    queryKey: ['kpi-revenue'],
    queryFn: async () => {
      const [ordersRes, usersRes, coursesRes] = await Promise.all([
        supabase.from('orders').select('total_amount, created_at, status').order('created_at', { ascending: false }).limit(500),
        supabase.from('profiles').select('id, created_at').limit(1000),
        supabase.from('courses').select('id, title').limit(100),
      ]);
      const orders = ordersRes.data ?? [];
      const paidOrders = orders.filter(o => o.status === 'paid' || o.status === 'completed');
      const totalRevenue = paidOrders.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
      const last30 = paidOrders.filter(o => new Date(o.created_at) > new Date(Date.now() - 30 * 86400000));
      const mrr = last30.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
      return {
        totalRevenue,
        mrr,
        orderCount: paidOrders.length,
        last30Orders: last30.length,
        totalUsers: usersRes.data?.length ?? 0,
        totalCourses: coursesRes.data?.length ?? 0,
        avgOrderValue: paidOrders.length > 0 ? totalRevenue / paidOrders.length : 0,
        conversionRate: (usersRes.data?.length ?? 0) > 0 ? ((paidOrders.length / (usersRes.data?.length ?? 1)) * 100) : 0,
      };
    },
    staleTime: 60_000,
  });
}

function usePipelineKPIs() {
  return useQuery({
    queryKey: ['kpi-pipeline'],
    queryFn: async () => {
      const [pkgRes, jobRes] = await Promise.all([
        supabase.from('course_packages').select('id, status, pipeline_phase').limit(500),
        supabase.from('ops_job_queue').select('id, status, job_type').limit(500),
      ]);
      const pkgs = pkgRes.data ?? [];
      const jobs = jobRes.data ?? [];
      return {
        totalPackages: pkgs.length,
        published: pkgs.filter(p => p.status === 'published').length,
        building: pkgs.filter(p => p.status === 'building').length,
        blocked: pkgs.filter(p => p.status === 'blocked').length,
        totalJobs: jobs.length,
        pendingJobs: jobs.filter(j => j.status === 'pending').length,
        failedJobs: jobs.filter(j => j.status === 'failed').length,
      };
    },
    staleTime: 30_000,
  });
}

/* ── KPI Card ── */
function KpiCard({ title, value, subtitle, icon: Icon, trend, tone }: {
  title: string; value: string | number; subtitle?: string;
  icon: typeof BarChart3; trend?: string; tone?: 'success' | 'warning' | 'destructive' | 'default';
}) {
  const toneMap = {
    success: 'border-green-500/30 bg-green-500/5',
    warning: 'border-yellow-500/30 bg-yellow-500/5',
    destructive: 'border-destructive/30 bg-destructive/5',
    default: 'border-border',
  };
  return (
    <Card className={toneMap[tone ?? 'default']}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[11px] text-muted-foreground font-medium">{title}</div>
            <div className="text-2xl font-bold text-foreground mt-1">{value}</div>
            {subtitle && <div className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</div>}
          </div>
          <div className="p-2 rounded-lg bg-muted/50">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
        {trend && (
          <div className="mt-2 flex items-center gap-1">
            <TrendingUp className="h-3 w-3 text-green-500" />
            <span className="text-[10px] text-green-500 font-medium">{trend}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Main Page ── */
export default function KPIPage() {
  const { data: revenue, isLoading: revLoading, refetch: refetchRev } = useRevenueKPIs();
  const { data: pipeline, isLoading: pipLoading, refetch: refetchPip } = usePipelineKPIs();
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiInsight, setAiInsight] = useState<string | null>(null);

  const handleAIAnalysis = async (type: string) => {
    setAiLoading(type);
    try {
      const context = type === 'revenue'
        ? `Revenue: €${revenue?.totalRevenue?.toFixed(2)}, MRR: €${revenue?.mrr?.toFixed(2)}, Orders: ${revenue?.orderCount}, Users: ${revenue?.totalUsers}, Avg Order: €${revenue?.avgOrderValue?.toFixed(2)}, Conversion: ${revenue?.conversionRate?.toFixed(1)}%`
        : `Packages: ${pipeline?.totalPackages}, Published: ${pipeline?.published}, Building: ${pipeline?.building}, Blocked: ${pipeline?.blocked}, Jobs: ${pipeline?.totalJobs}, Pending: ${pipeline?.pendingJobs}, Failed: ${pipeline?.failedJobs}`;
      
      const result = await callKpiAI({
        role: 'kpi',
        action: type === 'revenue' ? 'analyze_revenue' : 'analyze_pipeline',
        context,
      });
      setAiInsight(result);
      toast.success('KI-Analyse erstellt');
    } catch (e) {
      toast.error(`Fehler: ${(e as Error).message}`);
    } finally {
      setAiLoading(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" /> KPI Dashboard
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">Business Intelligence · Echtzeit-Metriken · KI-Analysen</p>
        </div>
        <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => { refetchRev(); refetchPip(); }}>
          <RefreshCw className="h-3 w-3" /> Aktualisieren
        </Button>
      </div>

      <Tabs defaultValue="revenue" className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1 rounded-xl">
          <TabsTrigger value="revenue" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg">
            <Euro className="h-3 w-3" /> Revenue
          </TabsTrigger>
          <TabsTrigger value="pipeline" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg">
            <Activity className="h-3 w-3" /> Pipeline
          </TabsTrigger>
          <TabsTrigger value="users" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg">
            <Users className="h-3 w-3" /> Nutzer
          </TabsTrigger>
          <TabsTrigger value="quality" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg">
            <ShieldCheck className="h-3 w-3" /> Qualität
          </TabsTrigger>
        </TabsList>

        {/* Revenue Tab */}
        <TabsContent value="revenue" className="mt-4 space-y-4">
          {revLoading ? <Skeleton className="h-40 w-full" /> : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiCard title="Gesamtumsatz" value={`€${(revenue?.totalRevenue ?? 0).toFixed(0)}`} icon={Euro} tone="success" subtitle="Alle Bestellungen" />
                <KpiCard title="MRR (30 Tage)" value={`€${(revenue?.mrr ?? 0).toFixed(0)}`} icon={TrendingUp} tone="success" subtitle={`${revenue?.last30Orders ?? 0} Bestellungen`} />
                <KpiCard title="Ø Warenkorbwert" value={`€${(revenue?.avgOrderValue ?? 0).toFixed(2)}`} icon={Target} />
                <KpiCard title="Conversion Rate" value={`${(revenue?.conversionRate ?? 0).toFixed(1)}%`} icon={Zap} tone={Number(revenue?.conversionRate ?? 0) > 5 ? 'success' : 'warning'} subtitle="Nutzer → Käufer" />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => handleAIAnalysis('revenue')} disabled={!!aiLoading}>
                  {aiLoading === 'revenue' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  KI: Umsatz analysieren
                </Button>
                <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => handleAIAnalysis('growth_tips')} disabled={!!aiLoading}>
                  {aiLoading === 'growth_tips' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  KI: Wachstumstipps
                </Button>
              </div>
            </>
          )}
        </TabsContent>

        {/* Pipeline Tab */}
        <TabsContent value="pipeline" className="mt-4 space-y-4">
          {pipLoading ? <Skeleton className="h-40 w-full" /> : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiCard title="Pakete gesamt" value={pipeline?.totalPackages ?? 0} icon={BookOpen} />
                <KpiCard title="Published" value={pipeline?.published ?? 0} icon={ShieldCheck} tone="success" />
                <KpiCard title="Building" value={pipeline?.building ?? 0} icon={Activity} tone="warning" />
                <KpiCard title="Blocked" value={pipeline?.blocked ?? 0} icon={Zap} tone={(pipeline?.blocked ?? 0) > 3 ? 'destructive' : 'default'} />
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                <KpiCard title="Jobs gesamt" value={pipeline?.totalJobs ?? 0} icon={Activity} />
                <KpiCard title="Pending" value={pipeline?.pendingJobs ?? 0} icon={Loader2} tone="warning" />
                <KpiCard title="Failed" value={pipeline?.failedJobs ?? 0} icon={Zap} tone={(pipeline?.failedJobs ?? 0) > 0 ? 'destructive' : 'default'} />
              </div>
              <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => handleAIAnalysis('pipeline')} disabled={!!aiLoading}>
                {aiLoading === 'pipeline' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                KI: Pipeline-Health analysieren
              </Button>
            </>
          )}
        </TabsContent>

        {/* Users Tab */}
        <TabsContent value="users" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <KpiCard title="Registrierte Nutzer" value={revenue?.totalUsers ?? '—'} icon={Users} tone="success" />
            <KpiCard title="Aktive Kurse" value={revenue?.totalCourses ?? '—'} icon={BookOpen} />
            <KpiCard title="Bestellungen" value={revenue?.orderCount ?? '—'} icon={Euro} />
          </div>
          <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => handleAIAnalysis('revenue')} disabled={!!aiLoading}>
            {aiLoading === 'revenue' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            KI: Nutzer-Insights
          </Button>
        </TabsContent>

        {/* Quality Tab */}
        <TabsContent value="quality" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <KpiCard title="Published" value={pipeline?.published ?? '—'} icon={ShieldCheck} tone="success" subtitle="Qualitätsgeprüft" />
            <KpiCard title="Failed Jobs" value={pipeline?.failedJobs ?? '—'} icon={Zap} tone={(pipeline?.failedJobs ?? 0) > 0 ? 'destructive' : 'success'} />
            <KpiCard title="Build-Rate" value={`${pipeline?.totalPackages ? ((pipeline.published / pipeline.totalPackages) * 100).toFixed(0) : 0}%`} icon={Target} />
          </div>
          <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => handleAIAnalysis('pipeline')} disabled={!!aiLoading}>
            {aiLoading === 'pipeline' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            KI: Qualitätsbericht
          </Button>
        </TabsContent>
      </Tabs>

      {/* AI Insight Panel */}
      {aiInsight && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> KI-Analyse
            </CardTitle>
            <CardDescription className="text-[10px]">Automatisch generiert</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">{aiInsight}</div>
            <Button variant="ghost" size="sm" className="mt-2 text-[10px]" onClick={() => setAiInsight(null)}>Schließen</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
