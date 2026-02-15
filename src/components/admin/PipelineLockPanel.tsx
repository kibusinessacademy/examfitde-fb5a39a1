import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Lock, Unlock, RefreshCw, Play, AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { de } from 'date-fns/locale';

interface PackageLease {
  package_id: string;
  runner_id: string;
  acquired_at: string;
  lease_until: string;
  renewed_at: string;
}

interface QueuedPackage {
  id: string;
  course_id: string;
  status: string;
  queue_position: number | null;
  created_at: string;
  courses: { title: string } | null;
  build_progress: number;
}

export default function PipelineLockPanel() {
  const qc = useQueryClient();

  const { data: activeLeases, isLoading: lockLoading } = useQuery({
    queryKey: ['pipeline-active-leases'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('package_leases')
        .select('*')
        .gt('lease_until', new Date().toISOString());
      if (error) throw error;
      return data as PackageLease[];
    },
    refetchInterval: 5000,
  });

  const { data: activePkgs } = useQuery({
    queryKey: ['pipeline-active-pkgs', activeLeases?.map(l => l.package_id).join(',')],
    queryFn: async () => {
      if (!activeLeases || activeLeases.length === 0) return [];
      const { data } = await supabase
        .from('course_packages')
        .select('id, status, build_progress, course_id, courses(title)')
        .in('id', activeLeases.map(l => l.package_id));
      return data;
    },
    enabled: !!activeLeases && activeLeases.length > 0,
  });

  const { data: queue } = useQuery({
    queryKey: ['pipeline-queue'],
    queryFn: async () => {
      const { data } = await supabase
        .from('course_packages')
        .select('id, course_id, status, queue_position, created_at, courses(title), build_progress')
        .eq('status', 'queued')
        .order('queue_position', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .limit(20);
      return (data || []) as QueuedPackage[];
    },
    refetchInterval: 10000,
  });

  const forceExpireLeases = useMutation({
    mutationFn: async () => {
      await supabase.rpc('expire_stale_leases');
    },
    onSuccess: () => {
      toast.success('Stale Leases bereinigt');
      qc.invalidateQueries({ queryKey: ['pipeline-active-leases'] });
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
      qc.invalidateQueries({ queryKey: ['pipeline-active-leases'] });
      qc.invalidateQueries({ queryKey: ['pipeline-queue'] });
    },
    onError: (e) => toast.error(`Fehler: ${e.message}`),
  });

  const activeCount = activeLeases?.length || 0;
  const maxSlots = 5;

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
          {activeCount > 0 ? <RefreshCw className="h-4 w-4 text-primary animate-spin" /> : <Unlock className="h-4 w-4 text-muted-foreground" />}
          Pipeline Runner (SSOT)
          <Badge variant={activeCount >= maxSlots ? 'destructive' : 'outline'} className="ml-auto text-[10px]">
            {activeCount}/{maxSlots} SLOTS
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Active Packages Grid */}
        {activePkgs && activePkgs.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Aktive Verarbeitung ({activePkgs.length})</p>
            {activePkgs.map((pkg) => {
              const lease = activeLeases?.find(l => l.package_id === pkg.id);
              const isStale = lease && new Date(lease.renewed_at) < new Date(Date.now() - 5 * 60 * 1000);
              
              return (
                <div key={pkg.id} className="rounded-lg border bg-card p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium truncate max-w-[180px]">{(pkg as any).courses?.title || pkg.id.slice(0, 8)}</span>
                    <Badge variant={isStale ? "destructive" : "secondary"} className="text-[10px] h-5">
                      {isStale ? "STALE" : "RUNNING"}
                    </Badge>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Progress: {(pkg as any).build_progress}%</span>
                    <span>Worker: {lease?.runner_id?.slice(0,6)}</span>
                  </div>
                  {lease && (
                    <div className="text-[10px] text-muted-foreground/70">
                      Heartbeat: {formatDistanceToNow(new Date(lease.renewed_at), { locale: de, addSuffix: true })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            Alle Slots frei.
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => triggerNext.mutate()}
            disabled={triggerNext.isPending || activeCount >= maxSlots}
          >
            <Play className="h-3 w-3 mr-1" />
            Next (Force)
          </Button>
          
          <Button
            size="sm"
            variant="ghost"
            onClick={() => forceExpireLeases.mutate()}
            disabled={forceExpireLeases.isPending}
            title="Bereinigt steckengebliebene Worker-Leases (>5min ohne Heartbeat)"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Cleanup Leases
          </Button>
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

        {activeCount === 0 && (!queue || queue.length === 0) && (
          <p className="text-xs text-muted-foreground text-center py-2">
            System Idle.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
