import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Lock, Unlock, RefreshCw, Play, AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { de } from 'date-fns/locale';

interface PipelineLock {
  id: number;
  active_package_id: string | null;
  locked_at: string | null;
  locked_by: string | null;
  heartbeat_at: string | null;
  mode: string;
  max_active: number;
  updated_at: string;
}

interface QueuedPackage {
  id: string;
  course_id: string;
  status: string;
  queue_position: number | null;
  created_at: string;
  courses: { title: string } | null;
}

export default function PipelineLockPanel() {
  const qc = useQueryClient();

  const { data: lock, isLoading: lockLoading } = useQuery({
    queryKey: ['pipeline-lock'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_lock')
        .select('*')
        .eq('id', 1)
        .single();
      if (error) throw error;
      return data as PipelineLock;
    },
    refetchInterval: 10_000,
  });

  const { data: activePkg } = useQuery({
    queryKey: ['pipeline-active-pkg', lock?.active_package_id],
    queryFn: async () => {
      if (!lock?.active_package_id) return null;
      const { data } = await supabase
        .from('course_packages')
        .select('id, status, build_progress, course_id, courses(title)')
        .eq('id', lock.active_package_id)
        .single();
      return data;
    },
    enabled: !!lock?.active_package_id,
  });

  const { data: activeSteps } = useQuery({
    queryKey: ['pipeline-active-steps', lock?.active_package_id],
    queryFn: async () => {
      if (!lock?.active_package_id) return [];
      const { data } = await supabase
        .from('course_package_build_steps')
        .select('step_key, status, started_at, finished_at')
        .eq('package_id', lock.active_package_id)
        .order('created_at', { ascending: true });
      return data || [];
    },
    enabled: !!lock?.active_package_id,
    refetchInterval: 10_000,
  });

  const { data: queue } = useQuery({
    queryKey: ['pipeline-queue'],
    queryFn: async () => {
      const { data } = await supabase
        .from('course_packages')
        .select('id, course_id, status, queue_position, created_at, courses(title)')
        .eq('status', 'queued')
        .order('queue_position', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .limit(20);
      return (data || []) as QueuedPackage[];
    },
    refetchInterval: 15_000,
  });

  const forceRelease = useMutation({
    mutationFn: async () => {
      if (!lock?.active_package_id) return;
      await supabase.rpc('release_pipeline_lock', { p_package_id: lock.active_package_id });
      await supabase
        .from('course_packages')
        .update({ status: 'failed' })
        .eq('id', lock.active_package_id);
    },
    onSuccess: () => {
      toast.success('Pipeline Lock freigegeben');
      qc.invalidateQueries({ queryKey: ['pipeline-lock'] });
    },
  });

  const triggerNext = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('package-queue-next', { method: 'POST' });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (data?.skipped) {
        toast.info(data.reason === 'pipeline_busy' ? 'Pipeline ist belegt' : 'Keine Pakete in Queue');
      } else {
        toast.success(`Paket ${data?.started_package_id?.slice(0, 8)} gestartet`);
      }
      qc.invalidateQueries({ queryKey: ['pipeline-lock'] });
      qc.invalidateQueries({ queryKey: ['pipeline-queue'] });
    },
    onError: (e) => toast.error(`Fehler: ${e.message}`),
  });

  const isLocked = !!lock?.active_package_id;
  const isStale = lock?.heartbeat_at && new Date(lock.heartbeat_at) < new Date(Date.now() - 10 * 60 * 1000);

  const stepStatusIcon = (status: string) => {
    if (status === 'done') return <CheckCircle2 className="h-3 w-3 text-green-500" />;
    if (status === 'running') return <RefreshCw className="h-3 w-3 text-primary animate-spin" />;
    if (status === 'failed') return <AlertTriangle className="h-3 w-3 text-destructive" />;
    return <Clock className="h-3 w-3 text-muted-foreground" />;
  };

  if (lockLoading) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {isLocked ? <Lock className="h-4 w-4 text-warning" /> : <Unlock className="h-4 w-4 text-green-500" />}
          Pipeline Lock
          <Badge variant={isLocked ? 'destructive' : 'outline'} className="ml-auto text-[10px]">
            {isLocked ? 'LOCKED' : 'FREE'}
          </Badge>
          {isStale && <Badge variant="destructive" className="text-[10px]">STALE</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Active Package */}
        {isLocked && activePkg && (
          <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">{(activePkg as any).courses?.title || activePkg.id.slice(0, 8)}</span>
              <Badge variant="outline" className="text-[10px]">
                {(activePkg as any).status} – {(activePkg as any).build_progress}%
              </Badge>
            </div>
            {lock?.locked_at && (
              <p className="text-xs text-muted-foreground">
                Gelockt {formatDistanceToNow(new Date(lock.locked_at), { locale: de, addSuffix: true })}
                {lock.locked_by && ` von ${lock.locked_by}`}
              </p>
            )}
            {lock?.heartbeat_at && (
              <p className="text-xs text-muted-foreground">
                Heartbeat: {formatDistanceToNow(new Date(lock.heartbeat_at), { locale: de, addSuffix: true })}
              </p>
            )}

            {/* Build Steps */}
            {activeSteps && activeSteps.length > 0 && (
              <div className="space-y-1 pt-1">
                {activeSteps.map((step: any) => (
                  <div key={step.step_key} className="flex items-center gap-2 text-xs">
                    {stepStatusIcon(step.status)}
                    <span className={step.status === 'running' ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                      {step.step_key}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => triggerNext.mutate()}
            disabled={triggerNext.isPending || isLocked}
          >
            <Play className="h-3 w-3 mr-1" />
            Next starten
          </Button>
          {isLocked && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => forceRelease.mutate()}
              disabled={forceRelease.isPending}
            >
              <Unlock className="h-3 w-3 mr-1" />
              Force Release
            </Button>
          )}
        </div>

        {/* Queue */}
        {queue && queue.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Queue ({queue.length})</p>
            {queue.slice(0, 8).map((pkg, i) => (
              <div key={pkg.id} className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground w-4">{i + 1}.</span>
                <span className="truncate">{pkg.courses?.title || pkg.id.slice(0, 8)}</span>
                {pkg.queue_position && (
                  <span className="text-muted-foreground ml-auto">pos {pkg.queue_position}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {!isLocked && (!queue || queue.length === 0) && (
          <p className="text-xs text-muted-foreground text-center py-2">
            Pipeline frei. Keine Pakete in der Queue.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
