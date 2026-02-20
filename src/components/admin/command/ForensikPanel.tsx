import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, Layers, Link2Off } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

type BatchStuckRow = {
  job_type: string;
  batch_cursor: string | number | null;
  requeues_last_2h: number;
};

type MissingJobRow = {
  package_id: string;
  title: string | null;
  step_key: string;
  step_status: string;
  step_updated_at: string;
};

type ForensikData = {
  unlocked: number;
  stale: number;
  batchStuck: BatchStuckRow[];
  missingJobs: MissingJobRow[];
};

function formatTs(ts: string) {
  try {
    return new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(ts));
  } catch {
    return ts;
  }
}

function Stat({
  icon,
  label,
  value,
  alert,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  alert?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <div className={alert ? 'text-destructive' : 'text-muted-foreground'}>{icon}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
      </div>
      <div className={alert ? 'text-destructive text-2xl font-bold' : 'text-2xl font-bold'}>
        {value}
      </div>
    </div>
  );
}

function useForensikData() {
  return useQuery<ForensikData>({
    queryKey: ['admin', 'forensik-views'],
    queryFn: async () => {
      const sb = supabase as any;

      const [unlockedRes, staleRes, batchRes, missingRes] = await Promise.all([
        sb.from('ops_processing_unlocked').select('processing_unlocked').single(),
        sb.from('ops_processing_stale').select('processing_stale').single(),
        sb
          .from('ops_batch_cursor_stuck')
          .select('job_type,batch_cursor,requeues_last_2h')
          .order('requeues_last_2h', { ascending: false })
          .limit(50),
        sb
          .from('ops_queued_steps_missing_job')
          .select('package_id,title,step_key,step_status,step_updated_at')
          .order('step_updated_at', { ascending: false })
          .limit(50),
      ]);

      for (const r of [unlockedRes, staleRes, batchRes, missingRes]) {
        if (r?.error) throw new Error(r.error.message);
      }

      return {
        unlocked: Number(unlockedRes.data?.processing_unlocked ?? 0),
        stale: Number(staleRes.data?.processing_stale ?? 0),
        batchStuck: (batchRes.data ?? []) as BatchStuckRow[],
        missingJobs: (missingRes.data ?? []) as MissingJobRow[],
      };
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export default function ForensikPanel() {
  const { data, isLoading, error, refetch, isFetching } = useForensikData();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Forensik (Live)</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Lade Monitoring-Views…</CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            Forensik (Live) – Fehler
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm text-destructive">{String((error as Error).message || error)}</div>
          <button
            className="text-sm underline text-muted-foreground hover:text-foreground"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            Erneut laden
          </button>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const hasIssues =
    data.unlocked > 0 ||
    data.stale > 0 ||
    data.batchStuck.length > 0 ||
    data.missingJobs.length > 0;

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3">
        <div className="space-y-0.5">
          <CardTitle className="text-sm flex items-center gap-2">
            Forensik (Live)
            {!hasIssues ? (
              <Badge variant="secondary" className="text-[10px] flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Sauber
              </Badge>
            ) : (
              <Badge variant="destructive" className="text-[10px] flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Aktion nötig
              </Badge>
            )}
          </CardTitle>
          <div className="text-[10px] text-muted-foreground">
            Refresh 30s · {isFetching ? 'aktualisiere…' : 'live'}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Stat
            icon={<Link2Off className="h-4 w-4" />}
            label="Processing unlocked"
            value={data.unlocked}
            alert={data.unlocked > 0}
          />
          <Stat
            icon={<Clock className="h-4 w-4" />}
            label="Processing stale"
            value={data.stale}
            alert={data.stale > 0}
          />
          <Stat
            icon={<Layers className="h-4 w-4" />}
            label="Batch-Cursor stuck"
            value={data.batchStuck.length}
            alert={data.batchStuck.length > 0}
          />
          <Stat
            icon={<AlertTriangle className="h-4 w-4" />}
            label="Queued ohne Job"
            value={data.missingJobs.length}
            alert={data.missingJobs.length > 0}
          />
        </div>

        {data.missingJobs.length > 0 && (
          <div className="space-y-2">
            <Separator />
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Verwaiste Steps</div>
              <div className="text-[10px] text-muted-foreground">
                {data.missingJobs.length} Treffer
              </div>
            </div>
            <div className="divide-y rounded-lg border">
              {data.missingJobs.map((m) => (
                <div key={`${m.package_id}-${m.step_key}`} className="p-3">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div className="font-medium text-sm">
                      {m.title ?? 'Unbenannt'}{' '}
                      <span className="text-[10px] text-muted-foreground">
                        ({m.package_id.slice(0, 8)})
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px]">{m.step_key}</Badge>
                      <Badge variant="secondary" className="text-[10px]">{m.step_status}</Badge>
                    </div>
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    step_updated_at: {formatTs(m.step_updated_at)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {data.batchStuck.length > 0 && (
          <div className="space-y-2">
            <Separator />
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Batch-Loops</div>
              <div className="text-[10px] text-muted-foreground">
                {data.batchStuck.length} Treffer
              </div>
            </div>
            <div className="divide-y rounded-lg border">
              {data.batchStuck.map((b, i) => (
                <div key={`${b.job_type}-${String(b.batch_cursor)}-${i}`} className="p-3">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div className="font-medium text-sm">{b.job_type}</div>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px]">
                        cursor: {b.batch_cursor ?? 'null'}
                      </Badge>
                      <Badge variant="destructive" className="text-[10px]">{b.requeues_last_2h}× / 2h</Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
