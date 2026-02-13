import { lazy, Suspense, useEffect, useState, useRef, useCallback } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { Loader2, CheckCircle2, XCircle, AlertTriangle, Copy, Download, RotateCcw, RefreshCw, Shield, Zap, Activity, Clock, Server, HeartPulse, Gauge, BookOpen, Brain, FileQuestion, Mic, Factory } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import PageExplainer from '@/components/admin/PageExplainer';

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
