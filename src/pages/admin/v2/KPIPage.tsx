import { useState, lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  BarChart3, TrendingUp, Users, Euro, BookOpen, Activity, 
  Sparkles, Loader2, RefreshCw, Target, Zap, ShieldCheck
} from 'lucide-react';
import { toast } from 'sonner';
const SSOTHealthCard = lazy(() => import('@/components/admin/SSOTHealthCard'));

async function callKpiAI(payload: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('admin-ai-assistant', { body: payload });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data?.result as string;
}

function useRevenueKPIs() {
  return useQuery({
    queryKey: ['kpi-revenue'],
    queryFn: async () => {
      const [ordersRes, itemsRes, usersRes, coursesRes] = await Promise.all([
        supabase.from('orders').select('id, status, created_at').order('created_at', { ascending: false }).limit(500),
        supabase.from('order_items').select('order_id, unit_amount_gross_cents, quantity').limit(1000),
        supabase.from('profiles').select('id, created_at').limit(1000),
        supabase.from('courses').select('id, title').limit(100),
      ]);
      const orders = ordersRes.data ?? [];
      const items = itemsRes.data ?? [];
      const paidOrders = orders.filter((o: any) => o.status === 'paid' || o.status === 'completed');
      const paidIds = new Set(paidOrders.map((o: any) => o.id));
      const paidItems = items.filter((i: any) => paidIds.has(i.order_id));
      const totalRevenue = paidItems.reduce((sum: number, i: any) => sum + ((i.unit_amount_gross_cents ?? 0) * (i.quantity ?? 1)) / 100, 0);
      const last30 = paidOrders.filter((o: any) => new Date(o.created_at) > new Date(Date.now() - 30 * 86400000));
      const last30Ids = new Set(last30.map((o: any) => o.id));
      const last30Items = items.filter((i: any) => last30Ids.has(i.order_id));
      const mrr = last30Items.reduce((sum: number, i: any) => sum + ((i.unit_amount_gross_cents ?? 0) * (i.quantity ?? 1)) / 100, 0);
      const userCount = usersRes.data?.length ?? 0;
      return {
        totalRevenue,
        mrr,
        orderCount: paidOrders.length,
        last30Orders: last30.length,
        totalUsers: userCount,
        totalCourses: coursesRes.data?.length ?? 0,
        avgOrderValue: paidOrders.length > 0 ? totalRevenue / paidOrders.length : 0,
        conversionRate: userCount > 0 ? (paidOrders.length / userCount) * 100 : 0,
      };
    },
    staleTime: 60_000,
  });
}

function usePipelineKPIs() {
  return useQuery({
    queryKey: ['kpi-pipeline'],
    queryFn: async () => {
      const pkgRes = await supabase.from('course_packages').select('id, status').limit(500);
      const pkgs = (pkgRes.data ?? []) as { id: string; status: string | null }[];
      return {
        totalPackages: pkgs.length,
        published: pkgs.filter(p => p.status === 'published').length,
        building: pkgs.filter(p => p.status === 'building').length,
        blocked: pkgs.filter(p => p.status === 'blocked').length,
      };
    },
    staleTime: 30_000,
  });
}

function KpiCard({ title, value, subtitle, icon: Icon, trend, tone }: {
  title: string; value: string | number; subtitle?: string;
  icon: typeof BarChart3; trend?: string; tone?: 'success' | 'warning' | 'destructive' | 'default';
}) {
  const toneMap = {
    success: 'border-primary/30 bg-primary/5',
    warning: 'border-warning/30 bg-warning/5',
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
          <div className="p-2 rounded-lg bg-muted/50"><Icon className="h-4 w-4 text-muted-foreground" /></div>
        </div>
        {trend && (
          <div className="mt-2 flex items-center gap-1">
            <TrendingUp className="h-3 w-3 text-primary" />
            <span className="text-[10px] text-primary font-medium">{trend}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function KPIPage() {
  const { data: revenue, isLoading: revLoading, refetch: refetchRev } = useRevenueKPIs();
  const { data: pipeline, isLoading: pipLoading, refetch: refetchPip } = usePipelineKPIs();
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiInsight, setAiInsight] = useState<string | null>(null);

  const handleAIAnalysis = async (type: string) => {
    setAiLoading(type);
    try {
      const context = type === 'revenue' || type === 'growth_tips'
        ? `Revenue: €${revenue?.totalRevenue?.toFixed(2)}, MRR: €${revenue?.mrr?.toFixed(2)}, Orders: ${revenue?.orderCount}, Users: ${revenue?.totalUsers}, Avg Order: €${revenue?.avgOrderValue?.toFixed(2)}, Conversion: ${revenue?.conversionRate?.toFixed(1)}%`
        : `Packages: ${pipeline?.totalPackages}, Published: ${pipeline?.published}, Building: ${pipeline?.building}, Blocked: ${pipeline?.blocked}`;
      const result = await callKpiAI({ role: 'kpi', action: type === 'growth_tips' ? 'growth_tips' : type === 'revenue' ? 'analyze_revenue' : 'analyze_pipeline', context });
      setAiInsight(result);
      toast.success('KI-Analyse erstellt');
    } catch (e) {
      toast.error(`Fehler: ${(e as Error).message}`);
    } finally { setAiLoading(null); }
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
          <RefreshCw className="h-3 w-3" /> Refresh
        </Button>
      </div>

      <Tabs defaultValue="revenue" className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1 rounded-xl">
          <TabsTrigger value="revenue" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg"><Euro className="h-3 w-3" /> Revenue</TabsTrigger>
          <TabsTrigger value="pipeline" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg"><Activity className="h-3 w-3" /> Pipeline</TabsTrigger>
          <TabsTrigger value="users" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg"><Users className="h-3 w-3" /> Nutzer</TabsTrigger>
          <TabsTrigger value="quality" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg"><ShieldCheck className="h-3 w-3" /> Qualität</TabsTrigger>
        </TabsList>

        <TabsContent value="revenue" className="mt-4 space-y-4">
          {revLoading ? <Skeleton className="h-40 w-full" /> : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiCard title="Gesamtumsatz" value={`€${(revenue?.totalRevenue ?? 0).toFixed(0)}`} icon={Euro} tone="success" />
                <KpiCard title="MRR (30 Tage)" value={`€${(revenue?.mrr ?? 0).toFixed(0)}`} icon={TrendingUp} tone="success" subtitle={`${revenue?.last30Orders ?? 0} Bestellungen`} />
                <KpiCard title="Ø Warenkorbwert" value={`€${(revenue?.avgOrderValue ?? 0).toFixed(2)}`} icon={Target} />
                <KpiCard title="Conversion" value={`${(revenue?.conversionRate ?? 0).toFixed(1)}%`} icon={Zap} tone={(revenue?.conversionRate ?? 0) > 5 ? 'success' : 'warning'} subtitle="Nutzer → Käufer" />
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => handleAIAnalysis('revenue')} disabled={!!aiLoading}>
                  {aiLoading === 'revenue' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} KI: Umsatz analysieren
                </Button>
                <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => handleAIAnalysis('growth_tips')} disabled={!!aiLoading}>
                  {aiLoading === 'growth_tips' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} KI: Wachstumstipps
                </Button>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="pipeline" className="mt-4 space-y-4">
          {pipLoading ? <Skeleton className="h-40 w-full" /> : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiCard title="Pakete gesamt" value={pipeline?.totalPackages ?? 0} icon={BookOpen} />
                <KpiCard title="Published" value={pipeline?.published ?? 0} icon={ShieldCheck} tone="success" />
                <KpiCard title="Building" value={pipeline?.building ?? 0} icon={Activity} tone="warning" />
                <KpiCard title="Blocked" value={pipeline?.blocked ?? 0} icon={Zap} tone={(pipeline?.blocked ?? 0) > 3 ? 'destructive' : 'default'} />
              </div>
              <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => handleAIAnalysis('pipeline')} disabled={!!aiLoading}>
                {aiLoading === 'pipeline' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} KI: Pipeline analysieren
              </Button>
            </>
          )}
        </TabsContent>

        <TabsContent value="users" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <KpiCard title="Registrierte Nutzer" value={revenue?.totalUsers ?? '—'} icon={Users} tone="success" />
            <KpiCard title="Aktive Kurse" value={revenue?.totalCourses ?? '—'} icon={BookOpen} />
            <KpiCard title="Bestellungen" value={revenue?.orderCount ?? '—'} icon={Euro} />
          </div>
        </TabsContent>

        <TabsContent value="quality" className="mt-4 space-y-4">
          <Suspense fallback={<Skeleton className="h-48 w-full" />}>
            <SSOTHealthCard />
          </Suspense>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <KpiCard title="Published" value={pipeline?.published ?? '—'} icon={ShieldCheck} tone="success" subtitle="Qualitätsgeprüft" />
            <KpiCard title="Blocked" value={pipeline?.blocked ?? '—'} icon={Zap} tone={(pipeline?.blocked ?? 0) > 0 ? 'destructive' : 'success'} />
            <KpiCard title="Build-Rate" value={`${pipeline?.totalPackages ? Math.round((pipeline.published / pipeline.totalPackages) * 100) : 0}%`} icon={Target} />
          </div>
        </TabsContent>
      </Tabs>

      {aiInsight && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> KI-Analyse</CardTitle>
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
