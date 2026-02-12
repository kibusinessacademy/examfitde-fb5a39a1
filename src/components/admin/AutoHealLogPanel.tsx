import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useAutoHealLog } from '@/hooks/useOpsHealth';
import { Activity, CheckCircle2, XCircle, Clock, SkipForward } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';

const STATUS_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  success: { icon: CheckCircle2, color: 'text-emerald-500', label: 'Erfolg' },
  failed: { icon: XCircle, color: 'text-destructive', label: 'Fehler' },
  skipped: { icon: SkipForward, color: 'text-muted-foreground', label: 'Übersprungen' },
  pending: { icon: Clock, color: 'text-primary', label: 'Läuft' },
};

export default function AutoHealLogPanel() {
  const { data: logs, isLoading } = useAutoHealLog();

  if (isLoading) return <Skeleton className="h-48" />;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          Auto-Heal Log ({logs?.length || 0})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {(!logs || logs.length === 0) ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Noch keine Auto-Heal Aktionen durchgeführt.
          </p>
        ) : (
          <ScrollArea className="h-[300px]">
            <div className="space-y-1.5 pr-3">
              {logs.map((log: any) => {
                const cfg = STATUS_CONFIG[log.result_status] || STATUS_CONFIG.pending;
                const Icon = cfg.icon;
                return (
                  <div key={log.id} className={cn(
                    "flex items-center gap-3 py-2 px-3 rounded text-xs",
                    log.result_status === 'failed' ? 'bg-destructive/5' : 'bg-muted/30'
                  )}>
                    <span className="text-muted-foreground shrink-0 w-[70px] font-mono">
                      {new Date(log.created_at).toLocaleTimeString('de-DE', {
                        hour: '2-digit', minute: '2-digit', second: '2-digit',
                      })}
                    </span>
                    <Icon className={cn("h-3.5 w-3.5 shrink-0", cfg.color)} />
                    <span className="font-medium text-foreground">{log.action_type}</span>
                    <span className="text-muted-foreground truncate flex-1">{log.result_detail || ''}</span>
                    <Badge variant="outline" className="text-[9px] shrink-0">
                      {log.trigger_source}
                    </Badge>
                    {log.duration_ms && (
                      <span className="text-muted-foreground shrink-0">{log.duration_ms}ms</span>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
