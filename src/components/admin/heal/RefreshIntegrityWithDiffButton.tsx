import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { RotateCw, ArrowRight } from 'lucide-react';

interface RefreshResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  enqueued_job_id?: string;
  prev_history_id?: string;
  prev_score?: number;
  prev_reasons?: string[];
}

interface DiffResult {
  ok: boolean;
  has_diff?: boolean;
  prev?: { id: string; reasons: string[]; score: number; passed: boolean; created_at: string };
  curr?: { id: string; reasons: string[]; score: number; passed: boolean; created_at: string };
  reasons_added?: string[];
  reasons_removed?: string[];
  score_delta?: number;
  reason?: string;
}

interface Props { packageId: string; }

export function RefreshIntegrityWithDiffButton({ packageId }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [prevHistoryId, setPrevHistoryId] = useState<string | null>(null);

  const refresh = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('admin_refresh_integrity_check_with_diff', {
        p_package_id: packageId,
      });
      if (error) throw error;
      return data as unknown as RefreshResult;
    },
    onSuccess: (r) => {
      if (r.skipped) {
        toast({ title: 'Übersprungen', description: r.reason, variant: 'destructive' });
        return;
      }
      setPrevHistoryId(r.prev_history_id ?? null);
      toast({
        title: 'Refresh enqueued',
        description: `Job ${r.enqueued_job_id?.slice(0, 8)}… — Diff folgt nach Abschluss.`,
      });
      qc.invalidateQueries({ queryKey: ['package-steps', packageId] });
    },
    onError: (e: Error) => toast({ title: 'Fehler', description: e.message, variant: 'destructive' }),
  });

  const fetchDiff = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('admin_get_integrity_diff', {
        p_package_id: packageId,
        p_prev_history_id: prevHistoryId ?? undefined,
      });
      if (error) throw error;
      return data as unknown as DiffResult;
    },
    onSuccess: (r) => setDiff(r),
    onError: (e: Error) => toast({ title: 'Fehler', description: e.message, variant: 'destructive' }),
  });

  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
          <RotateCw className={`w-3 h-3 mr-1 ${refresh.isPending ? 'animate-spin' : ''}`} />
          Frischer Integrity-Check
        </Button>
        <Button size="sm" variant="ghost" onClick={() => fetchDiff.mutate()} disabled={fetchDiff.isPending}>
          <ArrowRight className="w-3 h-3 mr-1" />
          Diff anzeigen
        </Button>
      </div>

      {diff && diff.ok && (
        <div className="border rounded p-2 text-xs space-y-2 bg-muted/40">
          {!diff.has_diff && (
            <div className="text-muted-foreground">{diff.reason ?? 'Keine vorherige History — kein Diff.'}</div>
          )}
          {diff.has_diff && (
            <>
              <div className="flex gap-2 items-center">
                <Badge variant="secondary">prev score={diff.prev?.score}</Badge>
                <ArrowRight className="w-3 h-3" />
                <Badge variant={diff.curr?.passed ? 'default' : 'destructive'}>
                  curr score={diff.curr?.score}
                </Badge>
                <span className="text-muted-foreground">Δ {diff.score_delta}</span>
              </div>
              {(diff.reasons_added?.length ?? 0) > 0 && (
                <div>
                  <strong className="text-destructive">+ neu:</strong>
                  <ul className="ml-3 list-disc">
                    {diff.reasons_added!.map((r, i) => <li key={i}><code>{r}</code></li>)}
                  </ul>
                </div>
              )}
              {(diff.reasons_removed?.length ?? 0) > 0 && (
                <div>
                  <strong className="text-success">− entfernt:</strong>
                  <ul className="ml-3 list-disc">
                    {diff.reasons_removed!.map((r, i) => <li key={i}><code>{r}</code></li>)}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
