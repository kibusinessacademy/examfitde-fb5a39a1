import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, HeartPulse, AlertTriangle, Copy, Activity } from 'lucide-react';

interface TrackWip {
  queued: number;
  building: number;
}

interface HealthData {
  stalled_content: number;
  duplicate_pending_jobs: number;
  integrity_null_errors: number;
  wip_queued: number;
  wip_building: number;
  track_wip?: Record<string, TrackWip>;
  qc_approved_but_draft: number;
  qc_approved_but_draft_oldest?: string | null;
  timestamp: string;
}

function severity(value: number, warn: number, crit: number): 'ok' | 'warn' | 'crit' {
  if (value >= crit) return 'crit';
  if (value >= warn) return 'warn';
  return 'ok';
}

const sevColors = {
  ok: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  warn: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
  crit: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30',
};

const sevDot = { ok: 'bg-emerald-500', warn: 'bg-amber-500', crit: 'bg-red-500' };

const TRACK_QUOTAS: Record<string, number> = {
  AUSBILDUNG_VOLL: 3,
  EXAM_FIRST: 8,
};

export default function PipelineHealthPanel() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: resp, error: fnErr } = await supabase.functions.invoke('admin-ops', {
        body: { action: 'pipeline_health' },
      });
      if (fnErr) throw fnErr;
      setData(resp as HealthData);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, [load]);

  if (error) {
    return (
      <Card className="border-destructive/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><HeartPulse className="h-4 w-4" /> Pipeline Health</CardTitle>
        </CardHeader>
        <CardContent><p className="text-xs text-destructive">{error}</p></CardContent>
      </Card>
    );
  }

  const kpis = data ? [
    {
      label: 'Stalled Content',
      value: data.stalled_content,
      sev: severity(data.stalled_content, 1, 5),
      desc: 'Learning content steps stuck >10min without backoff',
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
    },
    {
      label: 'Duplicate Jobs',
      value: data.duplicate_pending_jobs,
      sev: severity(data.duplicate_pending_jobs, 1, 3),
      desc: 'Same package+type pending/processing (6h)',
      icon: <Copy className="h-3.5 w-3.5" />,
    },
    {
      label: 'Integrity ∅ Error',
      value: data.integrity_null_errors,
      sev: severity(data.integrity_null_errors, 1, 1),
      desc: 'Failed integrity checks without last_error (24h)',
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
    },
    {
      label: 'WIP Pressure',
      value: `${data.wip_building} / ${data.wip_queued + data.wip_building}`,
      sev: data.wip_queued > 50 && data.wip_building < 3 ? 'warn' : 'ok',
      desc: `Building vs total active (${data.wip_queued} queued)`,
      icon: <Activity className="h-3.5 w-3.5" />,
    },
    {
      label: 'QC Promotion Bug',
      value: data.qc_approved_but_draft,
      sev: severity(data.qc_approved_but_draft, 1, 1),
      desc: data.qc_approved_but_draft > 0
        ? `qc_status=approved aber status=draft (oldest: ${data.qc_approved_but_draft_oldest ? new Date(data.qc_approved_but_draft_oldest).toLocaleDateString('de-DE') : 'n/a'})`
        : 'OK: keine inkonsistenten QC-Approvals',
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
    },
  ] : [];

  // Track-level WIP cards
  const trackCards = data?.track_wip ? Object.entries(data.track_wip).map(([track, wip]) => {
    const quota = TRACK_QUOTAS[track] ?? 5;
    const starved = wip.queued > 0 && wip.building === 0;
    const atCap = wip.building >= quota;
    const sev = starved ? 'crit' as const : atCap ? 'warn' as const : 'ok' as const;
    const shortTrack = track === 'AUSBILDUNG_VOLL' ? 'Elite' : track === 'EXAM_FIRST' ? 'Exam-First' : track;
    return {
      label: `${shortTrack} WIP`,
      value: `${wip.building}/${quota}`,
      sev,
      desc: starved
        ? `⚠️ STARVATION: ${wip.queued} queued, 0 building`
        : `${wip.queued} queued, ${wip.building} building`,
      icon: <Activity className="h-3.5 w-3.5" />,
    };
  }) : [];

  const allKpis = [...kpis, ...trackCards];

  const overallSev = allKpis.length > 0
    ? allKpis.some(k => k.sev === 'crit') ? 'crit' : allKpis.some(k => k.sev === 'warn') ? 'warn' : 'ok'
    : 'ok';

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`h-2.5 w-2.5 rounded-full ${sevDot[overallSev]} animate-pulse`} />
          <CardTitle className="text-sm">Pipeline Health</CardTitle>
          {data && (
            <span className="text-[10px] text-muted-foreground">
              {new Date(data.timestamp).toLocaleTimeString('de-DE')}
            </span>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>
      <CardContent>
        {loading && !data ? (
          <div className="flex justify-center py-4"><RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {allKpis.map(kpi => (
              <div key={kpi.label} className={`rounded-lg border p-3 ${sevColors[kpi.sev]}`}>
                <div className="flex items-center gap-1.5 mb-1">
                  {kpi.icon}
                  <span className="text-xs font-medium">{kpi.label}</span>
                </div>
                <div className="text-2xl font-bold tabular-nums">{kpi.value}</div>
                <p className="text-[10px] opacity-70 mt-1">{kpi.desc}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
