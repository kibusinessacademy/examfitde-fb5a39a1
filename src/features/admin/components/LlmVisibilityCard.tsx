import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Sparkles, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

interface ScoreRow {
  model: string;
  probes_total: number;
  brand_mentions: number;
  citations: number;
  mention_rate_pct: number | null;
  citation_rate_pct: number | null;
  avg_visibility_score: number | null;
  last_probe_at: string | null;
}

export function LlmVisibilityCard() {
  const [running, setRunning] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['llm-visibility-score'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_llm_visibility_score' as any)
        .select('*');
      if (error) throw error;
      return (data ?? []) as ScoreRow[];
    },
    refetchInterval: 30_000,
  });

  const runProbe = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('llm-visibility-probe', {
        body: {},
      });
      if (error) throw error;
      toast.success(`Probe abgeschlossen: ${data?.probes_created ?? '?'} Probes erzeugt`);
      await refetch();
    } catch (e) {
      toast.error(`Probe fehlgeschlagen: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">LLM-Sichtbarkeit (7 Tage)</CardTitle>
        </div>
        <Button size="sm" variant="outline" onClick={runProbe} disabled={running}>
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          <span className="ml-1">Probe jetzt</span>
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin" /></div>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Noch keine Probes. Klick „Probe jetzt" oder warte auf den wöchentlichen Cron.
          </p>
        ) : (
          <div className="space-y-3">
            {data.map((row) => {
              const v = row.avg_visibility_score ?? 0;
              const tone = v >= 0.6 ? 'default' : v >= 0.3 ? 'secondary' : 'destructive';
              return (
                <div key={row.model} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <code className="text-xs">{row.model}</code>
                    <Badge variant={tone as any}>
                      Score {(v * 100).toFixed(0)}/100
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <div><span className="font-medium text-foreground">{row.mention_rate_pct ?? 0}%</span> Brand-Mention</div>
                    <div><span className="font-medium text-foreground">{row.citation_rate_pct ?? 0}%</span> Citation</div>
                    <div><span className="font-medium text-foreground">{row.probes_total}</span> Probes</div>
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground pt-2">
              Score: 1.0 = Brand + URL-Citation · 0.6 = nur Brand · 0.3 = nur Citation. Baseline VOR Vercel-Migration messen, dann Lift verifizieren.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
