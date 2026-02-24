import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  RefreshCw, Loader2, FlaskConical, CheckCircle2, XCircle,
  AlertTriangle, Play, Clock, Zap
} from 'lucide-react';
import { toast } from 'sonner';

export default function TestDashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [runningSuite, setRunningSuite] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: d, error } = await supabase.functions.invoke('test-orchestrator', {
        body: { action: 'get_dashboard' },
      });
      if (error) throw error;
      if (d?.ok) setData(d);
      else toast.error(d?.error || 'Fehler');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runSuite = async (suite: string) => {
    setRunningSuite(suite);
    const toastId = toast.loading(`${suite.toUpperCase()} Tests laufen…`);
    try {
      const { data: d, error } = await supabase.functions.invoke('run-tests', {
        body: { suite, env: 'staging', trigger_source: 'dashboard' },
      });
      if (error) throw error;
      if (d?.ok) {
        const emoji = d.status === 'passed' ? '✅' : '❌';
        toast.success(`${emoji} ${suite}: ${d.passed}/${d.total} passed (${(d.duration_ms / 1000).toFixed(1)}s)`, { id: toastId });
        load(); // Refresh dashboard
      } else {
        toast.error(d?.error || 'Test-Run fehlgeschlagen', { id: toastId });
      }
    } catch (e: any) {
      toast.error(e.message, { id: toastId });
    } finally {
      setRunningSuite(null);
    }
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;

  const summary = data?.summary || [];
  const recentRuns = data?.recent_runs || [];
  const flakyTests = data?.flaky_tests || [];
  const recentFailures = data?.recent_failures || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <FlaskConical className="h-4 w-4" /> Test Infrastructure – Smoke / Sanity / UAT
        </h3>
        <div className="flex items-center gap-2">
          <Button
            variant="default"
            size="sm"
            className="h-7 text-xs"
            disabled={!!runningSuite}
            onClick={() => runSuite('all')}
          >
            {runningSuite === 'all' ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Zap className="h-3 w-3 mr-1" />}
            Alle Tests
          </Button>
          <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      {/* Suite Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {summary.map((s: any) => (
          <SuiteCard
            key={s.suite}
            suite={s}
            running={runningSuite === s.suite}
            onTrigger={() => runSuite(s.suite)}
          />
        ))}
      </div>

      {/* Flaky Tests */}
      {flakyTests.length > 0 && (
        <Card className="border-yellow-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-yellow-600">
              <AlertTriangle className="h-4 w-4" /> Flaky Tests ({flakyTests.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {flakyTests.map((f: any, i: number) => (
                <div key={i} className="flex items-center justify-between py-1 border-b border-border/20 last:border-0">
                  <span className="text-xs font-mono truncate max-w-[250px]">{f.test_name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">{f.total_runs} runs</span>
                    <Badge variant="outline" className="text-[9px] bg-yellow-500/10 text-yellow-600">
                      {f.fail_rate_pct}% fail
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Failures */}
      {recentFailures.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-destructive">
              <XCircle className="h-4 w-4" /> Recent Failures
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-1.5 px-2">Test</th>
                    <th className="text-left py-1.5 px-2">Suite</th>
                    <th className="text-left py-1.5 px-2">Error</th>
                    <th className="text-right py-1.5 px-2">Wann</th>
                  </tr>
                </thead>
                <tbody>
                  {recentFailures.slice(0, 10).map((f: any) => (
                    <tr key={f.id} className="border-b border-border/20">
                      <td className="py-1.5 px-2 font-mono truncate max-w-[180px]">{f.test_name}</td>
                      <td className="py-1.5 px-2">
                        <Badge variant="outline" className="text-[9px]">{f.test_runs?.suite}</Badge>
                      </td>
                      <td className="py-1.5 px-2 text-destructive truncate max-w-[250px]" title={f.error_message}>
                        {f.error_message || f.error_snippet || '–'}
                      </td>
                      <td className="py-1.5 px-2 text-right text-muted-foreground">
                        {f.created_at ? new Date(f.created_at).toLocaleString('de-DE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '–'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Runs */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4" /> Recent Runs ({recentRuns.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-1.5 px-2">Suite</th>
                  <th className="text-left py-1.5 px-2">Env</th>
                  <th className="text-left py-1.5 px-2">Status</th>
                  <th className="text-left py-1.5 px-2">Trigger</th>
                  <th className="text-right py-1.5 px-2">Tests</th>
                  <th className="text-right py-1.5 px-2">Dauer</th>
                  <th className="text-right py-1.5 px-2">Gestartet</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((r: any) => (
                  <tr key={r.id} className={cn("border-b border-border/20", r.status === 'failed' && 'bg-destructive/5')}>
                    <td className="py-1.5 px-2">
                      <Badge variant="outline" className="text-[9px]">{r.suite}</Badge>
                    </td>
                    <td className="py-1.5 px-2 text-muted-foreground">{r.env}</td>
                    <td className="py-1.5 px-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="py-1.5 px-2">
                      <Badge variant="secondary" className="text-[9px]">{r.trigger_source || '–'}</Badge>
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono">
                      <span className="text-emerald-600">{r.passed_tests}</span>
                      {r.failed_tests > 0 && <> / <span className="text-destructive">{r.failed_tests}</span></>}
                      <span className="text-muted-foreground"> / {r.total_tests}</span>
                    </td>
                    <td className="py-1.5 px-2 text-right text-muted-foreground">
                      {r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : '–'}
                    </td>
                    <td className="py-1.5 px-2 text-right text-muted-foreground">
                      {r.started_at ? new Date(r.started_at).toLocaleString('de-DE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '–'}
                    </td>
                  </tr>
                ))}
                {recentRuns.length === 0 && (
                  <tr><td colSpan={7} className="py-4 text-center text-muted-foreground">Noch keine Test-Runs</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SuiteCard({ suite, running, onTrigger }: { suite: any; running: boolean; onTrigger: () => void }) {
  const icon = suite.last_status === 'passed' ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> :
    suite.last_status === 'failed' ? <XCircle className="h-5 w-5 text-destructive" /> :
    <FlaskConical className="h-5 w-5 text-muted-foreground" />;

  const label = suite.suite.charAt(0).toUpperCase() + suite.suite.slice(1);

  return (
    <Card className={cn(suite.last_status === 'failed' && "border-destructive/30")}>
      <CardContent className="py-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {icon}
            <span className="font-semibold text-sm">{label}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={running}
            onClick={onTrigger}
          >
            {running ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Play className="h-3 w-3 mr-1" />}
            Run
          </Button>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{suite.total_runs} runs</span>
          {suite.pass_rate != null && (
            <span className={cn(suite.pass_rate >= 90 ? 'text-emerald-600' : suite.pass_rate >= 70 ? 'text-yellow-600' : 'text-destructive')}>
              {suite.pass_rate}% pass
            </span>
          )}
        </div>
        {suite.pass_rate != null && <Progress value={suite.pass_rate} className="h-1.5 mt-2" />}
        {suite.last_run && (
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Letzter: {new Date(suite.last_run).toLocaleString('de-DE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string }> = {
    passed: { bg: 'bg-emerald-500/10', text: 'text-emerald-600' },
    failed: { bg: 'bg-destructive/10', text: 'text-destructive' },
    running: { bg: 'bg-blue-500/10', text: 'text-blue-600' },
    error: { bg: 'bg-yellow-500/10', text: 'text-yellow-600' },
  };
  const c = config[status] || config.error;
  return <Badge variant="outline" className={cn("text-[9px]", c.bg, c.text)}>{status}</Badge>;
}
