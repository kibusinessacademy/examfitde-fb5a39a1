import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import {
  CheckCircle2, Clock, XCircle, Activity, Euro, RefreshCw, Loader2,
  FileText, Headphones, Users, AlertTriangle, TrendingUp,
  Pause, ShieldAlert, Brain, Zap, Bot, Snowflake,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { BlockedPackagesSheet } from '@/components/admin/command/BlockedPackagesSheet';
import { FailedJobsSheet } from '@/components/admin/command/FailedJobsSheet';
import { StuckPackagesSheet } from '@/components/admin/command/StuckPackagesSheet';
import { BuildingPackagesSheet } from '@/components/admin/command/BuildingPackagesSheet';
import { PublishedPackagesSheet } from '@/components/admin/command/PublishedPackagesSheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { PackageInfo, QueueHealth, BudgetInfo, AIDiagnose, PlatformKPIs } from './types';
import { ProductGroup } from './ProductGroup';
import { formatEurAmount } from '@/lib/timezone';

const REFRESH_INTERVAL = 30_000;
const fmtEur = (cents: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);

// callDecisionEngine for AI Diagnose

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
  const [disabledCriticalPolicies, setDisabledCriticalPolicies] = useState<string[]>([]);
  const [blockedSheetOpen, setBlockedSheetOpen] = useState(false);
  const [failedSheetOpen, setFailedSheetOpen] = useState(false);
  const [stuckSheetOpen, setStuckSheetOpen] = useState(false);
  const [buildingSheetOpen, setBuildingSheetOpen] = useState(false);
  const [publishedSheetOpen, setPublishedSheetOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [lastAutoOps, setLastAutoOps] = useState<{ ts: string; failed_retried: number; stuck_recovered: number } | null>(null);
  const [lastEscalation, setLastEscalation] = useState<{ level: number; action: string; target: string; ts: string } | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();
  const isMobile = useIsMobile();

  const load = useCallback(async () => {
    try {
      const sb = supabase as any;
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      const CRITICAL_POLICIES = ['cancel_zombies', 'requeue_transient_failed', 'reset_stuck_steps'];
      const [pkgRes, ticketRes, profileRes, seoRes, orderRes, todayCostRes, mtdCostRes, budgetRes, aiRes, autoOpsRes, escalationRes, opsHealthRes, policyRes] = await Promise.all([
        sb.from('course_packages').select('id, title, status, build_progress, priority, current_step, step_status_json, created_at, updated_at, track, curriculum_id').neq('status', 'archived').order('priority').order('created_at'),
        sb.from('support_tickets').select('status'),
        sb.from('profiles').select('id', { count: 'exact', head: true }),
        sb.from('certification_seo_pages').select('id', { count: 'exact', head: true }),
        sb.from('orders').select('status, total_cents'),
        sb.rpc('get_ai_cost_summary').then((r: any) => ({ data: r.data ?? { cost_today: 0, cost_mtd: 0 } })),
        Promise.resolve({ data: null }), // placeholder, cost now from RPC above
        sb.from('ai_cost_budgets').select('budget_eur, spent_eur').order('month', { ascending: false }).limit(1),
        callDecisionEngine().catch(() => null),
        sb.from('auto_heal_log').select('created_at, metadata').eq('action_type', 'auto_ops_cycle').order('created_at', { ascending: false }).limit(1),
        sb.from('escalation_log').select('escalation_level, action_type, target, created_at').order('created_at', { ascending: false }).limit(1),
        sb.from('ops_health_summary').select('*').single(),
        sb.from('auto_heal_config').select('policy_key, enabled').in('policy_key', CRITICAL_POLICIES),
      ]);
      const disabledPolicies = ((policyRes.data || []) as { policy_key: string; enabled: boolean }[])
        .filter(p => !p.enabled)
        .map(p => p.policy_key);
      setDisabledCriticalPolicies(disabledPolicies);
      setPackages((pkgRes.data || []) as PackageInfo[]);
      const tickets = (ticketRes.data || []) as { status: string }[];
      const orders = (orderRes.data || []) as { status: string; total_cents: number }[];
      const paidOrders = orders.filter(o => o.status === 'paid');
      setKpis({ seoPages: seoRes.count || 0, ticketsOpen: tickets.filter(t => t.status === 'open').length, ticketsTotal: tickets.length, usersTotal: profileRes.count || 0, ordersPaid: paidOrders.length, revenueCents: paidOrders.reduce((s, o) => s + (o.total_cents || 0), 0) });
      const costSummary = todayCostRes.data as any;
      const dailyCost = Number(costSummary?.cost_today) || 0;
      const monthSpent = Number(costSummary?.cost_mtd) || 0;
      const budgetRow = (budgetRes.data || [])[0];
      setBudget({ dailyCost, monthBudget: budgetRow?.budget_eur ?? 200, monthSpent });
      const oh = opsHealthRes?.data;
      setQueue({
        pending: oh?.pending_total ?? 0,
        processing: oh?.processing_total ?? 0,
        failed: oh?.failed_total ?? 0,
        stuck: oh?.stuck_jobs ?? 0,
      });
      if (aiRes) {
        setAiDiagnose({ risks: (aiRes.risks || []).slice(0, 5), recommendations: (aiRes.decisions || []).slice(0, 6).map((d: any) => ({ title: d.title, impact: d.impact_score > 60 ? 'high' : 'medium', council_id: d.council_id })), systemHealth: aiRes.systemHealth || null });
      }
      const autoOpsRow = (autoOpsRes.data || [])[0];
      if (autoOpsRow?.metadata) {
        setLastAutoOps({ ts: autoOpsRow.created_at, failed_retried: autoOpsRow.metadata.failed_retried ?? 0, stuck_recovered: autoOpsRow.metadata.stuck_recovered ?? 0 });
      }
      const escRow = (escalationRes.data || [])[0];
      if (escRow) {
        setLastEscalation({ level: escRow.escalation_level, action: escRow.action_type, target: escRow.target, ts: escRow.created_at });
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
    const queued = packages.filter(p => p.status === 'queued' && p.priority < 99).length;
    const frozen = packages.filter(p => p.status === 'queued' && p.priority >= 99).length;
    const blocked = packages.filter(p => p.status === 'blocked').length;
    const failed = packages.filter(p => p.status === 'failed').length;
    const remaining = total - published;
    const estimatedDays = Math.ceil((remaining * 4) / (5 * 24));
    const estimatedDate = new Date(Date.now() + estimatedDays * 86400_000);
    return { total, published, building, queued, frozen, blocked, failed, remaining, estimatedDays, estimatedDate };
  }, [packages]);

  if (loading) return <div className="space-y-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 bg-muted/30 rounded-lg animate-pulse" />)}</div>;

  const prio5 = packages.filter(p => p.priority === 5);
  const prio10 = packages.filter(p => p.priority === 10);
  const prio15 = packages.filter(p => p.priority === 15);
  const prio20 = packages.filter(p => p.priority === 20);
  const frozenPkgs = packages.filter(p => p.priority >= 99);
  const budgetPct = budget.monthBudget > 0 ? Math.round((budget.monthSpent / budget.monthBudget) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <p className="text-xs text-muted-foreground">Auto-Refresh {REFRESH_INTERVAL / 1000}s · {lastRefresh.toLocaleTimeString('de-DE')}</p>
          {lastAutoOps && (
            <Badge variant="outline" className="text-[10px] gap-1 border-primary/20">
              <Bot className="h-3 w-3" />
              Auto-Ops {new Date(lastAutoOps.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
              {(lastAutoOps.failed_retried + lastAutoOps.stuck_recovered) > 0 && (
                <span className="text-primary font-semibold ml-0.5">
                  {lastAutoOps.failed_retried + lastAutoOps.stuck_recovered} geheilt
                </span>
              )}
            </Badge>
          )}
          {lastEscalation && lastEscalation.level > 0 && (
            <Badge variant="outline" className={cn("text-[10px] gap-1", lastEscalation.level >= 3 ? "border-destructive/40 text-destructive" : "border-amber-500/40 text-amber-600 dark:text-amber-400")}>
              <Zap className="h-3 w-3" />
              L{lastEscalation.level} {lastEscalation.action.replace(/_/g, ' ')}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={load} className="min-h-[44px] lg:min-h-0 min-w-[44px]"><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>

      {/* Critical Policy Health Guard */}
      {disabledCriticalPolicies.length > 0 && (
        <Card className="border-destructive/50 bg-destructive/10">
          <CardContent className="py-3 px-4">
            <div className="flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-destructive">Kritische Auto-Heal-Policies deaktiviert</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {disabledCriticalPolicies.map(p => p.replace(/_/g, ' ')).join(', ')} — Zombie-Steps und transiente Fehler werden nicht automatisch geheilt.
                </p>
                <Link to="/admin/command" className="text-xs text-destructive underline mt-1 inline-block">
                  → Auto-Heal Policies aktivieren
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      {/* Job Queue */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <KPICard icon={<Clock className="h-4 w-4 text-muted-foreground" />} label="Pending" value={queue.pending} onClick={() => setFailedSheetOpen(true)} />
        <KPICard icon={<Loader2 className="h-4 w-4 text-primary animate-spin" />} label="Processing" value={queue.processing} onClick={() => setBuildingSheetOpen(true)} />
        <KPICard icon={<XCircle className="h-4 w-4 text-destructive" />} label="Failed" value={queue.failed} alert={queue.failed > 0} sublabel={queue.failed > 0 ? 'Auto-Retry alle 5 Min.' : undefined} onClick={() => setFailedSheetOpen(true)} />
        <KPICard icon={<AlertTriangle className="h-4 w-4 text-amber-500" />} label="Stuck (>10m)" value={queue.stuck} alert={queue.stuck > 0} sublabel={queue.stuck > 0 ? 'Auto-Recovery aktiv' : undefined} onClick={() => setStuckSheetOpen(true)} />
      </div>

      {/* Product KPIs + Budget */}
      {analysis && (
        <div className="grid grid-cols-3 lg:grid-cols-7 gap-2">
          <KPICard icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />} label="Fertig" value={`${analysis.published}/${analysis.total}`} accent="border-emerald-500/20" />
          <KPICard icon={<Loader2 className="h-4 w-4 text-primary animate-spin" />} label="Produktion" value={analysis.building} accent="border-primary/20" />
          <KPICard icon={<Clock className="h-4 w-4 text-muted-foreground" />} label="Queue" value={analysis.queued} />
          <KPICard icon={<Snowflake className="h-4 w-4 text-sky-500" />} label="Frozen" value={analysis.frozen} accent="border-sky-500/20" />
          <KPICard icon={<Pause className="h-4 w-4 text-amber-500" />} label="Blockiert" value={analysis.blocked} alert={analysis.blocked > 0} onClick={() => setBlockedSheetOpen(true)} />
          <KPICard icon={<XCircle className="h-4 w-4 text-destructive" />} label="Fehler" value={analysis.failed} alert={analysis.failed > 0} />
          <KPICard icon={<TrendingUp className="h-4 w-4 text-primary" />} label="Prognose" value={`~${analysis.estimatedDays}d`} sublabel={analysis.estimatedDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} />
        </div>
      )}

      {/* Budget */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2"><Euro className="h-4 w-4 text-muted-foreground" /><span className="text-sm font-medium">KI-Kosten heute</span></div>
              <span className="text-lg font-bold">{formatEurAmount(budget.dailyCost)}</span>
            </div>
            {budget.monthBudget > 0 && (
              <>
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span>Monatsbudget: {formatEurAmount(budget.monthSpent, 0)} / {formatEurAmount(budget.monthBudget, 0)}</span>
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
                <StatBox label="AI Cost MTD" value={formatEurAmount(aiDiagnose.systemHealth.aiCostMtd)} />
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
      {frozenPkgs.length > 0 && <ProductGroup title="Frozen (Enrichment ausstehend)" emoji="❄️" packages={frozenPkgs} isMobile={isMobile} />}

      {/* Platform KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        <Link to="/admin/command"><PlatformCard icon={<FileText className="h-4 w-4" />} label="SEO-Seiten" value={kpis.seoPages} /></Link>
        <Link to="/admin/command"><PlatformCard icon={<Users className="h-4 w-4" />} label="Nutzer" value={kpis.usersTotal} /></Link>
        <Link to="/admin/command"><PlatformCard icon={<Headphones className="h-4 w-4" />} label="Tickets" value={kpis.ticketsOpen} sublabel={`${kpis.ticketsTotal} ges.`} alert={kpis.ticketsOpen > 0} /></Link>
        <Link to="/admin/command"><PlatformCard icon={<Euro className="h-4 w-4" />} label="Umsatz" value={fmtEur(kpis.revenueCents)} sublabel={`${kpis.ordersPaid} Best.`} /></Link>
        <PlatformCard icon={<Activity className="h-4 w-4" />} label="KI-Kosten" value={formatEurAmount(budget.monthSpent)} sublabel={budget.monthBudget > 0 ? `${budgetPct}% von ${formatEurAmount(budget.monthBudget, 0)}` : `heute: ${formatEurAmount(budget.dailyCost)}`} />
      </div>
      <BlockedPackagesSheet open={blockedSheetOpen} onOpenChange={setBlockedSheetOpen} />
    </div>
  );
}

function StatBox({ label, value, alert: isAlert, onClick }: { label: string; value: any; alert?: boolean; onClick?: () => void }) {
  return (
    <div
      className={cn(
        "rounded-md border px-2.5 py-1.5 transition-all",
        isAlert && "border-destructive/30 bg-destructive/5",
        onClick && "cursor-pointer hover:ring-2 hover:ring-primary/30 active:scale-[0.98]"
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn("font-bold text-sm", isAlert && "text-destructive")}>{value}</p>
    </div>
  );
}

export function KPICard({ icon, label, value, sublabel, accent, alert: isAlert, onClick }: {
  icon: React.ReactNode; label: string; value: any; sublabel?: string; accent?: string; alert?: boolean; onClick?: () => void;
}) {
  return (
    <Card
      className={cn(
        "transition-colors",
        isAlert ? "border-destructive/40 bg-destructive/5" : accent || "",
        onClick && "cursor-pointer hover:ring-2 hover:ring-primary/30 active:scale-[0.98]"
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <CardContent className="pt-3 pb-2.5 lg:pt-4 lg:pb-3 px-3 lg:px-6">
        <div className="flex items-center gap-1.5 mb-1">{icon}<span className="text-[10px] lg:text-xs text-muted-foreground uppercase tracking-wider truncate">{label}</span></div>
        <p className={cn("text-lg lg:text-xl font-bold", isAlert && "text-destructive")}>{value}</p>
        {sublabel && <p className="text-[10px] lg:text-xs text-muted-foreground">{sublabel}</p>}
      </CardContent>
    </Card>
  );
}

function PlatformCard({ icon, label, value, sublabel, alert: isAlert, onClick }: {
  icon: React.ReactNode; label: string; value: any; sublabel?: string; alert?: boolean; onClick?: () => void;
}) {
  return (
    <Card
      className={cn(
        "hover:shadow-md transition-all",
        isAlert && "border-amber-500/30",
        onClick && "cursor-pointer hover:ring-2 hover:ring-primary/30 active:scale-[0.98]"
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <CardContent className="pt-3 pb-2.5 lg:pt-4 lg:pb-3 px-3 lg:px-6">
        <div className="flex items-center gap-1.5 mb-1 text-muted-foreground">{icon}<span className="text-[10px] lg:text-xs truncate">{label}</span></div>
        <p className="text-base lg:text-lg font-bold">{value}</p>
        {sublabel && <p className="text-[10px] lg:text-xs text-muted-foreground">{sublabel}</p>}
      </CardContent>
    </Card>
  );
}
