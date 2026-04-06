import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { runAdminOpsAction } from '@/integrations/supabase/admin-ops-actions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Loader2, Unlock, RotateCcw, Zap, RefreshCw,
  Wrench, Play, Trash2, ShieldOff
} from 'lucide-react';

export default function BatchActionsCard() {
  const qc = useQueryClient();

  const { data: adminHoldCount = 0 } = useQuery({
    queryKey: ['admin', 'admin-hold-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('course_packages')
        .select('id', { head: true, count: 'exact' })
        .eq('status', 'blocked')
        .ilike('blocked_reason', '%admin_hold%');
      if (error) return 0;
      return count ?? 0;
    },
    refetchInterval: 30_000,
  });

  const { data: cooldownCount = 0 } = useQuery({
    queryKey: ['admin', 'cooldown-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('llm_provider_cooldowns')
        .select('id', { head: true, count: 'exact' })
        .gt('until_at', new Date().toISOString());
      if (error) return 0;
      return count ?? 0;
    },
    refetchInterval: 30_000,
  });

  const { data: failedCount = 0 } = useQuery({
    queryKey: ['admin', 'failed-job-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('job_queue')
        .select('id', { head: true, count: 'exact' })
        .eq('status', 'failed');
      if (error) return 0;
      return count ?? 0;
    },
    refetchInterval: 15_000,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['admin'] });
  };

  const unblockAll = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('course_packages')
        .select('id')
        .eq('status', 'blocked')
        .ilike('blocked_reason', '%admin_hold%')
        .limit(500);
      if (error) throw error;
      const ids = (data || []).map((r: any) => r.id);
      let healed = 0;
      for (const id of ids) {
        try {
          await runAdminOpsAction('unblock_package', { package_id: id, reason: 'Batch Admin-Hold Aufhebung' });
          healed++;
        } catch { /* continue */ }
      }
      return { healed, total: ids.length };
    },
    onSuccess: (res) => {
      toast.success(`${res.healed}/${res.total} Admin-Holds aufgehoben`);
      invalidateAll();
    },
    onError: (e) => toast.error(`Fehler: ${e.message}`),
  });

  const requeueFailed = useMutation({
    mutationFn: () => runAdminOpsAction('requeue_failed_jobs', { limit: 50 }),
    onSuccess: (res: any) => {
      toast.success(`${res?.updated ?? 0} Jobs requeued`);
      invalidateAll();
    },
    onError: (e) => toast.error(`Fehler: ${e.message}`),
  });

  const releaseCooldowns = useMutation({
    mutationFn: () => runAdminOpsAction('release_provider_cooldowns'),
    onSuccess: (res: any) => {
      toast.success(`${res?.updated ?? 0} Cooldowns freigegeben`);
      invalidateAll();
    },
    onError: (e) => toast.error(`Fehler: ${e.message}`),
  });

  const resetStuck = useMutation({
    mutationFn: () => runAdminOpsAction('reset_stalled_steps', { limit: 20 }),
    onSuccess: (res: any) => {
      toast.success(`${res?.updated ?? 0} Steps zurückgesetzt`);
      invalidateAll();
    },
    onError: (e) => toast.error(`Fehler: ${e.message}`),
  });

  const killZombies = useMutation({
    mutationFn: () => runAdminOpsAction('kill_stale_processing_jobs', { limit: 50 }),
    onSuccess: (res: any) => {
      toast.success(`${res?.updated ?? 0} Zombie-Jobs beendet`);
      invalidateAll();
    },
    onError: (e) => toast.error(`Fehler: ${e.message}`),
  });

  const anyBusy = unblockAll.isPending || requeueFailed.isPending || releaseCooldowns.isPending || resetStuck.isPending || killZombies.isPending;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Zap className="h-4 w-4 text-primary" />
          Schnellaktionen
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {adminHoldCount > 0 && (
          <Button
            variant="outline"
            className="justify-between h-auto py-2.5 px-3"
            onClick={() => {
              if (confirm(`Alle ${adminHoldCount} Admin-Holds aufheben?`)) unblockAll.mutate();
            }}
            disabled={anyBusy}
          >
            <div className="flex items-center gap-2 text-left">
              <Unlock className="h-4 w-4 text-warning shrink-0" />
              <div>
                <div className="text-sm font-medium">Admin-Hold aufheben</div>
                <div className="text-[10px] text-muted-foreground">{adminHoldCount} Pakete freigeben</div>
              </div>
            </div>
            {unblockAll.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Badge variant="outline" className="text-xs">{adminHoldCount}</Badge>}
          </Button>
        )}

        {failedCount > 0 && (
          <Button
            variant="outline"
            className="justify-between h-auto py-2.5 px-3"
            onClick={() => requeueFailed.mutate()}
            disabled={anyBusy}
          >
            <div className="flex items-center gap-2 text-left">
              <RotateCcw className="h-4 w-4 text-destructive shrink-0" />
              <div>
                <div className="text-sm font-medium">Failed requeuen</div>
                <div className="text-[10px] text-muted-foreground">Max 50 Jobs</div>
              </div>
            </div>
            {requeueFailed.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Badge variant="outline" className="text-xs">{failedCount}</Badge>}
          </Button>
        )}

        {cooldownCount > 0 && (
          <Button
            variant="outline"
            className="justify-between h-auto py-2.5 px-3"
            onClick={() => releaseCooldowns.mutate()}
            disabled={anyBusy}
          >
            <div className="flex items-center gap-2 text-left">
              <ShieldOff className="h-4 w-4 text-warning shrink-0" />
              <div>
                <div className="text-sm font-medium">Cooldowns freigeben</div>
                <div className="text-[10px] text-muted-foreground">Provider-Limits aufheben</div>
              </div>
            </div>
            {releaseCooldowns.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Badge variant="outline" className="text-xs">{cooldownCount}</Badge>}
          </Button>
        )}

        <Button
          variant="outline"
          className="justify-between h-auto py-2.5 px-3"
          onClick={() => resetStuck.mutate()}
          disabled={anyBusy}
        >
          <div className="flex items-center gap-2 text-left">
            <Wrench className="h-4 w-4 text-muted-foreground shrink-0" />
            <div>
              <div className="text-sm font-medium">Stuck Steps reset</div>
              <div className="text-[10px] text-muted-foreground">Hängende Pipeline-Steps</div>
            </div>
          </div>
          {resetStuck.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        </Button>

        <Button
          variant="outline"
          className="justify-between h-auto py-2.5 px-3"
          onClick={() => killZombies.mutate()}
          disabled={anyBusy}
        >
          <div className="flex items-center gap-2 text-left">
            <Trash2 className="h-4 w-4 text-destructive shrink-0" />
            <div>
              <div className="text-sm font-medium">Zombie-Jobs killen</div>
              <div className="text-[10px] text-muted-foreground">Stale Processing beenden</div>
            </div>
          </div>
          {killZombies.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        </Button>

        <Button
          variant="outline"
          className="justify-between h-auto py-2.5 px-3"
          onClick={() => {
            qc.invalidateQueries({ queryKey: ['admin'] });
            toast.info('Daten werden neu geladen…');
          }}
        >
          <div className="flex items-center gap-2 text-left">
            <RefreshCw className="h-4 w-4 text-primary shrink-0" />
            <div>
              <div className="text-sm font-medium">Alles neu laden</div>
              <div className="text-[10px] text-muted-foreground">SSOT-Refresh</div>
            </div>
          </div>
        </Button>
      </CardContent>
    </Card>
  );
}
