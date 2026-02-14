import { lazy, Suspense, useEffect, useState, useRef, useCallback } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { Loader2, CheckCircle2, XCircle, AlertTriangle, Copy, Download, RotateCcw, RefreshCw, Shield, Zap, Activity, Clock, Server, HeartPulse, Gauge, BookOpen, Brain, FileQuestion, Mic, Factory, Eye, Award } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import PageExplainer from '@/components/admin/PageExplainer';
import PipelineLockPanel from '@/components/admin/PipelineLockPanel';

const SystemHealthPage = lazy(() => import('@/pages/admin/SystemHealthPage'));
const AIWorkersPage = lazy(() => import('@/pages/admin/AIWorkersPage'));

const Loading = () => (
  <div className="flex items-center justify-center py-16">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

const LoadControlPage = lazy(() => import('@/pages/admin/v4/LoadControlPage'));

const SecurityFreezePage = lazy(() => import('@/pages/admin/v4/SecurityFreezePage'));

const tabs = [
  { path: '/admin/ops', label: 'Ampel' },
  { path: '/admin/ops/queue', label: 'Queue' },
  { path: '/admin/ops/throughput', label: '📊 ETA & Throughput' },
  { path: '/admin/ops/scaling', label: '⚡ Scaling' },
  { path: '/admin/ops/quality', label: '🛡️ Quality Council' },
  { path: '/admin/ops/roi', label: '💰 ROI' },
  { path: '/admin/ops/factory', label: '🏭 Factory' },
  { path: '/admin/ops/trust', label: '🏅 Trust' },
  { path: '/admin/ops/providers', label: 'Provider Autopilot' },
  { path: '/admin/ops/autoheal', label: 'Auto-Heal' },
  { path: '/admin/ops/load-control', label: 'Load Control' },
  { path: '/admin/ops/logs', label: 'Live Logs' },
  { path: '/admin/ops/deadletter', label: 'Dead Letter' },
  { path: '/admin/ops/health', label: 'Health' },
  { path: '/admin/ops/ai-workers', label: 'AI Workers' },
  { path: '/admin/ops/security', label: '🔐 Security' },
];

// ═══════════════════════════════════════════════════════════
// OPS OVERVIEW (Ampel + Root Causes + Quick Actions)
// ═══════════════════════════════════════════════════════════
function OpsOverview() {
  const [snapshot, setSnapshot] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    const { data } = await (supabase as any).from('ops_health_snapshots')
      .select('*')
      .order('snapshot_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setSnapshot(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const runPrecheck = async () => {
    setRunning(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/daily-test-runner`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ manual: true }),
      });
      if (res.ok) {
        toast.success('Precheck abgeschlossen');
        await load();
      } else {
        toast.error('Precheck fehlgeschlagen');
      }
    } catch {
      toast.error('Precheck Fehler');
    }
    setRunning(false);
  };

  const retryStuck = async () => {
    await (supabase as any).from('job_queue')
      .update({ status: 'pending', attempts: 0, locked_at: null, locked_by: null })
      .eq('status', 'processing')
      .lt('locked_at', new Date(Date.now() - 1800_000).toISOString());
    toast.success('Stuck Jobs zurückgesetzt');
    load();
  };

  if (loading) return <Loading />;
  if (!snapshot) return (
    <Card className="border-dashed">
      <CardContent className="py-12 text-center">
        <HeartPulse className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <p className="text-muted-foreground mb-4">Noch kein Health-Snapshot vorhanden</p>
        <Button onClick={runPrecheck} disabled={running}>
          {running ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
          Precheck jetzt starten
        </Button>
      </CardContent>
    </Card>
  );

  const status = snapshot.overall_status || 'green';
  const checks = snapshot.checks || {};
  const guardrails = snapshot.guardrails || {};
  const rootCauses = snapshot.root_causes || [];
  const autofixSummary = snapshot.autofix_summary || {};
  const jobQueue = snapshot.job_queue_summary || {};

  const statusColor = status === 'red' ? 'bg-destructive' : status === 'yellow' ? 'bg-yellow-500' : 'bg-emerald-500';
  const statusEmoji = status === 'red' ? '🔴' : status === 'yellow' ? '🟡' : '🟢';
  const statusLabel = status === 'red' ? 'KRITISCH' : status === 'yellow' ? 'WARNUNG' : 'GESUND';

  return (
    <div className="space-y-6">
      {/* Pipeline Lock Panel */}
      <PipelineLockPanel />
      {/* Ampel Card */}
      <Card className={cn("border-l-4", status === 'red' ? 'border-l-destructive' : status === 'yellow' ? 'border-l-yellow-500' : 'border-l-emerald-500')}>
        <CardContent className="py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={cn("w-16 h-16 rounded-full flex items-center justify-center text-2xl", statusColor)}>
                {statusEmoji}
              </div>
              <div>
                <h2 className="text-2xl font-bold">{statusLabel}</h2>
                <p className="text-sm text-muted-foreground">
                  {checks.passed}/{checks.total} Checks bestanden · {snapshot.duration_ms}ms
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Letzter Scan: {new Date(snapshot.snapshot_at).toLocaleString('de-DE')}
                </p>
              </div>
            </div>
            <Button onClick={runPrecheck} disabled={running} variant="outline">
              {running ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Jetzt prüfen
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MiniKPI label="Budget heute" value={`€${(guardrails.budget?.daily_cost_eur || 0).toFixed(2)}`} sub={`/ €${guardrails.budget?.limit_eur || 15}`} alert={guardrails.budget?.tripped} />
        <MiniKPI label="Stuck Jobs" value={jobQueue.stuck || 0} alert={(jobQueue.stuck || 0) > 0} />
        <MiniKPI label="Failed 24h" value={jobQueue.failed_24h || 0} alert={(jobQueue.failed_24h || 0) >= 5} />
        <MiniKPI label="Auto-Heal" value={guardrails.auto_heal_allowed ? '✅' : '🚫'} sub={guardrails.structural_gate?.blocked ? 'Gate blockiert' : ''} />
        <MiniKPI label="Autofix aktiv" value={autofixSummary.active || 0} sub={`${autofixSummary.frozen || 0} frozen`} />
      </div>

      {/* Root Causes */}
      {rootCauses.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Root Causes ({rootCauses.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {rootCauses.map((rc: any, i: number) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <Badge variant="outline" className={cn("text-[10px] w-24 justify-center",
                    rc.severity >= 60 ? 'bg-destructive/10 text-destructive' :
                    rc.severity >= 30 ? 'bg-yellow-500/10 text-yellow-600' : 'bg-muted text-muted-foreground'
                  )}>
                    {rc.area}
                  </Badge>
                  <span className="text-foreground">{rc.message}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Actions */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" /> Quick Actions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={retryStuck}>
              <RotateCcw className="h-3 w-3 mr-1" /> Stuck Jobs zurücksetzen
            </Button>
            <Button size="sm" variant="outline" onClick={runPrecheck} disabled={running}>
              <RefreshCw className="h-3 w-3 mr-1" /> Precheck starten
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Content Factory Status */}
      <ContentFactoryStatus />

      {/* All Checks */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="h-4 w-4" /> Alle Checks ({checks.total})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-3">Check</th>
                  <th className="text-left py-2 px-3">Bereich</th>
                  <th className="text-left py-2 px-3">Status</th>
                  <th className="text-left py-2 px-3">Detail</th>
                  <th className="text-right py-2 px-3">ms</th>
                </tr>
              </thead>
              <tbody>
                {(checks.results || []).map((c: any, i: number) => (
                  <tr key={i} className={cn("border-b border-border/30", !c.passed && "bg-destructive/5")}>
                    <td className="py-2 px-3 font-mono">{c.id}</td>
                    <td className="py-2 px-3"><Badge variant="outline" className="text-[10px]">{c.area}</Badge></td>
                    <td className="py-2 px-3">
                      {c.passed
                        ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        : <XCircle className="h-4 w-4 text-destructive" />}
                    </td>
                    <td className="py-2 px-3 text-muted-foreground truncate max-w-[300px]">{c.detail}</td>
                    <td className="py-2 px-3 text-right text-muted-foreground">{c.duration_ms}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MiniKPI({ label, value, sub, alert: isAlert }: { label: string; value: any; sub?: string; alert?: boolean }) {
  return (
    <Card className={cn(isAlert && "border-destructive/50")}>
      <CardContent className="py-3 px-4">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={cn("text-xl font-bold mt-1", isAlert ? "text-destructive" : "text-foreground")}>{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════
// CONTENT FACTORY STATUS
// ═══════════════════════════════════════════════════════════
function ContentFactoryStatus() {
  const [packages, setPackages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from('ops_content_factory').select('*').limit(20);
      setPackages(data || []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <Loading />;
  if (packages.length === 0) return null;

  const GateIcon = ({ passed }: { passed: boolean }) => passed
    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
    : <XCircle className="h-3.5 w-3.5 text-destructive" />;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Factory className="h-4 w-4" /> Content Factory ({packages.length} Pakete)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-2 px-2">Paket</th>
                <th className="text-left py-2 px-2">Status</th>
                <th className="text-center py-2 px-2">Score</th>
                <th className="text-center py-2 px-2">
                  <span className="flex items-center gap-1 justify-center"><FileQuestion className="h-3 w-3" /> Exam</span>
                </th>
                <th className="text-center py-2 px-2">
                  <span className="flex items-center gap-1 justify-center"><Mic className="h-3 w-3" /> Oral</span>
                </th>
                <th className="text-center py-2 px-2">
                  <span className="flex items-center gap-1 justify-center"><BookOpen className="h-3 w-3" /> Handbuch</span>
                </th>
                <th className="text-center py-2 px-2">
                  <span className="flex items-center gap-1 justify-center"><Brain className="h-3 w-3" /> Tutor</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {packages.map(p => (
                <tr key={p.package_id} className={cn("border-b border-border/30",
                  p.integrity_score != null && p.integrity_score < 60 && "bg-destructive/5"
                )}>
                  <td className="py-2 px-2 font-medium truncate max-w-[180px]">{p.title || p.package_id?.substring(0, 8)}</td>
                  <td className="py-2 px-2">
                    <Badge variant="outline" className={cn("text-[10px]",
                      p.status === 'published' ? 'bg-emerald-500/10 text-emerald-600' :
                      p.status === 'building' ? 'bg-primary/10 text-primary' :
                      p.status === 'failed' ? 'bg-destructive/10 text-destructive' : ''
                    )}>{p.status}</Badge>
                  </td>
                  <td className="py-2 px-2 text-center">
                    <span className={cn("font-bold",
                      (p.integrity_score ?? 0) >= 80 ? "text-emerald-600" :
                      (p.integrity_score ?? 0) >= 60 ? "text-yellow-600" : "text-destructive"
                    )}>{p.integrity_score ?? '–'}</span>
                  </td>
                  <td className="py-2 px-2">
                    <div className="flex items-center justify-center gap-1">
                      <GateIcon passed={p.exam_gate_passed} />
                      <span className="text-muted-foreground">{p.exam_count}/600</span>
                    </div>
                  </td>
                  <td className="py-2 px-2">
                    <div className="flex items-center justify-center gap-1">
                      <GateIcon passed={p.oral_gate_passed} />
                      <span className="text-muted-foreground">{p.oral_count}/20</span>
                    </div>
                  </td>
                  <td className="py-2 px-2">
                    <div className="flex items-center justify-center gap-1">
                      <GateIcon passed={p.handbook_gate_passed && p.sections_gate_passed} />
                      <span className="text-muted-foreground">{p.handbook_chapters}ch/{p.handbook_sections}s</span>
                    </div>
                  </td>
                  <td className="py-2 px-2 text-center">
                    <GateIcon passed={p.tutor_gate_passed} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════
// AUTO-HEAL CONTROL CENTER
// ═══════════════════════════════════════════════════════════
function AutoHealCenter() {
  const [runs, setRuns] = useState<any[]>([]);
  const [policy, setPolicy] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const [runsRes, policyRes] = await Promise.all([
        (supabase as any).from('autofix_runs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(20),
        (supabase as any).from('auto_heal_policies')
          .select('*')
          .eq('is_active', true)
          .maybeSingle(),
      ]);
      setRuns(runsRes.data || []);
      setPolicy(policyRes.data);
      setLoading(false);
    };
    load();
  }, []);

  if (loading) return <Loading />;

  const active = runs.filter(r => r.status === 'running');
  const frozen = runs.filter(r => r.status === 'frozen');
  const stopped = runs.filter(r => r.status === 'stopped');
  const succeeded = runs.filter(r => r.status === 'succeeded');
  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
  const todayCost = runs
    .filter(r => new Date(r.updated_at) >= todayStart)
    .reduce((s, r) => s + (r.budget_used_eur || 0), 0);

  return (
    <div className="space-y-6">
      {/* Policy Status */}
      {policy && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Gauge className="h-4 w-4" /> Auto-Heal Policy v{policy.version}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div>
                <p className="text-muted-foreground">Modus</p>
                <p className="font-medium">{policy.policy_json?.autoHeal?.mode || 'NIGHTLY'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Max Rounds</p>
                <p className="font-medium">{policy.policy_json?.autoHeal?.loop?.maxRounds || 3}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Budget Limit</p>
                <p className="font-medium">€{policy.policy_json?.guardrails?.budgetCircuitBreaker?.dailyBudgetEur || 15}/Tag</p>
              </div>
              <div>
                <p className="text-muted-foreground">Target Score</p>
                <p className="font-medium">{policy.policy_json?.checks?.integrity?.targets?.defaultTargetScore || 85}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MiniKPI label="Aktiv" value={active.length} alert={active.length > 3} />
        <MiniKPI label="Frozen" value={frozen.length} alert={frozen.length > 0} />
        <MiniKPI label="Stopped" value={stopped.length} />
        <MiniKPI label="Succeeded" value={succeeded.length} />
        <MiniKPI label="Kosten heute" value={`€${todayCost.toFixed(2)}`} sub="/ €15" alert={todayCost >= 12} />
      </div>

      {/* Runs Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Autofix Runs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-3">Paket</th>
                  <th className="text-left py-2 px-3">Status</th>
                  <th className="text-left py-2 px-3">Score</th>
                  <th className="text-left py-2 px-3">Runde</th>
                  <th className="text-left py-2 px-3">Budget</th>
                  <th className="text-left py-2 px-3">Stop-Grund</th>
                  <th className="text-left py-2 px-3">Erstellt</th>
                </tr>
              </thead>
              <tbody>
                {runs.map(r => (
                  <tr key={r.id} className={cn("border-b border-border/30",
                    r.status === 'frozen' && 'bg-blue-500/5',
                    r.status === 'stopped' && 'bg-destructive/5',
                  )}>
                    <td className="py-2 px-3 font-mono">{r.package_id?.substring(0, 8)}</td>
                    <td className="py-2 px-3">
                      <Badge variant="outline" className={cn("text-[10px]",
                        r.status === 'running' ? 'bg-primary/10 text-primary' :
                        r.status === 'succeeded' ? 'bg-emerald-500/10 text-emerald-600' :
                        r.status === 'frozen' ? 'bg-blue-500/10 text-blue-600' :
                        r.status === 'stopped' || r.status === 'failed' ? 'bg-destructive/10 text-destructive' : ''
                      )}>{r.status}</Badge>
                    </td>
                    <td className="py-2 px-3 font-medium">{r.last_score ?? '–'}</td>
                    <td className="py-2 px-3">{r.current_round}/{r.max_rounds}</td>
                    <td className="py-2 px-3">€{(r.budget_used_eur || 0).toFixed(2)}/€{r.budget_eur}</td>
                    <td className="py-2 px-3 text-muted-foreground truncate max-w-[200px]">{r.stop_reason || '–'}</td>
                    <td className="py-2 px-3 text-muted-foreground">
                      {new Date(r.created_at).toLocaleString('de-DE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// QUEUE DASHBOARD
// ═══════════════════════════════════════════════════════════
function QueueDashboard() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data } = await (supabase as any).from('job_queue')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    setJobs(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); const i = setInterval(load, 5000); return () => clearInterval(i); }, []);
  if (loading) return <Loading />;

  const statusCounts = jobs.reduce((acc: any, j) => { acc[j.status] = (acc[j.status] || 0) + 1; return acc; }, {});

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {['pending', 'processing', 'completed', 'failed'].map(s => (
          <Card key={s}>
            <CardContent className="py-3 px-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{s}</p>
              <p className={cn("text-xl font-bold mt-1",
                s === 'failed' ? 'text-destructive' : s === 'completed' ? 'text-emerald-500' :
                s === 'processing' ? 'text-primary' : 'text-muted-foreground'
              )}>{statusCounts[s] || 0}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left py-2 px-3">Job Type</th>
              <th className="text-left py-2 px-3">Status</th>
              <th className="text-left py-2 px-3">Attempts</th>
              <th className="text-left py-2 px-3">Package</th>
              <th className="text-left py-2 px-3">Fehler</th>
              <th className="text-left py-2 px-3">Erstellt</th>
            </tr>
          </thead>
          <tbody>
            {jobs.slice(0, 50).map(j => (
              <tr key={j.id} className="border-b border-border/30 hover:bg-muted/30">
                <td className="py-2 px-3 font-mono">{j.job_type}</td>
                <td className="py-2 px-3">
                  <Badge variant="outline" className={cn("text-[10px]",
                    j.status === 'failed' ? 'bg-destructive/10 text-destructive' :
                    j.status === 'completed' ? 'bg-emerald-500/10 text-emerald-600' :
                    j.status === 'processing' ? 'bg-primary/10 text-primary' : ''
                  )}>{j.status}</Badge>
                </td>
                <td className="py-2 px-3">{j.attempts}/{j.max_attempts}</td>
                <td className="py-2 px-3 font-mono text-muted-foreground truncate max-w-[120px]">
                  {j.payload?.package_id?.substring(0, 8) || '–'}
                </td>
                <td className="py-2 px-3 text-destructive truncate max-w-[200px]">{j.last_error || '–'}</td>
                <td className="py-2 px-3 text-muted-foreground">
                  {new Date(j.created_at).toLocaleString('de-DE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// LIVE LOGS
// ═══════════════════════════════════════════════════════════
function LiveLogs() {
  const [logs, setLogs] = useState<any[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const { data } = await (supabase as any).from('job_queue')
      .select('id, job_type, status, last_error, created_at, payload')
      .order('created_at', { ascending: false })
      .limit(200);
    setLogs(data || []);
  };

  useEffect(() => { load(); const i = setInterval(load, 2000); return () => clearInterval(i); }, []);

  const filtered = filter === 'all' ? logs :
    filter === 'error' ? logs.filter(l => l.status === 'failed') :
    filter === 'warn' ? logs.filter(l => l.status === 'processing') :
    logs.filter(l => l.status === 'completed');

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(filtered.slice(0, 50), null, 2));
    toast.success('Logs kopiert');
  };

  const handleDownload = () => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `logs-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1">
          {['all', 'error', 'warn', 'info'].map(f => (
            <Button key={f} variant={filter === f ? 'default' : 'outline'} size="sm" className="text-xs h-7"
              onClick={() => setFilter(f)}>
              {f === 'all' ? 'Alle' : f === 'error' ? '❌ Error' : f === 'warn' ? '⚠ Warn' : '✅ Info'}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={handleCopy}><Copy className="h-3 w-3 mr-1" /> Kopieren</Button>
          <Button variant="ghost" size="sm" onClick={handleDownload}><Download className="h-3 w-3 mr-1" /> JSON</Button>
        </div>
      </div>
      <ScrollArea className="h-[500px] rounded-md border border-border/30 bg-muted/20">
        <div className="font-mono text-xs p-3 space-y-1">
          {filtered.slice(0, 100).map((log, i) => (
            <div key={`${log.id}-${i}`} className={cn("flex gap-2 py-1 px-2 rounded",
              log.status === 'failed' ? 'bg-destructive/5' : log.status === 'processing' ? 'bg-primary/5' : ''
            )}>
              <span className="text-muted-foreground shrink-0 w-[44px]">
                {new Date(log.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className={cn("shrink-0 w-12",
                log.status === 'failed' ? 'text-destructive' : log.status === 'completed' ? 'text-emerald-500' :
                log.status === 'processing' ? 'text-primary' : 'text-muted-foreground'
              )}>{log.status}</span>
              <span className="text-foreground">{log.job_type}</span>
              {log.last_error && <span className="text-destructive truncate max-w-[300px]">– {log.last_error}</span>}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// DEAD LETTER CENTER
// ═══════════════════════════════════════════════════════════
function DeadLetterCenter() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = async () => {
    const { data } = await (supabase as any).from('job_queue')
      .select('*')
      .eq('status', 'failed')
      .order('created_at', { ascending: false });
    setJobs(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleRetrySelected = async () => {
    if (selected.size === 0) return;
    await (supabase as any).from('job_queue')
      .update({ status: 'pending', attempts: 0, run_after: new Date().toISOString() })
      .in('id', Array.from(selected));
    toast.success(`${selected.size} Jobs werden erneut versucht`);
    setSelected(new Set());
    load();
  };

  const handleRetryAll = async () => {
    await (supabase as any).from('job_queue')
      .update({ status: 'pending', attempts: 0, run_after: new Date().toISOString() })
      .eq('status', 'failed');
    toast.success('Alle fehlgeschlagenen Jobs werden erneut versucht');
    load();
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(jobs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `dead-letter-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <Loading />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">{jobs.length} fehlgeschlagene Jobs</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleRetrySelected} disabled={selected.size === 0}>
            <RotateCcw className="h-3 w-3 mr-1" /> Auswahl retrien ({selected.size})
          </Button>
          <Button variant="outline" size="sm" onClick={handleRetryAll} disabled={jobs.length === 0}>
            <RefreshCw className="h-3 w-3 mr-1" /> Alle retrien
          </Button>
          <Button variant="ghost" size="sm" onClick={handleExport}>
            <Download className="h-3 w-3 mr-1" /> JSON
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        {jobs.map(j => (
          <Card key={j.id} className={cn("border-l-4 border-l-destructive cursor-pointer transition-colors",
            selected.has(j.id) && "ring-2 ring-primary"
          )} onClick={() => {
            const next = new Set(selected);
            next.has(j.id) ? next.delete(j.id) : next.add(j.id);
            setSelected(next);
          }}>
            <CardContent className="py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-mono font-medium">{j.job_type}</span>
                <span className="text-xs text-muted-foreground">{j.attempts}/{j.max_attempts} Versuche</span>
              </div>
              {j.last_error && <p className="text-xs text-destructive mt-1 truncate">{j.last_error}</p>}
              <p className="text-[10px] text-muted-foreground mt-1">{new Date(j.created_at).toLocaleString('de-DE')}</p>
            </CardContent>
          </Card>
        ))}
        {jobs.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center text-muted-foreground text-sm">
              <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-500" />
              Keine fehlgeschlagenen Jobs 🎉
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// PROVIDER AUTOPILOT DASHBOARD
// ═══════════════════════════════════════════════════════════
function ProviderAutopilotDashboard() {
  const [providers, setProviders] = useState<any[]>([]);
  const [affinity, setAffinity] = useState<any[]>([]);
  const [backpressure, setBackpressure] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [provRes, affRes, bpRes] = await Promise.all([
      (supabase as any).from('provider_status').select('*').order('priority'),
      (supabase as any).from('provider_job_affinity').select('*').order('job_type'),
      (supabase as any).from('backpressure_snapshots').select('*').order('snapshot_at', { ascending: false }).limit(20),
    ]);
    setProviders(provRes.data || []);
    setAffinity(affRes.data || []);
    setBackpressure(bpRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); const i = setInterval(load, 10000); return () => clearInterval(i); }, [load]);

  if (loading) return <Loading />;

  const totalSlots = providers.reduce((s: number, p: any) => s + (p.max_concurrency || 0), 0);
  const usedSlots = providers.reduce((s: number, p: any) => s + (p.current_load || 0), 0);
  const healthyCount = providers.filter((p: any) => p.is_healthy).length;

  return (
    <div className="space-y-6">
      {/* Provider Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {providers.map((p: any) => {
          const loadPct = p.max_concurrency > 0 ? (p.current_load / p.max_concurrency) * 100 : 0;
          const isRL = p.rate_limited_until && new Date(p.rate_limited_until) > new Date();
          return (
            <Card key={p.provider} className={cn("border-l-4",
              !p.is_healthy ? "border-l-destructive" :
              loadPct > 80 ? "border-l-yellow-500" : "border-l-emerald-500"
            )}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Server className="h-4 w-4" />
                    {p.provider.charAt(0).toUpperCase() + p.provider.slice(1)}
                  </span>
                  <Badge variant="outline" className={cn("text-[10px]",
                    p.is_healthy ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive"
                  )}>
                    {p.is_healthy ? '✓ Healthy' : '✗ Down'}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Load Bar */}
                <div>
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>Load</span>
                    <span>{p.current_load}/{p.max_concurrency} Slots</span>
                  </div>
                  <Progress value={loadPct} className="h-2" />
                </div>

                {/* Routing Score */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">Routing Score</p>
                    <p className={cn("font-bold text-lg",
                      (p.routing_score ?? 0) >= 80 ? "text-emerald-600" :
                      (p.routing_score ?? 0) >= 50 ? "text-yellow-600" : "text-destructive"
                    )}>{(p.routing_score ?? 0).toFixed(0)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Reliability</p>
                    <p className={cn("font-bold text-lg",
                      (p.reliability_score ?? 100) >= 90 ? "text-emerald-600" :
                      (p.reliability_score ?? 100) >= 70 ? "text-yellow-600" : "text-destructive"
                    )}>{(p.reliability_score ?? 100).toFixed(0)}%</p>
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-1 text-[10px]">
                  <div className="text-center">
                    <p className="text-muted-foreground">24h ✓</p>
                    <p className="font-medium text-emerald-600">{p.total_success_24h || 0}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-muted-foreground">24h ✗</p>
                    <p className="font-medium text-destructive">{p.total_errors_24h || 0}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-muted-foreground">Latenz</p>
                    <p className="font-medium">{p.avg_latency_ms || 0}ms</p>
                  </div>
                </div>

                {/* Cooldown Status */}
                {isRL && (
                  <div className="bg-destructive/10 rounded px-2 py-1 text-xs text-destructive">
                    ⏳ Cooldown bis {new Date(p.rate_limited_until).toLocaleTimeString('de-DE')}
                    {p.cooldown_multiplier > 1 && ` (×${p.cooldown_multiplier})`}
                  </div>
                )}
                {p.consecutive_failures > 0 && (
                  <p className="text-[10px] text-destructive">
                    {p.consecutive_failures} consecutive failure{p.consecutive_failures > 1 ? 's' : ''}
                  </p>
                )}
                {p.last_error && (
                  <p className="text-[10px] text-muted-foreground truncate" title={p.last_error}>
                    Last: {p.last_error}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniKPI label="Healthy Providers" value={`${healthyCount}/${providers.length}`} alert={healthyCount < 2} />
        <MiniKPI label="Slots genutzt" value={`${usedSlots}/${totalSlots}`} alert={usedSlots >= totalSlots * 0.9} />
        <MiniKPI
          label="Backpressure"
          value={backpressure[0]?.forecast_trend === 'rising' ? '📈 Rising' : backpressure[0]?.forecast_trend === 'falling' ? '📉 Falling' : '→ Stable'}
          alert={backpressure[0]?.forecast_trend === 'rising'}
        />
        <MiniKPI
          label="ETA Queue Clear"
          value={backpressure[0]?.eta_clear_minutes ? `${backpressure[0].eta_clear_minutes.toFixed(0)} min` : '–'}
          sub={`${backpressure[0]?.throughput_per_min?.toFixed(1) ?? 0} Jobs/min`}
        />
      </div>

      {/* Intent-Based Routing Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Brain className="h-4 w-4" /> Intent-Based Routing ({affinity.length} Rules)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-3">Job Type</th>
                  <th className="text-left py-2 px-3">Provider</th>
                  <th className="text-left py-2 px-3">Grund</th>
                  <th className="text-right py-2 px-3">Weight</th>
                </tr>
              </thead>
              <tbody>
                {affinity.map((a: any) => (
                  <tr key={a.id} className="border-b border-border/30">
                    <td className="py-2 px-3 font-mono">{a.job_type}</td>
                    <td className="py-2 px-3">
                      <Badge variant="outline" className="text-[10px]">{a.preferred_provider}</Badge>
                    </td>
                    <td className="py-2 px-3 text-muted-foreground">{a.reason}</td>
                    <td className="py-2 px-3 text-right font-medium">{a.weight}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Backpressure Timeline */}
      {backpressure.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Gauge className="h-4 w-4" /> Backpressure Timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-2">Zeit</th>
                    <th className="text-right py-2 px-2">Pending</th>
                    <th className="text-right py-2 px-2">Processing</th>
                    <th className="text-right py-2 px-2">✓/h</th>
                    <th className="text-right py-2 px-2">✗/h</th>
                    <th className="text-right py-2 px-2">Jobs/min</th>
                    <th className="text-right py-2 px-2">ETA</th>
                    <th className="text-center py-2 px-2">Trend</th>
                    <th className="text-center py-2 px-2">Throttle</th>
                  </tr>
                </thead>
                <tbody>
                  {backpressure.map((bp: any) => (
                    <tr key={bp.id} className={cn("border-b border-border/30",
                      bp.throttle_active && "bg-destructive/5"
                    )}>
                      <td className="py-1.5 px-2 text-muted-foreground">
                        {new Date(bp.snapshot_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-1.5 px-2 text-right font-medium">{bp.pending_count}</td>
                      <td className="py-1.5 px-2 text-right">{bp.processing_count}</td>
                      <td className="py-1.5 px-2 text-right text-emerald-600">{bp.completed_1h}</td>
                      <td className="py-1.5 px-2 text-right text-destructive">{bp.failed_1h}</td>
                      <td className="py-1.5 px-2 text-right">{bp.throughput_per_min?.toFixed(1)}</td>
                      <td className="py-1.5 px-2 text-right">{bp.eta_clear_minutes?.toFixed(0)}m</td>
                      <td className="py-1.5 px-2 text-center">
                        {bp.forecast_trend === 'rising' ? '📈' : bp.forecast_trend === 'falling' ? '📉' : '→'}
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        {bp.throttle_active ? <Badge variant="destructive" className="text-[9px]">ON</Badge> : '–'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ETA & THROUGHPUT DASHBOARD
// ═══════════════════════════════════════════════════════════
function ThroughputDashboard() {
  const [data, setData] = useState<{
    curricula: Record<string, number>;
    packages: Record<string, number>;
    backpressure: any[];
    budget: any;
    activeSlots: string[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [currRes, pkgRes, bpRes, budgetRes, lockRes] = await Promise.all([
      (supabase as any).rpc('count_curricula_by_status'),
      (supabase as any).rpc('count_packages_by_status'),
      (supabase as any).from('backpressure_snapshots').select('*').order('snapshot_at', { ascending: false }).limit(30),
      (supabase as any).from('llm_budget').select('*').order('month', { ascending: false }).limit(1).maybeSingle(),
      (supabase as any).from('pipeline_lock').select('active_package_ids, max_active_packages').eq('id', 1).maybeSingle(),
    ]);

    // Fallback: if RPCs don't exist, use direct queries
    let curricula: Record<string, number> = {};
    let packages: Record<string, number> = {};

    if (currRes.data && !currRes.error) {
      curricula = Object.fromEntries((currRes.data as any[]).map(r => [r.status, r.count]));
    } else {
      for (const s of ['draft', 'extracting', 'normalizing', 'frozen']) {
        const { count } = await (supabase as any).from('curricula').select('id', { count: 'exact', head: true }).eq('status', s);
        curricula[s] = count ?? 0;
      }
    }

    if (pkgRes.data && !pkgRes.error) {
      packages = Object.fromEntries((pkgRes.data as any[]).map(r => [r.status, r.count]));
    } else {
      for (const s of ['queued', 'building', 'qa', 'published', 'failed']) {
        const { count } = await (supabase as any).from('course_packages').select('id', { count: 'exact', head: true }).eq('status', s);
        packages[s] = count ?? 0;
      }
    }

    setData({
      curricula,
      packages,
      backpressure: bpRes.data || [],
      budget: budgetRes.data,
      activeSlots: lockRes.data?.active_package_ids || [],
    });
    setLoading(false);
  }, []);

  useEffect(() => { load(); const i = setInterval(load, 10000); return () => clearInterval(i); }, [load]);

  if (loading) return <Loading />;
  if (!data) return null;

  const totalCurricula = Object.values(data.curricula).reduce((s, v) => s + v, 0);
  const frozenCount = data.curricula['frozen'] || 0;
  const draftCount = data.curricula['draft'] || 0;
  const freezePct = totalCurricula > 0 ? (frozenCount / totalCurricula) * 100 : 0;

  const publishedPkgs = data.packages['published'] || 0;
  const buildingPkgs = data.packages['building'] || 0;
  const queuedPkgs = data.packages['queued'] || 0;
  const failedPkgs = data.packages['failed'] || 0;
  const totalPkgs = Object.values(data.packages).reduce((s, v) => s + v, 0);

  const latestBp = data.backpressure[0];
  const throughput = latestBp?.throughput_per_min ?? 0;
  const etaMinutes = latestBp?.eta_clear_minutes ?? 0;

  // ETA calculations
  const freezeEtaMin = throughput > 0 ? draftCount / throughput : 0;
  const buildEtaMin = throughput > 0 ? queuedPkgs * 15 : 0; // ~15min per package average

  const budgetPct = data.budget
    ? (data.budget.spent_eur / data.budget.budget_eur) * 100
    : 0;

  return (
    <div className="space-y-6">
      {/* Hero KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className={cn(draftCount > 50 && "border-yellow-500/50")}>
          <CardContent className="py-4 px-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Freeze-Fortschritt</p>
            <p className="text-2xl font-bold text-foreground">{freezePct.toFixed(0)}%</p>
            <Progress value={freezePct} className="h-1.5 mt-2" />
            <p className="text-[10px] text-muted-foreground mt-1">{frozenCount}/{totalCurricula} frozen · {draftCount} drafts übrig</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4 px-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Build-Pipeline</p>
            <p className="text-2xl font-bold text-foreground">{buildingPkgs}/{data.activeSlots.length > 0 ? data.activeSlots.length : 1}</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              {queuedPkgs} queued · {publishedPkgs} published · {failedPkgs} failed
            </p>
            <p className="text-[10px] text-muted-foreground">
              WIP-Slots: {data.activeSlots.length}/{(data as any).activeSlots?.length ?? 2}
            </p>
          </CardContent>
        </Card>

        <Card className={cn(etaMinutes > 120 && "border-yellow-500/50")}>
          <CardContent className="py-4 px-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">ETA Queue Clear</p>
            <p className="text-2xl font-bold text-foreground">
              {etaMinutes > 0 ? (etaMinutes > 60 ? `${(etaMinutes / 60).toFixed(1)}h` : `${etaMinutes.toFixed(0)}min`) : '–'}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              {throughput.toFixed(1)} Jobs/min · Trend: {latestBp?.forecast_trend === 'rising' ? '📈 Rising' : latestBp?.forecast_trend === 'falling' ? '📉 Falling' : '→ Stable'}
            </p>
          </CardContent>
        </Card>

        <Card className={cn(budgetPct >= 80 && "border-destructive/50")}>
          <CardContent className="py-4 px-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">LLM Budget</p>
            <p className={cn("text-2xl font-bold", budgetPct >= 90 ? "text-destructive" : budgetPct >= 70 ? "text-yellow-600" : "text-foreground")}>
              €{data.budget?.spent_eur?.toFixed(2) ?? '0.00'}
            </p>
            <Progress value={budgetPct} className="h-1.5 mt-2" />
            <p className="text-[10px] text-muted-foreground mt-1">
              / €{data.budget?.budget_eur ?? 200} · {data.budget?.hard_stop ? '🛑 HARD STOP' : '✅ aktiv'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Phase ETAs */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4" /> Phasen-Prognose
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Phase 1: Freeze</p>
              <div className="flex items-center justify-between">
                <span className="text-sm">{draftCount} Curricula übrig</span>
                <Badge variant="outline" className="text-[10px]">
                  {freezeEtaMin > 60 ? `~${(freezeEtaMin / 60).toFixed(1)}h` : `~${freezeEtaMin.toFixed(0)}min`}
                </Badge>
              </div>
              <Progress value={freezePct} className="h-2" />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Phase 2: Build</p>
              <div className="flex items-center justify-between">
                <span className="text-sm">{queuedPkgs} Pakete in Queue</span>
                <Badge variant="outline" className="text-[10px]">
                  {buildEtaMin > 60 ? `~${(buildEtaMin / 60).toFixed(1)}h` : `~${buildEtaMin.toFixed(0)}min`}
                </Badge>
              </div>
              <Progress value={totalPkgs > 0 ? (publishedPkgs / totalPkgs) * 100 : 0} className="h-2" />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Gesamt-Fortschritt</p>
              <div className="flex items-center justify-between">
                <span className="text-sm">{publishedPkgs} von {totalPkgs} publiziert</span>
                <Badge variant="outline" className={cn("text-[10px]",
                  totalPkgs > 0 && publishedPkgs === totalPkgs && "bg-emerald-500/10 text-emerald-600"
                )}>
                  {totalPkgs > 0 ? `${((publishedPkgs / totalPkgs) * 100).toFixed(0)}%` : '0%'}
                </Badge>
              </div>
              <Progress value={totalPkgs > 0 ? (publishedPkgs / totalPkgs) * 100 : 0} className="h-2" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Curricula Status Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Curricula nach Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(data.curricula).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className={cn("w-2.5 h-2.5 rounded-full",
                      status === 'frozen' ? 'bg-emerald-500' :
                      status === 'draft' ? 'bg-muted-foreground' :
                      status === 'extracting' ? 'bg-primary' : 'bg-yellow-500'
                    )} />
                    <span className="text-foreground">{status}</span>
                  </div>
                  <span className="font-mono font-medium text-foreground">{count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Packages nach Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(data.packages).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className={cn("w-2.5 h-2.5 rounded-full",
                      status === 'published' ? 'bg-emerald-500' :
                      status === 'building' ? 'bg-primary' :
                      status === 'queued' ? 'bg-yellow-500' :
                      status === 'failed' ? 'bg-destructive' : 'bg-muted-foreground'
                    )} />
                    <span className="text-foreground">{status}</span>
                  </div>
                  <span className="font-mono font-medium text-foreground">{count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Throughput Timeline */}
      {data.backpressure.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4" /> Throughput Timeline (letzte 30 Snapshots)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-2">Zeit</th>
                    <th className="text-right py-2 px-2">Pending</th>
                    <th className="text-right py-2 px-2">Processing</th>
                    <th className="text-right py-2 px-2">✓/h</th>
                    <th className="text-right py-2 px-2">✗/h</th>
                    <th className="text-right py-2 px-2">Jobs/min</th>
                    <th className="text-right py-2 px-2">ETA</th>
                    <th className="text-center py-2 px-2">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {data.backpressure.map((bp: any) => (
                    <tr key={bp.id} className={cn("border-b border-border/30",
                      bp.throttle_active && "bg-destructive/5"
                    )}>
                      <td className="py-1.5 px-2 text-muted-foreground">
                        {new Date(bp.snapshot_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-1.5 px-2 text-right font-medium text-foreground">{bp.pending_count}</td>
                      <td className="py-1.5 px-2 text-right text-foreground">{bp.processing_count}</td>
                      <td className="py-1.5 px-2 text-right text-emerald-600">{bp.completed_1h}</td>
                      <td className="py-1.5 px-2 text-right text-destructive">{bp.failed_1h}</td>
                      <td className="py-1.5 px-2 text-right text-foreground">{bp.throughput_per_min?.toFixed(1)}</td>
                      <td className="py-1.5 px-2 text-right text-foreground">{bp.eta_clear_minutes?.toFixed(0)}m</td>
                      <td className="py-1.5 px-2 text-center">
                        {bp.forecast_trend === 'rising' ? '📈' : bp.forecast_trend === 'falling' ? '📉' : '→'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// SCALING DASHBOARD
// ═══════════════════════════════════════════════════════════
function ScalingDashboard() {
  const [capacity, setCapacity] = useState<any>(null);
  const [limits, setLimits] = useState<any[]>([]);
  const [signals, setSignals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [capRes, limRes, sigRes] = await Promise.all([
      (supabase as any).from('pipeline_capacity').select('*').eq('id', true).maybeSingle(),
      (supabase as any).from('jobtype_limits').select('*').order('job_type'),
      (supabase as any).from('ops_runtime_signals').select('*').order('ts', { ascending: false }).limit(20),
    ]);
    setCapacity(capRes.data);
    setLimits(limRes.data || []);
    setSignals(sigRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); const i = setInterval(load, 10000); return () => clearInterval(i); }, [load]);

  if (loading) return <Loading />;

  const lastDecision = capacity?.last_decision || {};

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniKPI label="Current WIP" value={capacity?.max_wip ?? '–'} sub={`min: ${capacity?.min_wip ?? 1}`} />
        <MiniKPI label="Last Action" value={lastDecision.action || '–'} sub={lastDecision.trigger || ''} />
        <MiniKPI label="Error Rate" value={`${lastDecision.error_rate ?? 0}%`} alert={(lastDecision.error_rate ?? 0) > 20} />
        <MiniKPI label="Rate Limits (10m)" value={lastDecision.rate_limit_errors_10m ?? 0} alert={(lastDecision.rate_limit_errors_10m ?? 0) > 5} />
      </div>

      {/* WIP Override */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Server className="h-4 w-4" /> WIP Override
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">max_wip:</span>
            {[1, 2, 3, 4, 5, 6].map(v => (
              <Button key={v} size="sm" variant={capacity?.max_wip === v ? 'default' : 'outline'}
                className="h-7 w-8 text-xs"
                onClick={async () => {
                  await (supabase as any).from('pipeline_capacity').update({ max_wip: v, last_decision: { action: 'manual_override', set_by: 'admin' }, updated_at: new Date().toISOString() }).eq('id', true);
                  toast.success(`WIP → ${v}`);
                  load();
                }}>
                {v}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="h-4 w-4" /> Job Type Concurrency Limits
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-3">Job Type</th>
                  <th className="text-right py-2 px-3">Max Parallel</th>
                  <th className="text-right py-2 px-3">Aktion</th>
                </tr>
              </thead>
              <tbody>
                {limits.map((l: any) => (
                  <tr key={l.job_type} className="border-b border-border/30">
                    <td className="py-2 px-3 font-mono">{l.job_type}</td>
                    <td className="py-2 px-3 text-right font-bold">{l.max_processing}</td>
                    <td className="py-2 px-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-xs" onClick={async () => {
                          if (l.max_processing <= 1) return;
                          await (supabase as any).from('jobtype_limits').update({ max_processing: l.max_processing - 1 }).eq('job_type', l.job_type);
                          load();
                        }}>−</Button>
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-xs" onClick={async () => {
                          await (supabase as any).from('jobtype_limits').update({ max_processing: l.max_processing + 1 }).eq('job_type', l.job_type);
                          load();
                        }}>+</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {signals.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4" /> Scaling Signals (letzte 20)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {signals.map((s: any, i: number) => (
                <div key={i} className="flex items-center gap-3 text-xs">
                  <span className="text-muted-foreground shrink-0 w-[100px]">
                    {new Date(s.ts).toLocaleString('de-DE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                  </span>
                  <Badge variant="outline" className={cn("text-[10px]",
                    s.signal?.action === 'scale_down' ? 'bg-destructive/10 text-destructive' :
                    s.signal?.action === 'scale_up' ? 'bg-emerald-500/10 text-emerald-600' : ''
                  )}>{s.signal?.action || '–'}</Badge>
                  <span className="text-muted-foreground">{s.signal?.trigger || ''}</span>
                  <span className="text-foreground">err: {s.signal?.error_rate ?? 0}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// QUALITY COUNCIL DASHBOARD
// ═══════════════════════════════════════════════════════════
function QualityCouncilDashboard() {
  const [reports, setReports] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [repRes, rulesRes] = await Promise.all([
      (supabase as any).from('package_quality_reports').select('*, course_packages(title)').order('created_at', { ascending: false }).limit(30),
      (supabase as any).from('quality_rules').select('*').order('rule_key'),
    ]);
    setReports(repRes.data || []);
    setRules(rulesRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Loading />;

  const passed = reports.filter(r => r.status === 'pass').length;
  const warned = reports.filter(r => r.status === 'warn').length;
  const failed = reports.filter(r => r.status === 'fail').length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniKPI label="Reports" value={reports.length} />
        <MiniKPI label="Pass" value={passed} />
        <MiniKPI label="Warn" value={warned} alert={warned > 0} />
        <MiniKPI label="Fail" value={failed} alert={failed > 0} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="h-4 w-4" /> Quality Reports
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-3">Paket</th>
                  <th className="text-left py-2 px-3">Status</th>
                  <th className="text-right py-2 px-3">Score</th>
                  <th className="text-left py-2 px-3">Erstellt</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r: any) => (
                  <tr key={r.package_id} className={cn("border-b border-border/30",
                    r.status === 'fail' && 'bg-destructive/5'
                  )}>
                    <td className="py-2 px-3 font-medium truncate max-w-[200px]">{r.course_packages?.title || r.package_id?.slice(0, 8)}</td>
                    <td className="py-2 px-3">
                      <Badge variant="outline" className={cn("text-[10px]",
                        r.status === 'pass' ? 'bg-emerald-500/10 text-emerald-600' :
                        r.status === 'warn' ? 'bg-yellow-500/10 text-yellow-600' :
                        'bg-destructive/10 text-destructive'
                      )}>{r.status}</Badge>
                    </td>
                    <td className="py-2 px-3 text-right font-bold">{r.score}</td>
                    <td className="py-2 px-3 text-muted-foreground">
                      {new Date(r.created_at).toLocaleString('de-DE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Quality Rules ({rules.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-3">Rule</th>
                  <th className="text-left py-2 px-3">Severity</th>
                  <th className="text-center py-2 px-3">Aktiv</th>
                  <th className="text-center py-2 px-3">Aktion</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r: any) => (
                  <tr key={r.id} className="border-b border-border/30">
                    <td className="py-2 px-3 font-mono">{r.rule_key}</td>
                    <td className="py-2 px-3">
                      <Button size="sm" variant="ghost" className="h-6 p-1 text-[10px]" onClick={async () => {
                        const newSev = r.severity === 'block' ? 'warn' : 'block';
                        await (supabase as any).from('quality_rules').update({ severity: newSev }).eq('id', r.id);
                        toast.success(`${r.rule_key} → ${newSev}`);
                        load();
                      }}>
                        <Badge variant="outline" className={cn("text-[10px]",
                          r.severity === 'block' ? 'bg-destructive/10 text-destructive' : 'bg-yellow-500/10 text-yellow-600'
                        )}>{r.severity}</Badge>
                      </Button>
                    </td>
                    <td className="py-2 px-3 text-center">
                      <Button size="sm" variant="ghost" className="h-6 w-8 p-0 text-xs" onClick={async () => {
                        await (supabase as any).from('quality_rules').update({ enabled: !r.enabled }).eq('id', r.id);
                        load();
                      }}>
                        {r.enabled ? '✅' : '❌'}
                      </Button>
                    </td>
                    <td className="py-2 px-3 text-center text-muted-foreground text-[10px]">Klick zum Ändern</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ROI DASHBOARD
// ═══════════════════════════════════════════════════════════
function ROIDashboard() {
  const [roi, setRoi] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await (supabase as any).rpc('get_roi_dashboard');
    setRoi(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Loading />;

  const totalRevenue = roi.reduce((s, r) => s + Number(r.revenue_eur || 0), 0);
  const totalCost = roi.reduce((s, r) => s + Number(r.llm_cost_usd || 0), 0);
  const totalNet = roi.reduce((s, r) => s + Number(r.net_revenue_eur || 0), 0);
  const profitable = roi.filter(r => Number(r.net_revenue_eur || 0) > 0).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniKPI label="Gesamt-Umsatz" value={`€${totalRevenue.toFixed(0)}`} />
        <MiniKPI label="LLM-Kosten" value={`$${totalCost.toFixed(0)}`} />
        <MiniKPI label="Netto-Umsatz" value={`€${totalNet.toFixed(0)}`} alert={totalNet < 0} />
        <MiniKPI label="Profitable" value={`${profitable}/${roi.length}`} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            💰 ROI pro Zertifizierung
          </CardTitle>
        </CardHeader>
        <CardContent>
          {roi.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Noch keine Daten vorhanden.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-3">Certification</th>
                    <th className="text-right py-2 px-3">Revenue (€)</th>
                    <th className="text-right py-2 px-3">Refunds (€)</th>
                    <th className="text-right py-2 px-3">LLM Cost ($)</th>
                    <th className="text-right py-2 px-3">Netto (€)</th>
                  </tr>
                </thead>
                <tbody>
                  {roi.map((r: any, i: number) => (
                    <tr key={i} className={cn("border-b border-border/30",
                      Number(r.net_revenue_eur || 0) < 0 && 'bg-destructive/5'
                    )}>
                      <td className="py-2 px-3 font-mono">{r.certification_id?.slice(0, 8) || '–'}</td>
                      <td className="py-2 px-3 text-right text-emerald-600">€{Number(r.revenue_eur || 0).toFixed(2)}</td>
                      <td className="py-2 px-3 text-right text-destructive">€{Number(r.refunds_eur || 0).toFixed(2)}</td>
                      <td className="py-2 px-3 text-right text-muted-foreground">${Number(r.llm_cost_usd || 0).toFixed(2)}</td>
                      <td className={cn("py-2 px-3 text-right font-bold",
                        Number(r.net_revenue_eur || 0) >= 0 ? "text-emerald-600" : "text-destructive"
                      )}>€{Number(r.net_revenue_eur || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// FACTORY DASHBOARD
// ═══════════════════════════════════════════════════════════
function FactoryDashboard() {
  const [specs, setSpecs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    const { data } = await (supabase as any)
      .from('product_factory_specs')
      .select('*, certification_catalog(title)')
      .order('updated_at', { ascending: false });
    setSpecs(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const runOrchestrator = async () => {
    setRunning(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/factory-orchestrator`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ manual: true }),
      });
      const data = await res.json();
      toast.success(`Orchestrator: ${data.actions_count ?? 0} Aktionen`);
      load();
    } catch {
      toast.error('Orchestrator-Fehler');
    }
    setRunning(false);
  };

  if (loading) return <Loading />;

  const enabled = specs.filter(s => s.enabled).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 flex-1">
          <MiniKPI label="Factory Specs" value={specs.length} />
          <MiniKPI label="Aktiviert" value={enabled} />
          <MiniKPI label="Deaktiviert" value={specs.length - enabled} />
        </div>
        <Button onClick={runOrchestrator} disabled={running} className="ml-4">
          {running ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Factory className="h-4 w-4 mr-2" />}
          Orchestrator jetzt
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Factory className="h-4 w-4" /> Product Factory Specs ({specs.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-3">Zertifizierung</th>
                  <th className="text-center py-2 px-3">Aktiv</th>
                  <th className="text-left py-2 px-3">Module</th>
                  <th className="text-left py-2 px-3">Aktualisiert</th>
                </tr>
              </thead>
              <tbody>
                {specs.map((s: any) => {
                  const spec = s.spec || {};
                  const modules = Object.entries(spec)
                    .filter(([, v]: any) => v?.enabled)
                    .map(([k]) => k);
                  return (
                    <tr key={s.certification_id} className="border-b border-border/30">
                      <td className="py-2 px-3 font-medium truncate max-w-[200px]">
                        {s.certification_catalog?.title || s.certification_id?.slice(0, 8)}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <Button size="sm" variant="ghost" className="h-6 w-8 p-0 text-xs" onClick={async () => {
                          await (supabase as any).from('product_factory_specs').update({ enabled: !s.enabled, updated_at: new Date().toISOString() }).eq('certification_id', s.certification_id);
                          load();
                        }}>
                          {s.enabled ? '✅' : '❌'}
                        </Button>
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex flex-wrap gap-1">
                          {modules.map(m => (
                            <Badge key={m} variant="outline" className="text-[9px]">{m}</Badge>
                          ))}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-muted-foreground">
                        {new Date(s.updated_at).toLocaleDateString('de-DE')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TRUST (PUBLIC QUALITY) DASHBOARD
// ═══════════════════════════════════════════════════════════
function TrustDashboard() {
  const [scores, setScores] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await (supabase as any)
      .from('package_quality_scores')
      .select('*, course_packages(title, certification_id)')
      .order('updated_at', { ascending: false })
      .limit(50);
    setScores(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Loading />;

  const BADGE_EMOJI: Record<string, string> = { platinum: '💎', gold: '🥇', silver: '🥈', bronze: '🥉' };

  const platCount = scores.filter(s => s.badge === 'platinum').length;
  const goldCount = scores.filter(s => s.badge === 'gold').length;
  const silverCount = scores.filter(s => s.badge === 'silver').length;
  const bronzeCount = scores.filter(s => s.badge === 'bronze').length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniKPI label="💎 Platin" value={platCount} />
        <MiniKPI label="🥇 Gold" value={goldCount} />
        <MiniKPI label="🥈 Silber" value={silverCount} />
        <MiniKPI label="🥉 Bronze" value={bronzeCount} alert={bronzeCount > goldCount} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Award className="h-4 w-4" /> Quality Scores (Public View)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-3">Paket</th>
                  <th className="text-center py-2 px-3">Badge</th>
                  <th className="text-right py-2 px-3">Score</th>
                  <th className="text-right py-2 px-3">Version</th>
                  <th className="text-left py-2 px-3">Aktualisiert</th>
                </tr>
              </thead>
              <tbody>
                {scores.map((s: any) => (
                  <tr key={s.package_id} className="border-b border-border/30">
                    <td className="py-2 px-3 font-medium truncate max-w-[200px]">
                      {s.course_packages?.title || s.package_id?.slice(0, 8)}
                    </td>
                    <td className="py-2 px-3 text-center text-lg">{BADGE_EMOJI[s.badge] || '–'}</td>
                    <td className={cn("py-2 px-3 text-right font-bold",
                      s.score >= 85 ? "text-emerald-600" : s.score >= 75 ? "text-yellow-600" : "text-destructive"
                    )}>{s.score}</td>
                    <td className="py-2 px-3 text-right text-muted-foreground">V{s.score_version}</td>
                    <td className="py-2 px-3 text-muted-foreground">
                      {new Date(s.updated_at).toLocaleDateString('de-DE')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MAIN EXPORT
// ═══════════════════════════════════════════════════════════
export default function OpsPage() {
  const location = useLocation();
  const activeTab = tabs.find(t => location.pathname === t.path)?.path ||
    tabs.find(t => location.pathname.startsWith(t.path) && t.path !== '/admin/ops')?.path ||
    tabs[0].path;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Ops & Auto-Heal</h1>
        <p className="text-sm text-muted-foreground">Ampel · Queue · Auto-Heal · Logs · Health · AI Workers</p>
      </div>

      <PageExplainer
        title="Wie funktioniert Ops & Auto-Heal?"
        description="Die technische Leitzentrale mit Ampel-System. Der Daily Runner prüft Schema, RLS, Jobs, Edge Functions und triggert bei Content-Gaps automatisch den Auto-Gap-Closer – blockiert aber bei strukturellen Problemen."
        workflow={[
          { label: 'Leitstelle' },
          { label: 'Studio' },
          { label: 'Quality' },
          { label: 'Ops', active: true },
          { label: 'Business' },
          { label: 'Growth' },
          { label: 'Scale' },
        ]}
        actions={[
          '"Ampel" – System-Status auf einen Blick mit Root-Cause-Ranking und Quick Actions',
          '"Queue" – Alle Jobs mit Status, Attempts und Fehlermeldungen',
          '"Auto-Heal" – Autofix Runs, Budget-Verbrauch, Policy-Konfiguration, Freeze/Stop-Gründe',
          '"Live Logs" – Terminal-ähnliche Echtzeit-Ansicht aller Job-Events',
          '"Dead Letter" – Fehlgeschlagene Jobs retrien oder exportieren',
        ]}
        tips={[
          'Grün = alles ok. Gelb = Warnung (failed jobs). Rot = Strukturproblem (Auto-Heal blockiert)',
          'Budget Circuit-Breaker stoppt bei €15/Tag automatisch',
          'Regression-Freeze friert ein, wenn Score sich nicht verbessert',
        ]}
      />

      <div className="overflow-x-auto">
        <div className="flex gap-1 border-b border-border pb-px min-w-max">
          {tabs.map(tab => (
            <Link key={tab.path} to={tab.path}
              className={cn(
                "px-3 py-2 text-sm rounded-t-md transition-colors",
                activeTab === tab.path
                  ? "bg-primary/10 text-primary font-medium border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}>
              {tab.label}
            </Link>
          ))}
        </div>
      </div>

      <Suspense fallback={<Loading />}>
        <Routes>
          <Route index element={<OpsOverview />} />
          <Route path="queue" element={<QueueDashboard />} />
          <Route path="throughput" element={<ThroughputDashboard />} />
          <Route path="scaling" element={<ScalingDashboard />} />
          <Route path="quality" element={<QualityCouncilDashboard />} />
          <Route path="roi" element={<ROIDashboard />} />
          <Route path="factory" element={<FactoryDashboard />} />
          <Route path="trust" element={<TrustDashboard />} />
          <Route path="providers" element={<ProviderAutopilotDashboard />} />
          <Route path="autoheal" element={<AutoHealCenter />} />
          <Route path="load-control" element={<LoadControlPage />} />
          <Route path="logs" element={<LiveLogs />} />
          <Route path="deadletter" element={<DeadLetterCenter />} />
          <Route path="health" element={<SystemHealthPage />} />
          <Route path="ai-workers" element={<AIWorkersPage />} />
          <Route path="security" element={<SecurityFreezePage />} />
        </Routes>
      </Suspense>
    </div>
  );
}
