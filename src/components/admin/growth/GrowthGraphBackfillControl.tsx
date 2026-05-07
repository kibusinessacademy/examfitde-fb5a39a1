import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Database, Play, ShieldCheck, AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';

type PerSourceRow = {
  source: string;
  candidates_total: number;
  invalid_count: number;
  existing_count: number;
  new_count: number;
};
type Preview = {
  generated_at: string;
  totals: { candidates_total: number; invalid_count: number; existing_count: number; new_count: number };
  per_source: PerSourceRow[];
  sample: Array<{ source: string; node_slug: string; title: string; asset_type: string; owner_kind: string }>;
};
type RunResult = {
  dry_run: boolean;
  limit: number;
  processed: number;
  inserted: number;
  would_insert: number;
  skipped_existing: number;
  invalid: number;
  per_source: Record<string, { inserted: number; skipped: number; invalid?: number }>;
};

const LIMIT = 50;

export default function GrowthGraphBackfillControl() {
  const qc = useQueryClient();
  const [dryRunResult, setDryRunResult] = useState<RunResult | null>(null);
  const [lastRealRun, setLastRealRun] = useState<RunResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const previewQ = useQuery({
    queryKey: ['growth-graph-backfill-preview'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_preview_content_graph_backfill');
      if (error) throw error;
      return data as unknown as Preview;
    },
    staleTime: 30_000,
  });

  const dryRun = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('admin_run_content_graph_backfill', {
        p_limit: LIMIT, p_dry_run: true,
      });
      if (error) throw error;
      return data as unknown as RunResult;
    },
    onSuccess: (r) => {
      setDryRunResult(r);
      toast.success(`Dry-Run: ${r.would_insert} würden inserted, ${r.skipped_existing} skipped, ${r.invalid} invalid`);
    },
    onError: (e: Error) => toast.error(`Dry-Run Fehler: ${e.message}`),
  });

  const realRun = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('admin_run_content_graph_backfill', {
        p_limit: LIMIT, p_dry_run: false,
      });
      if (error) throw error;
      return data as unknown as RunResult;
    },
    onSuccess: (r) => {
      setLastRealRun(r);
      setDryRunResult(null);
      toast.success(`Real-Run: ${r.inserted} inserted · ${r.skipped_existing} skipped · ${r.invalid} invalid`);
      qc.invalidateQueries({ queryKey: ['growth-graph-summary'] });
      qc.invalidateQueries({ queryKey: ['growth-graph-orphans'] });
      qc.invalidateQueries({ queryKey: ['growth-graph-backfill-preview'] });
    },
    onError: (e: Error) => toast.error(`Real-Run Fehler: ${e.message}`),
  });

  const pending = dryRun.isPending || realRun.isPending;
  const canRealRun = !!dryRunResult && !pending;

  return (
    <div className="rounded-lg border border-border/60 bg-surface-subtle p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <Database className="h-3.5 w-3.5 text-primary" />
          Phase 2C · Backfill Control
          <Badge variant="outline" className="text-[10px]">Dry-Run-first</Badge>
        </div>
        <Button size="sm" variant="ghost" onClick={() => previewQ.refetch()} disabled={previewQ.isFetching} className="h-7 gap-1">
          <RefreshCw className={`h-3 w-3 ${previewQ.isFetching ? 'animate-spin' : ''}`} />
          <span className="text-[11px]">Preview</span>
        </Button>
      </div>

      {previewQ.isLoading && (
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
        </div>
      )}

      {previewQ.error && (
        <div className="rounded border border-destructive/30 bg-destructive-bg-subtle p-2 text-xs text-destructive">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-3 w-3" /> Preview-Fehler
          </div>
          <div className="mt-1 opacity-80">{(previewQ.error as Error).message}</div>
          <Button size="sm" variant="outline" onClick={() => previewQ.refetch()} className="mt-2 h-7">Retry</Button>
        </div>
      )}

      {previewQ.data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="rounded border border-border/40 bg-background p-2">
              <div className="text-muted-foreground text-[11px]">Candidates</div>
              <div className="text-lg font-semibold tabular-nums">{previewQ.data.totals.candidates_total}</div>
            </div>
            <div className="rounded border border-border/40 bg-background p-2">
              <div className="text-muted-foreground text-[11px]">Existing</div>
              <div className="text-lg font-semibold tabular-nums">{previewQ.data.totals.existing_count}</div>
            </div>
            <div className="rounded border border-success/30 bg-success-bg-subtle p-2">
              <div className="text-success text-[11px]">New</div>
              <div className="text-lg font-semibold tabular-nums text-success">{previewQ.data.totals.new_count}</div>
            </div>
            <div className="rounded border border-warning/30 bg-warning-bg-subtle p-2">
              <div className="text-warning text-[11px]">Invalid</div>
              <div className="text-lg font-semibold tabular-nums text-warning">{previewQ.data.totals.invalid_count}</div>
            </div>
          </div>

          <div className="text-[11px] text-muted-foreground">
            {previewQ.data.per_source.map((p) => (
              <span key={p.source} className="mr-3">
                <span className="font-mono">{p.source}</span>: {p.new_count} new / {p.existing_count} ex / {p.invalid_count} inv
              </span>
            ))}
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button size="sm" variant="outline" onClick={() => dryRun.mutate()} disabled={pending || !previewQ.data} className="h-8 gap-1">
          <ShieldCheck className="h-3.5 w-3.5" />
          Dry Run {LIMIT}
        </Button>
        <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={!canRealRun} className="h-8 gap-1">
          <Play className="h-3.5 w-3.5" />
          Real Run {LIMIT}
        </Button>
        {!dryRunResult && (
          <span className="text-[11px] text-muted-foreground">Erst Dry Run, dann Real Run möglich.</span>
        )}
      </div>

      {dryRunResult && (
        <div className="rounded border border-primary/30 bg-primary/5 p-2 text-xs">
          <div className="font-medium text-foreground">Dry-Run Ergebnis</div>
          <div className="text-muted-foreground mt-0.5">
            would_insert: <b className="text-foreground tabular-nums">{dryRunResult.would_insert}</b> ·
            skipped_existing: <b className="text-foreground tabular-nums">{dryRunResult.skipped_existing}</b> ·
            invalid: <b className="text-foreground tabular-nums">{dryRunResult.invalid}</b> ·
            processed: <b className="text-foreground tabular-nums">{dryRunResult.processed}</b>
          </div>
        </div>
      )}

      {lastRealRun && (
        <div className="rounded border border-success/30 bg-success-bg-subtle p-2 text-xs text-success">
          Real-Run committed · inserted {lastRealRun.inserted} · skipped {lastRealRun.skipped_existing} · invalid {lastRealRun.invalid}.
          Audit in <span className="font-mono">auto_heal_log</span> (action_type=growth_content_graph_backfill).
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Real Run · max {LIMIT} draft Nodes</AlertDialogTitle>
            <AlertDialogDescription>
              Schreibt bis zu <b>{LIMIT}</b> neue Knoten in <span className="font-mono">growth_content_graph_nodes</span> mit
              Status <b>draft</b>. Es werden <b>keine Edges</b> erzeugt. Existierende Nodes werden übersprungen (skipped_existing).
              {dryRunResult && (
                <span className="block mt-2">
                  Dry-Run hatte: would_insert={dryRunResult.would_insert}, skipped={dryRunResult.skipped_existing}, invalid={dryRunResult.invalid}.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={() => realRun.mutate()}>Real Run starten</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
