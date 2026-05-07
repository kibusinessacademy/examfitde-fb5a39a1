import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GitBranch, RefreshCw, AlertTriangle, Eye, CheckCircle2, Loader2, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

type EdgeType = 'money_page' | 'funnel_next';
type Confidence = 'high' | 'medium' | 'low';
type Proposal = {
  to_node_id: string;
  to_node_slug: string;
  to_title: string;
  edge_type: EdgeType;
  confidence: Confidence;
  reason: string;
};
type NodeRow = {
  from_node_id: string;
  from_slug: string;
  from_title: string;
  from_asset: string;
  high_count: number;
  medium_count: number;
  low_count: number;
  proposals: Proposal[];
};
type EdgePlan = {
  generated_at: string;
  totals: {
    nodes_missing_money: number;
    nodes_missing_funnel: number;
    proposals_high: number;
    proposals_medium: number;
    proposals_low: number;
    proposals_total: number;
  };
  nodes: NodeRow[];
  note: string;
};
type ApplyResult = {
  dry_run: boolean;
  requested: number;
  inserted: number;
  skipped: number;
  would_insert: number;
  would_skip_existing: number;
  errors_count: number;
  errors: Array<{ edge: unknown; error: string }>;
};

type FlatProposal = Proposal & { from_node_id: string; from_slug: string; from_asset: string };

const MAX_APPLY = 25;

const confColor: Record<Confidence, string> = {
  high: 'bg-success-bg-subtle text-success border-success/30',
  medium: 'bg-warning-bg-subtle text-warning border-warning/30',
  low: 'bg-muted text-muted-foreground border-border/40',
};

function edgeKey(p: { from_node_id: string; to_node_id: string; edge_type: string }) {
  return `${p.from_node_id}::${p.to_node_id}::${p.edge_type}`;
}

export default function GrowthGraphEdgePlanCard() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [dryResult, setDryResult] = useState<ApplyResult | null>(null);
  const [lastResult, setLastResult] = useState<ApplyResult | null>(null);
  // Selection signature → invalidate dryResult when selection changes
  const selectionSig = useMemo(() => Array.from(selected).sort().join('|'), [selected]);
  const [dryForSig, setDryForSig] = useState<string>('');

  const planQ = useQuery({
    queryKey: ['growth-graph-edge-plan'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_preview_content_graph_edge_plan', {
        p_limit_per_node: 3,
        p_max_nodes: 100,
      });
      if (error) throw error;
      return data as unknown as EdgePlan;
    },
    staleTime: 60_000,
  });

  const applyM = useMutation({
    mutationFn: async (vars: { edges: FlatProposal[]; reason: string; dryRun: boolean }) => {
      const payload = vars.edges.map((e) => ({
        from_node_id: e.from_node_id,
        to_node_id: e.to_node_id,
        edge_type: e.edge_type,
        confidence: e.confidence,
        reason: e.reason,
      }));
      const { data, error } = await supabase.rpc('admin_apply_content_graph_edges', {
        p_edges: payload as never,
        p_reason: vars.reason,
        p_dry_run: vars.dryRun,
      });
      if (error) throw error;
      return data as unknown as ApplyResult;
    },
    onSuccess: (res) => {
      if (res.dry_run) {
        setDryResult(res);
        setDryForSig(selectionSig);
        toast.success(`Dry-Run: ${res.would_insert} would insert, ${res.would_skip_existing} skip, ${res.errors_count} errors`);
      } else {
        setLastResult(res);
        toast.success(`Applied: ${res.inserted} new, ${res.skipped} skipped, ${res.errors_count} errors`);
        setSelected(new Set());
        setDryResult(null);
        setDryForSig('');
        setConfirmOpen(false);
        setReason('');
        qc.invalidateQueries({ queryKey: ['growth-graph-edge-plan'] });
        qc.invalidateQueries({ queryKey: ['growth-graph-summary'] });
        qc.invalidateQueries({ queryKey: ['growth-graph-orphans'] });
      }
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  const flatTop: FlatProposal[] = useMemo(
    () =>
      (planQ.data?.nodes ?? [])
        .flatMap((n) =>
          n.proposals.map((p) => ({
            ...p,
            from_node_id: n.from_node_id,
            from_slug: n.from_slug,
            from_asset: n.from_asset,
          })),
        )
        .sort((a, b) => {
          const order: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };
          if (order[a.confidence] !== order[b.confidence]) return order[a.confidence] - order[b.confidence];
          return a.edge_type.localeCompare(b.edge_type);
        })
        .slice(0, 25),
    [planQ.data],
  );

  const selectedEdges = flatTop.filter((p) => selected.has(edgeKey(p)));
  const selectedCount = selectedEdges.length;
  const canDryRun = selectedCount > 0 && selectedCount <= MAX_APPLY && !applyM.isPending;
  const dryFresh = dryResult !== null && dryForSig === selectionSig;
  const canRealApply = canDryRun && dryFresh;

  // Selection summary
  const sumMoney = selectedEdges.filter((e) => e.edge_type === 'money_page').length;
  const sumFunnel = selectedEdges.filter((e) => e.edge_type === 'funnel_next').length;
  const sumDistinctFrom = new Set(selectedEdges.map((e) => e.from_node_id)).size;
  const sumDistinctTo = new Set(selectedEdges.map((e) => e.to_node_id)).size;

  const toggle = (p: FlatProposal) => {
    if (p.confidence !== 'high') return;
    setSelected((prev) => {
      const next = new Set(prev);
      const k = edgeKey(p);
      if (next.has(k)) next.delete(k);
      else if (next.size < MAX_APPLY) next.add(k);
      else toast.warning(`Max ${MAX_APPLY} pro Run`);
      return next;
    });
  };

  const highKeys = flatTop.filter((p) => p.confidence === 'high').map(edgeKey);
  const allHighSelected = highKeys.length > 0 && highKeys.every((k) => selected.has(k));

  const toggleAllHigh = () => {
    if (allHighSelected) setSelected(new Set());
    else setSelected(new Set(highKeys.slice(0, MAX_APPLY)));
  };

  const openConfirm = () => {
    if (!canDryRun) return;
    setDryResult(null);
    setLastResult(null);
    setConfirmOpen(true);
  };

  return (
    <div className="rounded-lg border border-border/60 bg-surface-subtle p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <GitBranch className="h-3.5 w-3.5 text-primary" />
          Phase 2F · Edge Plan & Apply
          <Badge variant="outline" className="text-[10px]">dry-run-first · max {MAX_APPLY}</Badge>
        </div>
        <Button size="sm" variant="ghost" onClick={() => planQ.refetch()} disabled={planQ.isFetching} className="h-7 gap-1">
          <RefreshCw className={`h-3 w-3 ${planQ.isFetching ? 'animate-spin' : ''}`} />
          <span className="text-[11px]">Refresh</span>
        </Button>
      </div>

      {planQ.isLoading && (
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
        </div>
      )}

      {planQ.error && (
        <div className="rounded border border-destructive/30 bg-destructive-bg-subtle p-2 text-xs text-destructive">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-3 w-3" /> Edge-Plan-Fehler
          </div>
          <div className="mt-1 opacity-80">{(planQ.error as Error).message}</div>
          <Button size="sm" variant="outline" onClick={() => planQ.refetch()} className="mt-2 h-7">Retry</Button>
        </div>
      )}

      {planQ.data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            <div className="rounded border border-border/40 bg-background p-2">
              <div className="text-muted-foreground text-[11px]">Missing money_page</div>
              <div className="text-lg font-semibold tabular-nums">{planQ.data.totals.nodes_missing_money}</div>
            </div>
            <div className="rounded border border-border/40 bg-background p-2">
              <div className="text-muted-foreground text-[11px]">Missing funnel_next</div>
              <div className="text-lg font-semibold tabular-nums">{planQ.data.totals.nodes_missing_funnel}</div>
            </div>
            <div className="rounded border border-border/40 bg-background p-2">
              <div className="text-muted-foreground text-[11px]">Proposals total</div>
              <div className="text-lg font-semibold tabular-nums">{planQ.data.totals.proposals_total}</div>
            </div>
            <div className="rounded border border-success/30 bg-success-bg-subtle p-2">
              <div className="text-success text-[11px]">High</div>
              <div className="text-lg font-semibold tabular-nums text-success">{planQ.data.totals.proposals_high}</div>
            </div>
            <div className="rounded border border-warning/30 bg-warning-bg-subtle p-2">
              <div className="text-warning text-[11px]">Medium</div>
              <div className="text-lg font-semibold tabular-nums text-warning">{planQ.data.totals.proposals_medium}</div>
            </div>
            <div className="rounded border border-border/40 bg-background p-2">
              <div className="text-muted-foreground text-[11px]">Low</div>
              <div className="text-lg font-semibold tabular-nums">{planQ.data.totals.proposals_low}</div>
            </div>
          </div>

          <div className="rounded border border-primary/30 bg-primary/5 p-2 text-[11px] text-muted-foreground flex items-start gap-2">
            <Eye className="h-3 w-3 mt-0.5 shrink-0 text-primary" />
            <span>Nur <strong>high-confidence</strong> auswählbar. Pflicht-Workflow: <strong>Dry-Run zuerst</strong> → Real-Apply danach freigeschaltet. Max {MAX_APPLY}/Run, idempotent, audited.</span>
          </div>

          {lastResult && !lastResult.dry_run && (
            <div className="rounded border border-success/30 bg-success-bg-subtle p-2 text-[11px] text-success">
              Letzter Apply: <strong>{lastResult.inserted}</strong> inserted · {lastResult.skipped} skipped · {lastResult.errors_count} errors
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium text-foreground">Top 25 Vorschläge</div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={toggleAllHigh}
                disabled={highKeys.length === 0}
                className="h-7 text-[11px]"
              >
                {allHighSelected ? 'Auswahl löschen' : `Alle high (${Math.min(highKeys.length, MAX_APPLY)})`}
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={openConfirm}
                disabled={!canDryRun}
                className="h-7 gap-1"
              >
                <FlaskConical className="h-3 w-3" />
                Dry-Run ({selectedCount})
              </Button>
            </div>
          </div>

          {flatTop.length === 0 ? (
            <div className="rounded border border-success/30 bg-success-bg-subtle p-3 text-xs text-success">
              Keine offenen Vorschläge.
            </div>
          ) : (
            <ScrollArea className="h-[300px] rounded border border-border/60">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface-subtle text-muted-foreground">
                  <tr>
                    <th className="text-left p-2 font-medium w-6"></th>
                    <th className="text-left p-2 font-medium">From</th>
                    <th className="text-left p-2 font-medium">→ To</th>
                    <th className="text-left p-2 font-medium">Type</th>
                    <th className="text-left p-2 font-medium">Conf.</th>
                    <th className="text-left p-2 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {flatTop.map((p) => {
                    const k = edgeKey(p);
                    const isHigh = p.confidence === 'high';
                    return (
                      <tr key={k} className="border-t border-border/40">
                        <td className="p-2">
                          <Checkbox
                            checked={selected.has(k)}
                            disabled={!isHigh || applyM.isPending}
                            onCheckedChange={() => toggle(p)}
                            aria-label={`Select edge ${p.from_slug} → ${p.to_node_slug}`}
                          />
                        </td>
                        <td className="p-2 font-mono text-[11px] text-foreground truncate max-w-[180px]" title={p.from_slug}>{p.from_slug}</td>
                        <td className="p-2 font-mono text-[11px] text-foreground truncate max-w-[180px]" title={p.to_node_slug}>{p.to_node_slug}</td>
                        <td className="p-2 text-muted-foreground">{p.edge_type}</td>
                        <td className="p-2">
                          <Badge variant="outline" className={`text-[10px] ${confColor[p.confidence]}`}>{p.confidence}</Badge>
                        </td>
                        <td className="p-2 text-muted-foreground text-[11px]">{p.reason}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollArea>
          )}
        </>
      )}

      <Dialog open={confirmOpen} onOpenChange={(o) => !applyM.isPending && setConfirmOpen(o)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Apply {selectedCount} high-confidence Edges</DialogTitle>
            <DialogDescription>
              Pflicht-Reason (≥3 Zeichen). <strong>Erst Dry-Run</strong>, dann Real-Apply (idempotent, audited).
            </DialogDescription>
          </DialogHeader>

          {/* Selection Summary */}
          <div className="rounded border border-border/60 bg-surface-subtle p-2 text-xs space-y-1">
            <div className="font-medium text-foreground">Selection Summary</div>
            <div className="grid grid-cols-2 gap-1 text-muted-foreground">
              <div>Selected total: <span className="font-semibold text-foreground tabular-nums">{selectedCount}</span></div>
              <div>money_page: <span className="font-semibold text-foreground tabular-nums">{sumMoney}</span></div>
              <div>funnel_next: <span className="font-semibold text-foreground tabular-nums">{sumFunnel}</span></div>
              <div>distinct sources: <span className="font-semibold text-foreground tabular-nums">{sumDistinctFrom}</span></div>
              <div>distinct targets: <span className="font-semibold text-foreground tabular-nums">{sumDistinctTo}</span></div>
            </div>
          </div>

          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (z.B. 'Manueller Closeout high-confidence money_page Vorschläge KW19')"
            disabled={applyM.isPending}
            rows={2}
          />

          {/* Dry-Run Result */}
          {dryResult && dryFresh && (
            <div className="rounded border border-info/30 bg-info-bg-subtle p-2 text-xs space-y-1">
              <div className="font-medium text-info flex items-center gap-1"><FlaskConical className="h-3 w-3" /> Dry-Run Result</div>
              <div className="grid grid-cols-3 gap-1 text-muted-foreground">
                <div>would_insert: <span className="font-semibold text-success tabular-nums">{dryResult.would_insert}</span></div>
                <div>would_skip: <span className="font-semibold text-foreground tabular-nums">{dryResult.would_skip_existing}</span></div>
                <div>errors: <span className={`font-semibold tabular-nums ${dryResult.errors_count > 0 ? 'text-destructive' : 'text-foreground'}`}>{dryResult.errors_count}</span></div>
              </div>
              {dryResult.errors_count > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-destructive">Error details ({dryResult.errors_count})</summary>
                  <ScrollArea className="h-[120px] mt-1 rounded border border-border/40 bg-background p-2">
                    <ul className="space-y-1">
                      {dryResult.errors.map((er, i) => (
                        <li key={i} className="font-mono text-[10px] text-destructive">• {er.error}</li>
                      ))}
                    </ul>
                  </ScrollArea>
                </details>
              )}
            </div>
          )}
          {dryResult && !dryFresh && (
            <div className="rounded border border-warning/30 bg-warning-bg-subtle p-2 text-[11px] text-warning">
              Auswahl geändert — bitte erneut Dry-Run ausführen.
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={applyM.isPending}>
              Abbrechen
            </Button>
            <Button
              variant="outline"
              onClick={() => applyM.mutate({ edges: selectedEdges, reason: reason.trim(), dryRun: true })}
              disabled={reason.trim().length < 3 || applyM.isPending || !canDryRun}
              className="gap-1"
            >
              {applyM.isPending && applyM.variables?.dryRun ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
              Dry-Run
            </Button>
            <Button
              variant="default"
              onClick={() => applyM.mutate({ edges: selectedEdges, reason: reason.trim(), dryRun: false })}
              disabled={reason.trim().length < 3 || applyM.isPending || !canRealApply}
              className="gap-1"
            >
              {applyM.isPending && applyM.variables?.dryRun === false ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Real Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
