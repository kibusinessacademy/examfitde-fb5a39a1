import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import {
  CheckCircle2, Clock, XCircle, Activity, DollarSign, RefreshCw, Loader2,
  FileText, Headphones, Users, AlertTriangle, TrendingUp, Play, RotateCcw,
  Pause, ShieldAlert, Brain, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { PackageInfo, QueueHealth, BudgetInfo, AIDiagnose, PlatformKPIs } from './types';
import { ProductGroup } from './ProductGroup';

const REFRESH_INTERVAL = 30_000;
const fmtEur = (cents: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);

async function callAdminOps(action: string) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-ops`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function callDecisionEngine() {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/decision-engine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
    body: JSON.stringify({ action: 'aggregate' }),
  });
  if (!res.ok) return null;
  return res.json();
}

export default function HealthTab() {
  const [packages, setPackages] = useState<PackageInfo[]>([]);
  const [kpis, setKpis] = useState<PlatformKPIs>({ seoPages: 0, ticketsOpen: 0, ticketsTotal: 0, usersTotal: 0, ordersPaid: 0, revenueCents: 0 });
  const [queue, setQueue] = useState<QueueHealth>({ pending: 0, processing: 0, failed: 0, stuck: 0 });
  const [budget, setBudget] = useState<BudgetInfo>({ dailyCost: 0, monthBudget: 0, monthSpent: 0 });
  const [aiDiagnose, setAiDiagnose] = useState<AIDiagnose | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const intervalRef = useRef<ReturnType<typeof setInterval>>();
  const isMobile = useIsMobile();

  const load = useCallback(async () => {
    try {
      const sb = supabase as any;
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const [pkgRes, ticketRes, profileRes, seoRes, orderRes, costRes, budgetRes, queueRes, aiRes] = await Promise.all([
        sb.from('course_packages').select('id, title, status, build_progress, priority, current_step, step_status_json, created_at, updated_at, track').lte('priority', 20).order('priority').order('created_at'),
        sb.from('support_tickets').select('status'),
        sb.from('profiles').select('id', { count: 'exact', head: true }),
        sb.from('certification_seo_pages').select('id', { count: 'exact', head: true }),
        sb.from('orders').select('status, total_cents'),
        sb.from('llm_cost_events').select('cost_usd').gte('created_at', todayStart.toISOString()),
        sb.from('ai_cost_budgets').select('budget_eur, spent_eur').order('month', { ascending: false }).limit(1),
        callAdminOps('queue_health').catch(() => ({ pending: 0, processing: 0, failed: 0, stuck: 0 })),
        callDecisionEngine().catch(() => null),
      ]);
      setPackages((pkgRes.data || []) as PackageInfo[]);
      const tickets = (ticketRes.data || []) as { status: string }[];
      const orders = (orderRes.data || []) as { status: string; total_cents: number }[];
      const paidOrders = orders.filter(o => o.status === 'paid');
      setKpis({ seoPages: seoRes.count || 0, ticketsOpen: tickets.filter(t => t.status === 'open').length, ticketsTotal: tickets.length, usersTotal: profileRes.count || 0, ordersPaid: paidOrders.length, revenueCents: paidOrders.reduce((s, o) => s + (o.total_cents || 0), 0) });
      const costs = (costRes.data || []) as { cost_usd: number }[];
      const dailyCost = costs.reduce((s, c) => s + (c.cost_usd || 0), 0);
      const budgetRow = (budgetRes.data || [])[0];
      setBudget({ dailyCost, monthBudget: budgetRow?.budget_eur ?? 0, monthSpent: budgetRow?.spent_eur ?? 0 });
      setQueue(queueRes as QueueHealth);
      if (aiRes) {
        setAiDiagnose({ risks: (aiRes.risks || []).slice(0, 5), recommendations: (aiRes.decisions || []).slice(0, 6).map((d: any) => ({ title: d.title, impact: d.impact_score > 60 ? 'high' : 'medium', council_id: d.council_id })), systemHealth: aiRes.systemHealth || null });
      }
      setLastRefresh(new Date());
    } catch (e) { console.error('[Command] Load error:', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); intervalRef.current = setInterval(load, REFRESH_INTERVAL); return () => clearInterval(intervalRef.current); }, [load]);
  useEffect(() => { const ch = supabase.channel('command-rt').on('postgres_changes', { event: '*', schema: 'public', table: 'course_packages' }, () => load()).subscribe(); return () => { supabase.removeChannel(ch); }; }, [load]);

  const analysis = useMemo(() => {
    if (!packages.length) return null;
    const total = packages.length;
    const published = packages.filter(p => p.status === 'published').length;
    const building = packages.filter(p => p.status === 'building').length;
    const queued = packages.filter(p => p.status === 'queued').length;
    const blocked = packages.filter(p => p.status === 'blocked').length;
    const failed = packages.filter(p => p.status === 'failed').length;
    const remaining = total - published;
    const estimatedDays = Math.ceil((remaining * 4) / (5 * 24));
    const estimatedDate = new Date(Date.now() + estimatedDays * 86400_000);
    return { total, published, building, queued, blocked, failed, remaining, estimatedDays, estimatedDate };
  }, [packages]);

  const runOpsAction = async (action: string, label: string) => {
    setActing(action);
    try { const result = await callAdminOps(action); toast.success(`${label}: ${result.count ?? 0} Jobs`); setTimeout(load, 2000); } catch (e: any) { toast.error(e.message); }
    setActing(null);
  };

  const triggerRunner = async () => {
    setActing('pipeline');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pipeline-runner`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } });
      toast.success('Pipeline-Runner getriggert'); setTimeout(load, 2000);
    } catch (e: any) { toast.error(e.message); }
    setActing(null);
  };

  if (loading) return <div className="space-y-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 bg-muted/30 rounded-lg animate-pulse" />)}</div>;

  const prio5 = packages.filter(p => p.priority === 5);
  const prio10 = packages.filter(p => p.priority === 10);
  const prio15 = packages.filter(p => p.priority === 15);
  const prio20 = packages.filter(p => p.priority === 20);
  const budgetPct = budget.monthBudget > 0 ? Math.round((budget.monthSpent / budget.monthBudget) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Auto-Refresh {REFRESH_INTERVAL / 1000}s · {lastRefresh.toLocaleTimeString('de-DE')}</p>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" onClick={triggerRunner} disabled={!!acting} className="min-h-[44px] lg:min-h-0">
            {acting === 'pipeline' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}
            <span className="hidden sm:inline">Pipeline</span> Start
          </Button>
          <Button variant="ghost" size="sm" onClick={load} className="min-h-[44px] lg:min-h-0 min-w-[44px]"><RefreshCw className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      {/* Job Queue */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <KPICard icon={<Clock className="h-4 w-4 text-muted-foreground" />} label="Pending" value={queue.pending} />
        <KPICard icon={<Loader2 className="h-4 w-4 text-primary animate-spin" />} label="Processing" value={queue.processing} />
        <KPICard icon={<XCircle className="h-4 w-4 text-destructive" />} label="Failed" value={queue.failed} alert={queue.failed > 0} />
        <KPICard icon={<AlertTriangle className="h-4 w-4 text-amber-500" />} label="Stuck (>10m)" value={queue.stuck} alert={queue.stuck > 0} />
      </div>

      {/* Ops Actions */}
      {(queue.failed > 0 || queue.stuck > 0) && (
        <div className="flex flex-wrap gap-2">
          {queue.failed > 0 && <Button size="sm" variant="outline" onClick={() => runOpsAction('retry_failed_jobs', 'Retry Failed')} disabled={!!acting} className="border-destructive/30 text-destructive hover:bg-destructive/10">{acting === 'retry_failed_jobs' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 mr-1" />}{queue.failed} Failed retrien</Button>}
          {queue.stuck > 0 && <Button size="sm" variant="outline" onClick={() => runOpsAction('recover_stuck_processing', 'Recover Stuck')} disabled={!!acting} className="border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10">{acting === 'recover_stuck_processing' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Zap className="h-3.5 w-3.5 mr-1" />}{queue.stuck} Stuck recovern</Button>}
        </div>
      )}

      {/* Product KPIs + Budget */}
      {analysis && (
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
          <KPICard icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />} label="Fertig" value={`${analysis.published}/${analysis.total}`} accent="border-emerald-500/20" />
          <KPICard icon={<Loader2 className="h-4 w-4 text-primary animate-spin" />} label="Produktion" value={analysis.building} accent="border-primary/20" />
          <KPICard icon={<Clock className="h-4 w-4 text-muted-foreground" />} label="Queue" value={analysis.queued} />
          <KPICard icon={<Pause className="h-4 w-4 text-amber-500" />} label="Blockiert" value={analysis.blocked} alert={analysis.blocked > 0} />
          <KPICard icon={<XCircle className="h-4 w-4 text-destructive" />} label="Fehler" value={analysis.failed} alert={analysis.failed > 0} />
          <KPICard icon={<TrendingUp className="h-4 w-4 text-primary" />} label="Prognose" value={`~${analysis.estimatedDays}d`} sublabel={analysis.estimatedDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} />
        </div>
      )}

      {/* Budget */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2"><DollarSign className="h-4 w-4 text-muted-foreground" /><span className="text-sm font-medium">KI-Kosten heute</span></div>
              <span className="text-lg font-bold">${budget.dailyCost.toFixed(2)}</span>
            </div>
            {budget.monthBudget > 0 && (
              <>
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span>Monatsbudget: €{budget.monthSpent.toFixed(0)} / €{budget.monthBudget.toFixed(0)}</span>
                  <span className={cn(budgetPct > 80 && 'text-destructive font-semibold')}>{budgetPct}%</span>
                </div>
                <Progress value={budgetPct} className={cn("h-2", budgetPct > 80 && "[&>div]:bg-destructive")} />
              </>
            )}
          </CardContent>
        </Card>
        {analysis && (
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Gesamtfortschritt</span>
                <span className="text-xs text-muted-foreground">{analysis.published}/{analysis.total} live</span>
              </div>
              <Progress value={(analysis.published / analysis.total) * 100} className="h-3" />
            </CardContent>
          </Card>
        )}
      </div>

      {/* AI Diagnose */}
      {aiDiagnose && (
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Brain className="h-4 w-4 text-primary" /> AI Diagnose</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {aiDiagnose.risks.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {aiDiagnose.risks.map((r, i) => (
                  <Badge key={i} variant="outline" className={cn("text-xs", r.score >= 70 && "border-destructive/40 text-destructive bg-destructive/5", r.score >= 40 && r.score < 70 && "border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/5", r.score < 40 && "border-emerald-500/40 text-emerald-600 dark:text-emerald-400")}>
                    <ShieldAlert className="h-3 w-3 mr-1" />{r.scope_id}: {r.score}
                  </Badge>
                ))}
              </div>
            )}
            {aiDiagnose.systemHealth && (
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 text-xs">
                <StatBox label="Failed Jobs" value={aiDiagnose.systemHealth.failedJobs} alert={aiDiagnose.systemHealth.failedJobs > 0} />
                <StatBox label="Pending Jobs" value={aiDiagnose.systemHealth.pendingJobs} />
                <StatBox label="Gate Pass %" value={`${aiDiagnose.systemHealth.gatePassRate}%`} alert={aiDiagnose.systemHealth.gatePassRate < 80} />
                <StatBox label="AI Cost MTD" value={`€${aiDiagnose.systemHealth.aiCostMtd.toFixed(2)}`} />
                <StatBox label="Budget %" value={`${aiDiagnose.systemHealth.budgetPct}%`} alert={aiDiagnose.systemHealth.budgetPct > 80} />
              </div>
            )}
            {aiDiagnose.recommendations.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Top Empfehlungen</p>
                {aiDiagnose.recommendations.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <Badge variant="outline" className={cn("text-[10px] shrink-0 mt-0.5", r.impact === 'high' && 'border-destructive/40 text-destructive')}>{r.council_id}</Badge>
                    <span className="text-muted-foreground line-clamp-1">{r.title}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Product Groups */}
      {prio10.length > 0 && <ProductGroup title="Top 10 Ausbildungsberufe" emoji="🥇" packages={prio10} isMobile={isMobile} />}
      {prio15.length > 0 && <ProductGroup title="AEVO" emoji="🎓" packages={prio15} isMobile={isMobile} />}
      {prio20.length > 0 && <ProductGroup title="Nächste 10 Ausbildungsberufe" emoji="🥈" packages={prio20} isMobile={isMobile} />}
      {prio5.length > 0 && <ProductGroup title="Sonstige / Legacy" emoji="📦" packages={prio5} isMobile={isMobile} />}

      {/* Platform KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        <Link to="/admin/content"><PlatformCard icon={<FileText className="h-4 w-4" />} label="SEO-Seiten" value={kpis.seoPages} /></Link>
        <Link to="/admin/crm"><PlatformCard icon={<Users className="h-4 w-4" />} label="Nutzer" value={kpis.usersTotal} /></Link>
        <Link to="/admin/support"><PlatformCard icon={<Headphones className="h-4 w-4" />} label="Tickets" value={kpis.ticketsOpen} sublabel={`${kpis.ticketsTotal} ges.`} alert={kpis.ticketsOpen > 0} /></Link>
        <Link to="/admin/business"><PlatformCard icon={<DollarSign className="h-4 w-4" />} label="Umsatz" value={fmtEur(kpis.revenueCents)} sublabel={`${kpis.ordersPaid} Best.`} /></Link>
        <PlatformCard icon={<Activity className="h-4 w-4" />} label="KI-Kosten" value={`€${budget.dailyCost.toFixed(2)}`} sublabel={budget.monthBudget > 0 ? `${budgetPct}% Budget` : undefined} />
      </div>
    </div>
  );
}

function StatBox({ label, value, alert: isAlert }: { label: string; value: any; alert?: boolean }) {
  return (
    <div className={cn("rounded-md border px-2.5 py-1.5", isAlert && "border-destructive/30 bg-destructive/5")}>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn("font-bold text-sm", isAlert && "text-destructive")}>{value}</p>
    </div>
  );
}

export function KPICard({ icon, label, value, sublabel, accent, alert: isAlert }: {
  icon: React.ReactNode; label: string; value: any; sublabel?: string; accent?: string; alert?: boolean;
}) {
  return (
    <Card className={cn("transition-colors", isAlert ? "border-destructive/40 bg-destructive/5" : accent || "")}>
      <CardContent className="pt-3 pb-2.5 lg:pt-4 lg:pb-3 px-3 lg:px-6">
        <div className="flex items-center gap-1.5 mb-1">{icon}<span className="text-[10px] lg:text-xs text-muted-foreground uppercase tracking-wider truncate">{label}</span></div>
        <p className={cn("text-lg lg:text-xl font-bold", isAlert && "text-destructive")}>{value}</p>
        {sublabel && <p className="text-[10px] lg:text-xs text-muted-foreground">{sublabel}</p>}
      </CardContent>
    </Card>
  );
}

function PlatformCard({ icon, label, value, sublabel, alert: isAlert }: {
  icon: React.ReactNode; label: string; value: any; sublabel?: string; alert?: boolean;
}) {
  return (
    <Card className={cn("hover:shadow-md transition-all", isAlert && "border-amber-500/30")}>
      <CardContent className="pt-3 pb-2.5 lg:pt-4 lg:pb-3 px-3 lg:px-6">
        <div className="flex items-center gap-1.5 mb-1 text-muted-foreground">{icon}<span className="text-[10px] lg:text-xs truncate">{label}</span></div>
        <p className="text-base lg:text-lg font-bold">{value}</p>
        {sublabel && <p className="text-[10px] lg:text-xs text-muted-foreground">{sublabel}</p>}
      </CardContent>
    </Card>
  );
}
