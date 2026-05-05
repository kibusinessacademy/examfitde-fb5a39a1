import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { AlertTriangle, Flame, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ErrorsTab() {
  const [errors, setErrors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from('error_observatory').select('*').limit(30);
      setErrors(data || []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 bg-muted/30 rounded-lg animate-pulse" />)}</div>;

  const clusterColors: Record<string, string> = {
    RATE_LIMIT: 'border-amber-500/40 text-amber-600 dark:text-amber-400',
    TIMEOUT: 'border-orange-500/40 text-orange-600',
    VALIDATION_FAIL: 'border-destructive/40 text-destructive',
    PREREQ_NOT_DONE: 'border-blue-500/40 text-blue-600',
    BUDGET_EXCEEDED: 'border-purple-500/40 text-purple-600',
    DUPLICATE: 'border-muted-foreground/40 text-muted-foreground',
    OTHER: 'border-muted-foreground/40 text-muted-foreground',
  };

  const spikes = errors.filter(e => e.is_spike);
  const totalErrors = errors.reduce((s, e) => s + (e.occurrence_count || 0), 0);
  const last1hTotal = errors.reduce((s, e) => s + (e.last_1h || 0), 0);

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Card><CardContent className="pt-3 pb-2.5 px-3"><p className="text-[10px] text-muted-foreground uppercase">Fehler gesamt</p><p className="text-xl font-bold">{totalErrors}</p></CardContent></Card>
        <Card className={cn(last1hTotal > 5 && "border-destructive/30")}><CardContent className="pt-3 pb-2.5 px-3"><p className="text-[10px] text-muted-foreground uppercase">Letzte 1h</p><p className={cn("text-xl font-bold", last1hTotal > 5 && "text-destructive")}>{last1hTotal}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-2.5 px-3"><p className="text-[10px] text-muted-foreground uppercase">Error Cluster</p><p className="text-xl font-bold">{errors.length}</p></CardContent></Card>
        <Card className={cn(spikes.length > 0 && "border-destructive/40 bg-destructive-bg-subtle")}><CardContent className="pt-3 pb-2.5 px-3"><p className="text-[10px] text-muted-foreground uppercase flex items-center gap-1"><Flame className="h-3 w-3" /> Spikes aktiv</p><p className={cn("text-xl font-bold", spikes.length > 0 && "text-destructive")}>{spikes.length}</p></CardContent></Card>
      </div>

      {/* Spike Alerts */}
      {spikes.length > 0 && (
        <Card className="border-destructive/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-destructive"><Flame className="h-4 w-4" /> Spike Detection</CardTitle>
            <CardDescription>Mehr als 5 gleiche Fehler in 10 Minuten</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {spikes.map((e, i) => (
                <div key={i} className="flex items-center gap-3 text-sm bg-destructive-bg-subtle rounded-md p-2">
                  <Badge variant="outline" className={cn("text-[10px]", clusterColors[e.error_cluster] || '')}>{e.error_cluster}</Badge>
                  <span className="text-xs font-medium">{e.job_type}</span>
                  <span className="text-xs font-mono text-muted-foreground">#{e.error_fingerprint}</span>
                  <span className="text-xs font-bold text-destructive">{e.occurrence_count}×</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Full Error List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" /> Error Observatory</CardTitle>
          <CardDescription>Fehler nach Cluster, Fingerprint und Zeitraum</CardDescription>
        </CardHeader>
        <CardContent>
          {errors.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Keine Fehler 🎉</p>
          ) : (
            <div className="space-y-2">
              {errors.map((e, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 lg:gap-3 text-sm border-b border-border/30 pb-2">
                  <Badge variant="outline" className={cn("text-[10px] w-28 justify-center", clusterColors[e.error_cluster] || '')}>{e.error_cluster}</Badge>
                  <span className="text-muted-foreground text-xs w-32 truncate">{e.job_type}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">#{e.error_fingerprint}</span>
                  <span className="font-mono text-xs font-bold">{e.occurrence_count}×</span>
                  <span className="text-xs text-muted-foreground">1h: {e.last_1h}</span>
                  <span className="text-xs text-muted-foreground">24h: {e.last_24h}</span>
                  {e.first_seen && <span className="text-[10px] text-muted-foreground flex items-center gap-1"><Clock className="h-2.5 w-2.5" />{new Date(e.first_seen).toLocaleDateString('de-DE')}</span>}
                  {e.is_spike && <Badge variant="destructive" className="text-[9px]">SPIKE</Badge>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
