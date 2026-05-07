import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, ScrollText, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';

type AuditEntry = {
  id: string;
  created_at: string;
  action_type: string;
  result_status: string | null;
  result_detail: Record<string, any> | null;
  metadata: Record<string, any> | null;
};

const ACTION_LABELS: Record<string, string> = {
  growth_content_graph_backfill: 'Backfill',
  growth_content_graph_apply_edges: 'Apply Edges',
  growth_content_graph_apply_edges_dry_run: 'Apply Edges (dry-run)',
  growth_content_node_register: 'Node Register',
  growth_content_edge_link: 'Edge Link',
};

function statusVariant(status: string | null): 'success' | 'warning' | 'danger' | 'muted' {
  if (!status) return 'muted';
  const s = status.toLowerCase();
  if (s === 'success' || s === 'ok') return 'success';
  if (s === 'error' || s === 'failed') return 'danger';
  if (s === 'partial' || s === 'warning') return 'warning';
  return 'muted';
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', {
    dateStyle: 'short',
    timeStyle: 'medium',
  });
}

function Row({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);
  const isDryRun = entry.action_type === 'growth_content_graph_apply_edges_dry_run';
  const detail = entry.result_detail ?? {};
  const meta = entry.metadata ?? {};

  const inserted = detail.inserted ?? detail.would_insert ?? meta.inserted ?? null;
  const skipped = detail.skipped_exists ?? detail.would_skip_existing ?? detail.skipped ?? meta.skipped ?? null;
  const errors = detail.errors ?? meta.errors ?? null;
  const reason = meta.reason ?? detail.reason ?? null;

  return (
    <>
      <tr className="border-t border-border-subtle hover:bg-surface-sunken/40">
        <td className="p-2 align-top">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 text-text-secondary hover:text-text-primary"
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        </td>
        <td className="p-2 align-top text-[11px] text-text-secondary tabular-nums whitespace-nowrap">
          {formatTime(entry.created_at)}
        </td>
        <td className="p-2 align-top">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-medium text-text-primary">
              {ACTION_LABELS[entry.action_type] ?? entry.action_type}
            </span>
            {isDryRun ? (
              <Badge variant="info" size="sm">dry-run</Badge>
            ) : entry.action_type === 'growth_content_graph_apply_edges' ? (
              <Badge variant="petrol" size="sm">real</Badge>
            ) : null}
          </div>
        </td>
        <td className="p-2 align-top">
          <Badge variant={statusVariant(entry.result_status)} size="sm">
            {entry.result_status ?? '—'}
          </Badge>
        </td>
        <td className="p-2 align-top text-[11px] tabular-nums text-text-secondary">
          {inserted != null && <span className="text-success">+{inserted}</span>}
          {inserted != null && (skipped != null || errors != null) && ' · '}
          {skipped != null && <span className="text-text-secondary">skip {skipped}</span>}
          {skipped != null && errors != null && ' · '}
          {errors != null && Number(errors) > 0 && <span className="text-destructive">err {errors}</span>}
          {inserted == null && skipped == null && errors == null && <span className="text-text-tertiary">—</span>}
        </td>
        <td className="p-2 align-top text-[11px] text-text-secondary max-w-[220px] truncate">
          {reason ? <span title={String(reason)}>{String(reason)}</span> : <span className="text-text-tertiary">—</span>}
        </td>
      </tr>
      {open && (
        <tr className="bg-surface-sunken/60 border-t border-border-subtle">
          <td colSpan={6} className="p-3">
            <div className="grid md:grid-cols-2 gap-3 text-[11px]">
              <div>
                <div className="font-medium text-text-secondary mb-1">result_detail</div>
                <pre className="bg-surface p-2 rounded border border-border-subtle overflow-auto max-h-48 text-text-primary">
                  {JSON.stringify(entry.result_detail ?? {}, null, 2)}
                </pre>
              </div>
              <div>
                <div className="font-medium text-text-secondary mb-1">metadata</div>
                <pre className="bg-surface p-2 rounded border border-border-subtle overflow-auto max-h-48 text-text-primary">
                  {JSON.stringify(entry.metadata ?? {}, null, 2)}
                </pre>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function GrowthGraphAuditLogCard() {
  const q = useQuery({
    queryKey: ['growth-graph-audit-log'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_get_growth_graph_audit_log', { p_limit: 25 });
      if (error) throw error;
      return (data ?? []) as unknown as AuditEntry[];
    },
    staleTime: 30_000,
  });

  const entries = q.data ?? [];

  return (
    <Card variant="flat" className="border-border-subtle">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm">
            <ScrollText className="h-4 w-4 text-primary" />
            Growth Graph · Audit Log
          </CardTitle>
          <CardDescription className="mt-1 text-xs">
            Letzte 25 Aktionen (Backfill, Edge-Apply Dry-Run + Real, Node/Edge Register). Read-only.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => q.refetch()} disabled={q.isFetching} className="gap-1">
          <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.error && (
          <div className="rounded border border-destructive-border bg-destructive-bg-subtle p-3 text-xs text-destructive">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              Fehler beim Laden
            </div>
            <div className="mt-1 opacity-80">{(q.error as Error).message}</div>
            <Button size="sm" variant="outline" onClick={() => q.refetch()} className="mt-2">Retry</Button>
          </div>
        )}

        {q.isLoading && !q.error && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
          </div>
        )}

        {!q.isLoading && !q.error && (
          entries.length === 0 ? (
            <div className="rounded border border-border-subtle bg-surface-sunken p-4 text-xs text-text-secondary text-center">
              Noch keine Growth-Graph-Aktionen geloggt.
            </div>
          ) : (
            <ScrollArea className="h-[420px] rounded border border-border-subtle">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface-sunken text-text-secondary z-10">
                  <tr>
                    <th className="p-2 w-6"></th>
                    <th className="text-left p-2 font-medium">Time</th>
                    <th className="text-left p-2 font-medium">Action</th>
                    <th className="text-left p-2 font-medium">Status</th>
                    <th className="text-left p-2 font-medium">Result</th>
                    <th className="text-left p-2 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => <Row key={e.id} entry={e} />)}
                </tbody>
              </table>
            </ScrollArea>
          )
        )}
      </CardContent>
    </Card>
  );
}
