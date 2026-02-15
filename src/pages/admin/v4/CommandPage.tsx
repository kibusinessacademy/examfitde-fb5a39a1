import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import {
  CheckCircle2, Clock, Package, XCircle, Activity,
  DollarSign, RefreshCw, Loader2, FileText, Headphones,
  Users, AlertTriangle, TrendingUp, ArrowRight, Play, RotateCcw, Pause,
  ShieldAlert, Brain, Zap
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';

const REFRESH_INTERVAL = 30_000;
const TOTAL_STEPS = 9;

interface PackageInfo {
  id: string;
  title: string | null;
  status: string;
  build_progress: number;
  priority: number;
  current_step: string | null;
  step_status_json: Record<string, string> | null;
  created_at: string;
  updated_at: string;
  track: string | null;
}

interface PlatformKPIs {
  seoPages: number;
  ticketsOpen: number;
  ticketsTotal: number;
  usersTotal: number;
  ordersPaid: number;
  revenueCents: number;
}

interface QueueHealth {
  pending: number;
  processing: number;
  failed: number;
  stuck: number;
}

interface BudgetInfo {
  dailyCost: number;
  monthBudget: number;
  monthSpent: number;
}

interface AIDiagnose {
  risks: { scope_id: string; score: number; risk_type: string }[];
  recommendations: { title: string; impact: string; council_id: string }[];
  systemHealth: { failedJobs: number; pendingJobs: number; gatePassRate: number; aiCostMtd: number; budgetPct: number } | null;
}

const STEP_LABELS: Record<string, string> = {
  scaffold_learning_course: 'Lernkurs',
  auto_seed_exam_blueprints: 'Blueprints',
  generate_exam_pool: 'Fragenpool',
  generate_oral_exam: 'Mündliche',
  build_ai_tutor_index: 'KI-Tutor',
  generate_handbook: 'Handbuch',
  run_integrity_check: 'Integrität',
  quality_council: 'QA Council',
  auto_publish: 'Publish',
};

const STEP_ORDER = [
  'scaffold_learning_course', 'auto_seed_exam_blueprints', 'generate_exam_pool',
  'generate_oral_exam', 'build_ai_tutor_index', 'generate_handbook',
  'run_integrity_check', 'quality_council', 'auto_publish',
];

const fmtEur = (cents: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);

async function callAdminOps(action: string) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-ops`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token || ''}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function callDecisionEngine() {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/decision-engine`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token || ''}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({ action: 'aggregate' }),
  });
  if (!res.ok) return null;
  return res.json();
}

export default function CommandPage() {
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
        sb.from('course_packages')
          .select('id, title, status, build_progress, priority, current_step, step_status_json, created_at, updated_at, track')
          .lte('priority', 20).order('priority').order('created_at'),
        sb.from('support_tickets').select('status'),
        sb.from('profiles').select('id', { count: 'exact', head: true }),
        sb.from('certification_seo_pages').select('id', { count: 'exact', head: true }),
        sb.from('orders').select('status, total_cents'),
        sb.from('ai_usage_log').select('cost_eur').gte('created_at', todayStart.toISOString()),
        sb.from('ai_cost_budgets').select('budget_eur, spent_eur').order('month', { ascending: false }).limit(1),
        callAdminOps('queue_health').catch(() => ({ pending: 0, processing: 0, failed: 0, stuck: 0 })),
        callDecisionEngine().catch(() => null),
      ]);

      setPackages((pkgRes.data || []) as PackageInfo[]);

      const tickets = (ticketRes.data || []) as { status: string }[];
      const orders = (orderRes.data || []) as { status: string; total_cents: number }[];
      const paidOrders = orders.filter(o => o.status === 'paid');
      setKpis({
        seoPages: seoRes.count || 0,
        ticketsOpen: tickets.filter(t => t.status === 'open').length,
        ticketsTotal: tickets.length,
        usersTotal: profileRes.count || 0,
        ordersPaid: paidOrders.length,
        revenueCents: paidOrders.reduce((s, o) => s + (o.total_cents || 0), 0),
      });

      const costs = (costRes.data || []) as { cost_eur: number }[];
      const dailyCost = costs.reduce((s, c) => s + (c.cost_eur || 0), 0);
      const budgetRow = (budgetRes.data || [])[0];
      setBudget({
        dailyCost,
        monthBudget: budgetRow?.budget_eur ?? 0,
        monthSpent: budgetRow?.spent_eur ?? 0,
      });

      setQueue(queueRes as QueueHealth);

      if (aiRes) {
        setAiDiagnose({
          risks: (aiRes.risks || []).slice(0, 5),
          recommendations: (aiRes.decisions || []).slice(0, 6).map((d: any) => ({
            title: d.title, impact: d.impact_score > 60 ? 'high' : 'medium', council_id: d.council_id,
          })),
          systemHealth: aiRes.systemHealth || null,
        });
      }

      setLastRefresh(new Date());
    } catch (e) { console.error('[Command] Load error:', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, REFRESH_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel('command-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'course_packages' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const analysis = useMemo(() => {
    if (!packages.length) return null;
    const total = packages.length;
    const published = packages.filter(p => p.status === 'published').length;
    const building = packages.filter(p => p.status === 'building').length;
    const queued = packages.filter(p => p.status === 'queued').length;
    const blocked = packages.filter(p => p.status === 'blocked').length;
    const failed = packages.filter(p => p.status === 'failed').length;
    const remaining = total - published;
    const hoursPerPackage = 4;
    const slotsAvailable = 5;
    const estimatedDays = Math.ceil((remaining * hoursPerPackage) / (slotsAvailable * 24));
    const estimatedDate = new Date(Date.now() + estimatedDays * 86400_000);
    return { total, published, building, queued, blocked, failed, remaining, estimatedDays, estimatedDate };
  }, [packages]);

  const runOpsAction = async (action: string, label: string) => {
    setActing(action);
    try {
      const result = await callAdminOps(action);
      toast.success(`${label}: ${result.count ?? 0} Jobs`);
      setTimeout(load, 2000);
    } catch (e: any) { toast.error(e.message); }
    setActing(null);
  };

  const triggerRunner = async () => {
    setActing('pipeline');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pipeline-runner`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      });
      toast.success('Pipeline-Runner getriggert');
      setTimeout(load, 2000);
    } catch (e: any) { toast.error(e.message); }
    setActing(null);
  };

  if (loading) return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-96" />
    </div>
  );

  const prio5 = packages.filter(p => p.priority === 5);
  const prio10 = packages.filter(p => p.priority === 10);
  const prio15 = packages.filter(p => p.priority === 15);
  const prio20 = packages.filter(p => p.priority === 20);

  const budgetPct = budget.monthBudget > 0 ? Math.round((budget.monthSpent / budget.monthBudget) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl lg:text-2xl font-display font-bold text-foreground">Leitstelle</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Auto-Refresh {REFRESH_INTERVAL / 1000}s · {lastRefresh.toLocaleTimeString('de-DE')}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" onClick={triggerRunner} disabled={!!acting} className="min-h-[44px] lg:min-h-0">
            {acting === 'pipeline' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}
            <span className="hidden sm:inline">Pipeline</span> Start
          </Button>
          <Button variant="ghost" size="sm" onClick={load} className="min-h-[44px] lg:min-h-0 min-w-[44px]">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ═══ JOB QUEUE HEALTH ═══ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-3">
        <KPICard icon={<Clock className="h-4 w-4 text-muted-foreground" />} label="Pending" value={queue.pending} />
        <KPICard icon={<Loader2 className="h-4 w-4 text-primary animate-spin" />} label="Processing" value={queue.processing} />
        <KPICard icon={<XCircle className="h-4 w-4 text-destructive" />} label="Failed" value={queue.failed} alert={queue.failed > 0} />
        <KPICard icon={<AlertTriangle className="h-4 w-4 text-amber-500" />} label="Stuck (>10m)" value={queue.stuck} alert={queue.stuck > 0} />
      </div>

      {/* ═══ OPS ACTIONS ═══ */}
      {(queue.failed > 0 || queue.stuck > 0) && (
        <div className="flex flex-wrap gap-2">
          {queue.failed > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => runOpsAction('retry_failed_jobs', 'Retry Failed')}
              disabled={!!acting}
              className="border-destructive/30 text-destructive hover:bg-destructive/10"
            >
              {acting === 'retry_failed_jobs' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 mr-1" />}
              {queue.failed} Failed retrien
            </Button>
          )}
          {queue.stuck > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => runOpsAction('recover_stuck_processing', 'Recover Stuck')}
              disabled={!!acting}
              className="border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
            >
              {acting === 'recover_stuck_processing' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Zap className="h-3.5 w-3.5 mr-1" />}
              {queue.stuck} Stuck recovern
            </Button>
          )}
        </div>
      )}

      {/* ═══ PRODUKT-KPIs ═══ */}
      {analysis && (
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-2 lg:gap-3">
          <KPICard icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />} label="Fertig" value={`${analysis.published}/${analysis.total}`} accent="border-emerald-500/20" />
          <KPICard icon={<Loader2 className="h-4 w-4 text-primary animate-spin" />} label="Produktion" value={analysis.building} accent="border-primary/20" />
          <KPICard icon={<Clock className="h-4 w-4 text-muted-foreground" />} label="Queue" value={analysis.queued} />
          <KPICard icon={<Pause className="h-4 w-4 text-amber-500" />} label="Blockiert" value={analysis.blocked} alert={analysis.blocked > 0} />
          <KPICard icon={<XCircle className="h-4 w-4 text-destructive" />} label="Fehler" value={analysis.failed} alert={analysis.failed > 0} />
          <KPICard icon={<TrendingUp className="h-4 w-4 text-primary" />} label="Prognose" value={`~${analysis.estimatedDays}d`} sublabel={analysis.estimatedDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} />
        </div>
      )}

      {/* ═══ BUDGET / KOSTEN ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">KI-Kosten heute</span>
              </div>
              <span className="text-lg font-bold">€{budget.dailyCost.toFixed(2)}</span>
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

        {/* Fortschritt */}
        {analysis && (
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Gesamtfortschritt</span>
                <span className="text-xs lg:text-sm text-muted-foreground">{analysis.published}/{analysis.total} live</span>
              </div>
              <Progress value={(analysis.published / analysis.total) * 100} className="h-3" />
            </CardContent>
          </Card>
        )}
      </div>

      {/* ═══ AI DIAGNOSE ═══ */}
      {aiDiagnose && (
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" /> AI Diagnose
            </CardTitle>
            <CardDescription>Decision Engine – Risk Scores & offene Empfehlungen</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Risk scores */}
            {aiDiagnose.risks.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {aiDiagnose.risks.map((r, i) => (
                  <Badge
                    key={i}
                    variant="outline"
                    className={cn(
                      "text-xs",
                      r.score >= 70 && "border-destructive/40 text-destructive bg-destructive/5",
                      r.score >= 40 && r.score < 70 && "border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/5",
                      r.score < 40 && "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
                    )}
                  >
                    <ShieldAlert className="h-3 w-3 mr-1" />
                    {r.scope_id}: {r.score}
                  </Badge>
                ))}
              </div>
            )}

            {/* System health from decision engine */}
            {aiDiagnose.systemHealth && (
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 text-xs">
                <Stat label="Failed Jobs" value={aiDiagnose.systemHealth.failedJobs} alert={aiDiagnose.systemHealth.failedJobs > 0} />
                <Stat label="Pending Jobs" value={aiDiagnose.systemHealth.pendingJobs} />
                <Stat label="Gate Pass %" value={`${aiDiagnose.systemHealth.gatePassRate}%`} alert={aiDiagnose.systemHealth.gatePassRate < 80} />
                <Stat label="AI Cost MTD" value={`€${aiDiagnose.systemHealth.aiCostMtd.toFixed(2)}`} />
                <Stat label="Budget %" value={`${aiDiagnose.systemHealth.budgetPct}%`} alert={aiDiagnose.systemHealth.budgetPct > 80} />
              </div>
            )}

            {/* Top recommendations */}
            {aiDiagnose.recommendations.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Top Empfehlungen</p>
                {aiDiagnose.recommendations.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <Badge variant="outline" className={cn("text-[10px] shrink-0 mt-0.5",
                      r.impact === 'high' && 'border-destructive/40 text-destructive'
                    )}>
                      {r.council_id}
                    </Badge>
                    <span className="text-muted-foreground line-clamp-1">{r.title}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ═══ PRODUKT-TABELLEN / CARDS ═══ */}
      {prio10.length > 0 && <ProductGroup title="Top 10 Ausbildungsberufe" emoji="🥇" packages={prio10} isMobile={isMobile} />}
      {prio15.length > 0 && <ProductGroup title="AEVO" emoji="🎓" packages={prio15} isMobile={isMobile} />}
      {prio20.length > 0 && <ProductGroup title="Nächste 10 Ausbildungsberufe" emoji="🥈" packages={prio20} isMobile={isMobile} />}
      {prio5.length > 0 && <ProductGroup title="Sonstige / Legacy" emoji="📦" packages={prio5} isMobile={isMobile} />}

      {/* ═══ INTERPRETATION ═══ */}
      {analysis && (
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">📊 Aktueller Stand</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2 text-muted-foreground">
            <p>
              <strong>{analysis.building} Produkte</strong> werden aktuell gebaut (max. 5 parallele Slots).
              {analysis.queued > 0 && <> <strong>{analysis.queued}</strong> in der Warteschlange.</>}
            </p>
            {analysis.blocked > 0 && (
              <p className="text-amber-600 dark:text-amber-400">
                ⚠️ <strong>{analysis.blocked} blockiert</strong> — wartet auf Curriculum-Daten.
              </p>
            )}
            {analysis.failed > 0 && (
              <p className="text-destructive">
                ❌ <strong>{analysis.failed} fehlgeschlagen</strong> — Retry über Status-Reset.
              </p>
            )}
            <p>
              📅 <strong>Prognose:</strong> ~{analysis.estimatedDays} Tage (≈ {analysis.estimatedDate.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' })}).
            </p>
          </CardContent>
        </Card>
      )}

      {/* ═══ PLATTFORM-KPIs ═══ */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 lg:gap-3">
        <Link to="/admin/content" className="block">
          <PlatformCard icon={<FileText className="h-4 w-4" />} label="SEO-Seiten" value={kpis.seoPages} />
        </Link>
        <Link to="/admin/crm" className="block">
          <PlatformCard icon={<Users className="h-4 w-4" />} label="Nutzer" value={kpis.usersTotal} />
        </Link>
        <Link to="/admin/support" className="block">
          <PlatformCard icon={<Headphones className="h-4 w-4" />} label="Tickets" value={kpis.ticketsOpen} sublabel={`${kpis.ticketsTotal} ges.`} alert={kpis.ticketsOpen > 0} />
        </Link>
        <Link to="/admin/business" className="block">
          <PlatformCard icon={<DollarSign className="h-4 w-4" />} label="Umsatz" value={fmtEur(kpis.revenueCents)} sublabel={`${kpis.ordersPaid} Best.`} />
        </Link>
        <PlatformCard icon={<Activity className="h-4 w-4" />} label="KI-Kosten" value={`€${budget.dailyCost.toFixed(2)}`} sublabel={budget.monthBudget > 0 ? `${budgetPct}% Budget` : undefined} />
      </div>
    </div>
  );
}

// ═══ Sub-Components ═══

function Stat({ label, value, alert: isAlert }: { label: string; value: any; alert?: boolean }) {
  return (
    <div className={cn("rounded-md border px-2.5 py-1.5", isAlert && "border-destructive/30 bg-destructive/5")}>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn("font-bold text-sm", isAlert && "text-destructive")}>{value}</p>
    </div>
  );
}

function KPICard({ icon, label, value, sublabel, accent, alert: isAlert }: {
  icon: React.ReactNode; label: string; value: any; sublabel?: string; accent?: string; alert?: boolean;
}) {
  return (
    <Card className={cn("transition-colors", isAlert ? "border-destructive/40 bg-destructive/5" : accent || "")}>
      <CardContent className="pt-3 pb-2.5 lg:pt-4 lg:pb-3 px-3 lg:px-6">
        <div className="flex items-center gap-1.5 mb-1">
          {icon}
          <span className="text-[10px] lg:text-xs text-muted-foreground uppercase tracking-wider truncate">{label}</span>
        </div>
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
        <div className="flex items-center gap-1.5 mb-1 text-muted-foreground">
          {icon}
          <span className="text-[10px] lg:text-xs truncate">{label}</span>
        </div>
        <p className="text-base lg:text-lg font-bold">{value}</p>
        {sublabel && <p className="text-[10px] lg:text-xs text-muted-foreground">{sublabel}</p>}
      </CardContent>
    </Card>
  );
}

function ProductGroup({ title, emoji, packages, isMobile }: { title: string; emoji: string; packages: PackageInfo[]; isMobile: boolean }) {
  const done = packages.filter(p => p.status === 'published').length;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">{emoji} {title}</CardTitle>
        <CardDescription>{done}/{packages.length} fertig</CardDescription>
      </CardHeader>
      <CardContent className={isMobile ? "px-3 pb-3" : "p-0"}>
        {isMobile ? (
          <div className="space-y-2">
            {packages.map(pkg => <ProductCard key={pkg.id} pkg={pkg} />)}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Produkt</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Phasen</TableHead>
                <TableHead className="text-right pr-6">Fortschritt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {packages.map(pkg => <ProductRow key={pkg.id} pkg={pkg} />)}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'published':
      return <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-xs">Live</Badge>;
    case 'building':
      return <Badge className="bg-primary/10 text-primary border-primary/20 text-xs"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Baut</Badge>;
    case 'queued':
      return <Badge variant="outline" className="text-xs"><Clock className="h-3 w-3 mr-1" />Queue</Badge>;
    case 'blocked':
      return <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 text-xs"><Pause className="h-3 w-3 mr-1" />Blockiert</Badge>;
    case 'failed':
      return <Badge variant="destructive" className="text-xs">Fehler</Badge>;
    default:
      return <Badge variant="outline" className="text-xs">{status}</Badge>;
  }
}

function getShortTitle(pkg: PackageInfo) {
  return (pkg.title || pkg.id.slice(0, 12)).replace('ExamFit – ', '');
}

function ProductCard({ pkg }: { pkg: PackageInfo }) {
  const stepStatuses = (pkg.step_status_json || {}) as Record<string, string>;
  const progress = pkg.build_progress || 0;
  return (
    <Link
      to={`/admin/studio/${pkg.id}`}
      className={cn(
        "block rounded-lg border p-3 transition-colors active:bg-muted/50",
        pkg.status === 'building' && 'border-primary/30 bg-primary/5',
        pkg.status === 'failed' && 'border-destructive/30 bg-destructive/5',
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="font-medium text-sm truncate">{getShortTitle(pkg)}</span>
        {getStatusBadge(pkg.status)}
      </div>
      <div className="flex gap-1 mb-2">
        {STEP_ORDER.map(step => {
          const s = stepStatuses[step];
          return (
            <div
              key={step}
              className={cn(
                "flex-1 h-2 rounded-sm",
                s === 'done' || s === 'skipped' ? 'bg-emerald-500' :
                s === 'running' || s === 'enqueued' ? 'bg-primary animate-pulse' :
                s === 'failed' ? 'bg-destructive' :
                'bg-muted'
              )}
              title={`${STEP_LABELS[step] || step}: ${s || 'ausstehend'}`}
            />
          );
        })}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          {pkg.current_step ? STEP_LABELS[pkg.current_step] || pkg.current_step : '—'}
        </span>
        <div className="flex items-center gap-2">
          <Progress value={progress} className="h-1.5 w-16" />
          <span className="text-xs font-mono text-muted-foreground">{progress}%</span>
        </div>
      </div>
    </Link>
  );
}

function ProductRow({ pkg }: { pkg: PackageInfo }) {
  const stepStatuses = (pkg.step_status_json || {}) as Record<string, string>;
  const progress = pkg.build_progress || 0;
  return (
    <TableRow className={cn(
      pkg.status === 'building' && 'bg-primary/5',
      pkg.status === 'failed' && 'bg-destructive/5',
    )}>
      <TableCell className="pl-6">
        <Link to={`/admin/studio/${pkg.id}`} className="hover:underline font-medium text-sm">
          {getShortTitle(pkg)}
        </Link>
      </TableCell>
      <TableCell>{getStatusBadge(pkg.status)}</TableCell>
      <TableCell>
        <div className="flex gap-0.5">
          {STEP_ORDER.map(step => {
            const s = stepStatuses[step];
            return (
              <div
                key={step}
                className={cn(
                  "w-4 h-2 rounded-sm",
                  s === 'done' || s === 'skipped' ? 'bg-emerald-500' :
                  s === 'running' || s === 'enqueued' ? 'bg-primary animate-pulse' :
                  s === 'failed' ? 'bg-destructive' :
                  'bg-muted'
                )}
                title={`${STEP_LABELS[step] || step}: ${s || 'ausstehend'}`}
              />
            );
          })}
        </div>
      </TableCell>
      <TableCell className="text-right pr-6">
        <div className="flex items-center gap-2 justify-end">
          <Progress value={progress} className="h-1.5 w-20" />
          <span className="text-xs font-mono text-muted-foreground w-8 text-right">{progress}%</span>
        </div>
      </TableCell>
    </TableRow>
  );
}
