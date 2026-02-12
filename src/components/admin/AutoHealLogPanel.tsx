import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useAutoHealLog, useHealEffectiveness } from '@/hooks/useOpsHealth';
import { Activity, CheckCircle2, XCircle, Clock, SkipForward, TrendingUp, TrendingDown, Minus, BarChart3 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';

const STATUS_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  success: { icon: CheckCircle2, color: 'text-emerald-500', label: 'Erfolg' },
  failed: { icon: XCircle, color: 'text-destructive', label: 'Fehler' },
  skipped: { icon: SkipForward, color: 'text-muted-foreground', label: 'Übersprungen' },
  pending: { icon: Clock, color: 'text-primary', label: 'Läuft' },
  awaiting_approval: { icon: Clock, color: 'text-yellow-500', label: 'Freigabe' },
  incident_mode_on: { icon: XCircle, color: 'text-destructive', label: 'Incident ON' },
  incident_mode_off: { icon: CheckCircle2, color: 'text-emerald-500', label: 'Incident OFF' },
};

export default function AutoHealLogPanel() {
  const { data: logs, isLoading: logsLoading } = useAutoHealLog();
  const { data: effectiveness, isLoading: effLoading } = useHealEffectiveness();

  if (logsLoading) return <Skeleton className="h-48" />;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          Auto-Heal Log & Effectiveness
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="log" className="w-full">
          <TabsList className="h-8 mb-3">
            <TabsTrigger value="log" className="text-xs h-6">Log ({logs?.length || 0})</TabsTrigger>
            <TabsTrigger value="effectiveness" className="text-xs h-6">
              <BarChart3 className="h-3 w-3 mr-1" /> Effectiveness
            </TabsTrigger>
          </TabsList>

          <TabsContent value="log">
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
                    const hasFollowup = log.followup_verdict;
                    return (
                      <div key={log.id} className={cn(
                        "flex items-center gap-3 py-2 px-3 rounded text-xs",
                        log.result_status === 'failed' ? 'bg-destructive/5' :
                        log.result_status === 'awaiting_approval' ? 'bg-yellow-500/5' :
                        'bg-muted/30'
                      )}>
                        <span className="text-muted-foreground shrink-0 w-[70px] font-mono">
                          {new Date(log.created_at).toLocaleTimeString('de-DE', {
                            hour: '2-digit', minute: '2-digit', second: '2-digit',
                          })}
                        </span>
                        <Icon className={cn("h-3.5 w-3.5 shrink-0", cfg.color)} />
                        <span className="font-medium text-foreground">{log.action_type.replace(/_/g, ' ')}</span>
                        <span className="text-muted-foreground truncate flex-1">{log.result_detail || ''}</span>
                        {hasFollowup && (
                          <Badge variant="outline" className={cn("text-[9px] gap-0.5",
                            log.followup_verdict === 'improved' ? 'text-emerald-600' :
                            log.followup_verdict === 'regressed' ? 'text-destructive' :
                            'text-muted-foreground'
                          )}>
                            {log.followup_verdict === 'improved' ? <TrendingUp className="h-2.5 w-2.5" /> :
                             log.followup_verdict === 'regressed' ? <TrendingDown className="h-2.5 w-2.5" /> :
                             <Minus className="h-2.5 w-2.5" />}
                            {log.followup_score_before != null && log.followup_score_after != null
                              ? `${log.followup_score_before}→${log.followup_score_after}`
                              : log.followup_verdict}
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[9px] shrink-0">
                          {log.trigger_source}
                        </Badge>
                        {log.duration_ms != null && (
                          <span className="text-muted-foreground shrink-0">{log.duration_ms}ms</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="effectiveness">
            {effLoading ? <Skeleton className="h-40" /> : (
              (!effectiveness || effectiveness.length === 0) ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Noch keine Daten für Effectiveness-Analyse.
                </p>
              ) : (
                <div className="space-y-3">
                  {effectiveness.map((eff: any) => (
                    <div key={eff.action_type} className="p-3 rounded-lg bg-muted/30 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">{eff.action_type.replace(/_/g, ' ')}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant={eff.success_rate >= 80 ? 'default' : eff.success_rate >= 50 ? 'secondary' : 'destructive'} className="text-[9px]">
                            {eff.success_rate}% Erfolg
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">{eff.total_runs} Runs</span>
                        </div>
                      </div>
                      <Progress value={eff.success_rate} className="h-1.5" />
                      <div className="flex gap-3 text-[10px] text-muted-foreground">
                        <span>✅ {eff.successes}</span>
                        <span>❌ {eff.failures}</span>
                        <span>⏭ {eff.skipped}</span>
                        <span>⌀ {eff.avg_duration_ms}ms</span>
                        {eff.followup_improved > 0 && (
                          <span className="text-emerald-600">📈 {eff.followup_improved} improved</span>
                        )}
                        {eff.avg_score_delta != null && eff.avg_score_delta !== 0 && (
                          <span className={eff.avg_score_delta > 0 ? 'text-emerald-600' : 'text-destructive'}>
                            Δ {eff.avg_score_delta > 0 ? '+' : ''}{eff.avg_score_delta}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
