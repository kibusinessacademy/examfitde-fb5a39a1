import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Helmet } from 'react-helmet-async';
import { toast } from 'sonner';
import { Loader2, Play, RefreshCw, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';

type Scenario = {
  scenario_key: string;
  area: string;
  name: string;
  description: string | null;
  default_mode: string;
};

type Run = {
  id: string;
  scenario_key: string;
  area: string | null;
  scenario_name: string | null;
  mode: string;
  triggered_by: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  total_steps: number | null;
  passed: number | null;
  failed: number | null;
  skipped: number | null;
};

type Step = {
  step_index: number;
  name: string;
  status: 'pass' | 'fail' | 'skip';
  latency_ms: number | null;
  details: Record<string, unknown> | null;
  error: string | null;
};

function statusBadge(status: string) {
  const map: Record<string, string> = {
    passed: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
    partial: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
    failed: 'bg-red-500/15 text-red-700 border-red-500/30',
    error: 'bg-red-500/15 text-red-700 border-red-500/30',
    running: 'bg-blue-500/15 text-blue-700 border-blue-500/30',
  };
  return map[status] ?? 'bg-muted text-muted-foreground';
}

function stepIcon(status: string) {
  if (status === 'pass') return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === 'fail') return <XCircle className="h-4 w-4 text-red-600" />;
  return <MinusCircle className="h-4 w-4 text-muted-foreground" />;
}

export default function WorkflowSimulatorPage() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<Run | null>(null);
  const [openSteps, setOpenSteps] = useState<Step[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [sRes, rRes] = await Promise.all([
      supabase.from('workflow_simulator_scenarios' as any).select('*').eq('is_active', true).order('area'),
      supabase.from('v_workflow_simulator_overview' as any).select('*').limit(50),
    ]);
    if (!sRes.error) setScenarios((sRes.data ?? []) as any);
    if (!rRes.error) setRuns((rRes.data ?? []) as any);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const triggerRun = async (scenario_key: string, mode: 'smoke' | 'live') => {
    setRunning(scenario_key);
    try {
      const { data: runId, error: rpcErr } = await supabase.rpc(
        'admin_enqueue_workflow_simulator_run' as any,
        { p_scenario: scenario_key, p_mode: mode },
      );
      if (rpcErr) throw rpcErr;

      const { data, error } = await supabase.functions.invoke('workflow-simulator', {
        body: { scenario_key, mode, run_id: runId, triggered_by: 'admin' },
      });
      if (error) throw error;

      toast.success(`${scenario_key}: ${data.passed}✓ ${data.failed}✗ ${data.skipped}⊘ (${data.duration_ms}ms)`);
      await load();
    } catch (e: any) {
      toast.error(`Run fehlgeschlagen: ${e.message ?? e}`);
    } finally {
      setRunning(null);
    }
  };

  const openDetails = async (run: Run) => {
    setOpenRun(run);
    const { data } = await supabase
      .from('workflow_simulator_steps' as any)
      .select('*')
      .eq('run_id', run.id)
      .order('step_index');
    setOpenSteps((data ?? []) as any);
  };

  const byArea = scenarios.reduce((acc, s) => {
    (acc[s.area] ||= []).push(s);
    return acc;
  }, {} as Record<string, Scenario[]>);

  const lastRunByScenario = runs.reduce((acc, r) => {
    if (!acc[r.scenario_key]) acc[r.scenario_key] = r;
    return acc;
  }, {} as Record<string, Run>);

  return (
    <div className="container mx-auto py-8 space-y-8">
      <Helmet><title>Workflow Simulator — Governance</title></Helmet>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Workflow Simulator</h1>
          <p className="text-muted-foreground mt-1">
            E2E Synthetic Runs · Reality-Driven QA · Live-Calls gegen Lovable Cloud
          </p>
        </div>
        <Button onClick={load} variant="outline" size="sm" disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Scenarios grid grouped by area */}
      <div className="space-y-6">
        {Object.entries(byArea).map(([area, list]) => (
          <div key={area}>
            <h2 className="text-lg font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              {area}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {list.map((s) => {
                const last = lastRunByScenario[s.scenario_key];
                return (
                  <Card key={s.scenario_key}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-base">{s.name}</CardTitle>
                          <p className="text-xs text-muted-foreground mt-1 font-mono">{s.scenario_key}</p>
                        </div>
                        {last && (
                          <Badge variant="outline" className={statusBadge(last.status)}>
                            {last.status}
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-sm text-muted-foreground">{s.description}</p>
                      {last && (
                        <div className="text-xs text-muted-foreground">
                          Letzter Run: {new Date(last.started_at).toLocaleString('de-DE')}
                          {' · '}{last.passed}✓ {last.failed}✗ {last.skipped}⊘ · {last.duration_ms}ms
                        </div>
                      )}
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => triggerRun(s.scenario_key, 'smoke')}
                          disabled={running === s.scenario_key}
                        >
                          {running === s.scenario_key
                            ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            : <Play className="h-4 w-4 mr-2" />}
                          Smoke Run
                        </Button>
                        <Button
                          size="sm" variant="outline"
                          onClick={() => triggerRun(s.scenario_key, 'live')}
                          disabled={running === s.scenario_key}
                        >
                          Live Run
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Runs history */}
      <Card>
        <CardHeader>
          <CardTitle>Letzte Runs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3">Zeit</th>
                  <th className="py-2 pr-3">Szenario</th>
                  <th className="py-2 pr-3">Mode</th>
                  <th className="py-2 pr-3">Trigger</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Ergebnis</th>
                  <th className="py-2 pr-3">Dauer</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b hover:bg-muted/30">
                    <td className="py-2 pr-3 whitespace-nowrap">{new Date(r.started_at).toLocaleString('de-DE')}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{r.scenario_key}</td>
                    <td className="py-2 pr-3"><Badge variant="outline">{r.mode}</Badge></td>
                    <td className="py-2 pr-3">{r.triggered_by}</td>
                    <td className="py-2 pr-3"><Badge variant="outline" className={statusBadge(r.status)}>{r.status}</Badge></td>
                    <td className="py-2 pr-3">{r.passed}✓ {r.failed}✗ {r.skipped}⊘</td>
                    <td className="py-2 pr-3">{r.duration_ms ?? '—'}ms</td>
                    <td className="py-2 pr-3">
                      <Button size="sm" variant="ghost" onClick={() => openDetails(r)}>Details</Button>
                    </td>
                  </tr>
                ))}
                {runs.length === 0 && !loading && (
                  <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">Noch keine Runs.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Drill-down dialog */}
      <Dialog open={!!openRun} onOpenChange={(v) => !v && setOpenRun(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {openRun?.scenario_name ?? openRun?.scenario_key} —{' '}
              <span className="text-sm font-normal text-muted-foreground">
                {openRun && new Date(openRun.started_at).toLocaleString('de-DE')}
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {openSteps.map((s) => (
              <div key={s.step_index} className="flex items-start gap-3 p-3 rounded-md border">
                {stepIcon(s.status)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <code className="text-sm font-medium">{s.name}</code>
                    <span className="text-xs text-muted-foreground">{s.latency_ms}ms</span>
                  </div>
                  {s.error && (
                    <p className="text-xs text-red-600 mt-1 font-mono break-all">{s.error}</p>
                  )}
                  {s.details && Object.keys(s.details).length > 0 && (
                    <pre className="text-xs text-muted-foreground mt-1 overflow-x-auto">
                      {JSON.stringify(s.details, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            ))}
            {openSteps.length === 0 && (
              <p className="text-sm text-muted-foreground">Keine Steps protokolliert.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
