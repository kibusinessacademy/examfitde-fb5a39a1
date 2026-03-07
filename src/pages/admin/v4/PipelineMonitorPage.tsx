import RealtimePipelineMonitor from '@/components/admin/RealtimePipelineMonitor';
import RealtimeAlerts from '@/components/admin/RealtimeAlerts';
import PipelineTimeline from '@/components/admin/PipelineTimeline';
import { useAdminKPIs } from '@/hooks/useAdminRealtime';
import { usePipelineOverview } from '@/hooks/usePipelineTimeline';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Activity, Zap, RefreshCw, Radio, Play,
  AlertTriangle, CheckCircle2, XCircle, Timer, Eye, Shield
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

export default function PipelineMonitorPage() {
  const { kpis, refetch } = useAdminKPIs();
  const { statuses, loading: statusLoading, refetch: refetchStatuses } = usePipelineOverview();
  const [recentPkgs, setRecentPkgs] = useState<any[]>([]);
  const [selectedPkgId, setSelectedPkgId] = useState<string | null>(null);

  const fetchRecent = useCallback(async () => {
    const { data } = await (supabase as any)
      .from('course_packages')
      .select('id,title,status,build_progress,updated_at')
      .neq('status', 'archived')
      .order('updated_at', { ascending: false })
      .limit(10);
    setRecentPkgs(data || []);
  }, []);

  useEffect(() => {
    fetchRecent();
    const ch = supabase
      .channel('pipeline-page-pkgs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'course_packages' }, () => fetchRecent())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchRecent]);

  const triggerRunner = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pipeline-runner`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      });
      toast.success('Runner angestoßen');
      refetch();
    } catch { toast.error('Runner Trigger fehlgeschlagen'); }
  };

  const triggerHardening = async (pkgId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elite-hardening`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ package_id: pkgId, scope: 'all' }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(`Elite-Hardening gestartet (Run: ${data.run_id?.slice(0, 8)})`);
      } else {
        toast.error(`Hardening Fehler: ${data.error}`);
      }
    } catch { toast.error('Hardening-Trigger fehlgeschlagen'); }
  };
  const triggerWatchdog = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pipeline-watchdog`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      });
      toast.success('Watchdog ausgeführt');
      refetch();
    } catch { toast.error('Watchdog fehlgeschlagen'); }
  };

  const statusColor = (s: string) => {
    switch (s) {
      case 'done': case 'published': return 'text-emerald-500';
      case 'building': return 'text-primary';
      case 'failed': return 'text-destructive';
      case 'blocked': return 'text-orange-500';
      default: return 'text-muted-foreground';
    }
  };

  const statusIcon = (s: string) => {
    switch (s) {
      case 'done': case 'published': return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
      case 'building': return <Activity className="h-3.5 w-3.5 text-primary animate-pulse" />;
      case 'failed': return <XCircle className="h-3.5 w-3.5 text-destructive" />;
      case 'blocked': return <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />;
      default: return <Timer className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  // Find stuck packages from pipeline status view
  const stuckPackages = statuses.filter(s => s.is_stuck);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Radio className="h-5 w-5 text-primary" /> Pipeline Live
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Realtime-Überwachung · {kpis.queued_packages} queued · {kpis.building_packages} building · {kpis.done_packages} done
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={triggerRunner}>
            <Play className="h-3 w-3 mr-1" /> Runner
          </Button>
          <Button variant="outline" size="sm" onClick={triggerWatchdog}>
            <Zap className="h-3 w-3 mr-1" /> Watchdog
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { refetch(); fetchRecent(); refetchStatuses(); }}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Stuck Warning */}
      {stuckPackages.length > 0 && (
        <Card className="border-orange-500/50 bg-orange-500/5">
          <CardContent className="py-3">
            <div className="flex items-center gap-2 text-sm font-medium text-orange-600 dark:text-orange-400">
              <AlertTriangle className="h-4 w-4" />
              {stuckPackages.length} Paket(e) vermutlich hängend (&gt;2h ohne Event)
            </div>
            <div className="mt-2 space-y-1">
              {stuckPackages.map(s => (
                <div key={s.package_id} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium">{s.package_title || s.package_id.slice(0, 8)}</span>
                  <span>– Step: {s.current_step}</span>
                  <span>– letzte Aktivität vor {Math.round(s.seconds_since_last_event / 60)} Min.</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px]"
                    onClick={() => setSelectedPkgId(s.package_id)}
                  >
                    <Eye className="h-3 w-3 mr-1" /> Timeline
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Alerts */}
      <RealtimeAlerts />

      {/* Active Pipeline */}
      <RealtimePipelineMonitor />

      {/* Pipeline Timeline (if selected) */}
      {selectedPkgId && (
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-2 right-2 z-10"
            onClick={() => setSelectedPkgId(null)}
          >
            ✕
          </Button>
          <PipelineTimeline packageId={selectedPkgId} />
        </div>
      )}

      {/* Recent Packages */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Letzte Pakete
        </h2>
        {recentPkgs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Pakete vorhanden.</p>
        ) : (
          <div className="space-y-1">
            {recentPkgs.map(p => (
              <div
                key={p.id}
                className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/30 text-sm cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setSelectedPkgId(p.id)}
              >
                {statusIcon(p.status)}
                <span className="flex-1 truncate font-medium">{p.title || p.id.slice(0, 8)}</span>
                <Badge variant="outline" className={cn("text-[10px]", statusColor(p.status))}>{p.status}</Badge>
                <span className="text-[10px] text-muted-foreground">{p.build_progress ?? 0}%</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] px-1.5"
                  onClick={(e) => { e.stopPropagation(); triggerHardening(p.id); }}
                  title="Elite-Hardening starten"
                >
                  <Shield className="h-3 w-3 mr-0.5" /> Harden
                </Button>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(p.updated_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
