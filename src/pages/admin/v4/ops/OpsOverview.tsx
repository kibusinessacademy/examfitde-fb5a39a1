import { useEffect, useState, useCallback } from 'react';
import { Loader2, CheckCircle2, XCircle, AlertTriangle, RefreshCw, Shield, Zap, HeartPulse, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import PipelineLockPanel from '@/components/admin/PipelineLockPanel';
import OpsAlertsWidget from './OpsAlertsWidget';
import ContentFactoryStatus from './ContentFactoryStatus';
import BenchmarkMonitor from './BenchmarkMonitor';
import { Loading, MiniKPI } from './OpsShared';

export default function OpsOverview() {
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
      <PipelineLockPanel />
      <OpsAlertsWidget />
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
                  Letzter Scan: {new Date(snapshot.snapshot_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}
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

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MiniKPI label="Budget heute" value={`€${(guardrails.budget?.daily_cost_eur || 0).toFixed(2)}`} sub={`/ €${guardrails.budget?.limit_eur || 15}`} alert={guardrails.budget?.tripped} />
        <MiniKPI label="Stuck Jobs" value={jobQueue.stuck || 0} alert={(jobQueue.stuck || 0) > 0} />
        <MiniKPI label="Failed 24h" value={jobQueue.failed_24h || 0} alert={(jobQueue.failed_24h || 0) >= 5} />
        <MiniKPI label="Auto-Heal" value={guardrails.auto_heal_allowed ? '✅' : '🚫'} sub={guardrails.structural_gate?.blocked ? 'Gate blockiert' : ''} />
        <MiniKPI label="Autofix aktiv" value={autofixSummary.active || 0} sub={`${autofixSummary.frozen || 0} frozen`} />
      </div>

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

      <BenchmarkMonitor />

      <ContentFactoryStatus />

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
