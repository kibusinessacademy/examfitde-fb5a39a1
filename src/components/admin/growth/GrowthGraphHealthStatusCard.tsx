import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, CheckCircle2, Network, KeyRound, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';

type Severity = 'OK' | 'P2' | 'P1' | 'P0';

type Summary = {
  generated_at: string;
  nodes_total: number;
  edges_total: number;
};

type Orphan = {
  missing_inbound: boolean;
  missing_outbound: boolean;
  missing_funnel_next: boolean;
  missing_money_page: boolean;
};

type OrphansResult = { generated_at: string; total_nodes: number; orphans: Orphan[] };

type KeywordSync = {
  generated_at: string;
  metrics: {
    nodes_with_keyword_slug: number;
    keywords_registered: number;
    missing_keyword_registry: number;
    keyword_owner_mismatch: number;
    duplicate_active_keyword_owner: number;
    ok_count: number;
  };
};

const sevColor: Record<Severity, string> = {
  OK: 'bg-success-bg-subtle text-success border-success/30',
  P2: 'bg-warning-bg-subtle text-warning border-warning/30',
  P1: 'bg-warning-bg-subtle text-warning border-warning/40',
  P0: 'bg-destructive-bg-subtle text-destructive border-destructive/40',
};

function deriveSeverity(args: {
  orphanRate: number;
  missingMoney: number;
  missingFunnel: number;
  missingRegistry: number;
  ownerMismatch: number;
  duplicateActive: number;
}): { level: Severity; reason: string; action: string } {
  const { orphanRate, missingMoney, missingFunnel, missingRegistry, ownerMismatch, duplicateActive } = args;
  if (
    orphanRate === 0 && missingMoney === 0 && missingFunnel === 0 &&
    missingRegistry === 0 && ownerMismatch === 0 && duplicateActive === 0
  ) {
    return { level: 'OK', reason: 'Graph & Keyword-Sync vollständig.', action: 'Nichts zu tun. Beobachten.' };
  }
  if (missingMoney > 0 || duplicateActive > 0) {
    return {
      level: 'P0',
      reason: `${missingMoney} ohne money_page · ${duplicateActive} duplicate active owners.`,
      action: 'Money-Page-Edges + duplicate Owner sofort beheben.',
    };
  }
  if (orphanRate > 0.5 || missingFunnel > 20 || ownerMismatch > 0) {
    return {
      level: 'P1',
      reason: `Orphan-Rate ${(orphanRate * 100).toFixed(0)} % · funnel ${missingFunnel} · owner-mismatch ${ownerMismatch}.`,
      action: 'Edge-Plan apply (high-confidence) + Owner-Mismatch reviewen.',
    };
  }
  return {
    level: 'P2',
    reason: `Drifts klein: orphans ${(orphanRate * 100).toFixed(0)} %, missing_registry ${missingRegistry}.`,
    action: 'Im nächsten Sweep mitnehmen.',
  };
}

function Tile({ label, value, icon: Icon, hint }: {
  label: string; value: number | string; icon: React.ComponentType<{ className?: string }>; hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-surface-subtle p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

export default function GrowthGraphHealthStatusCard() {
  const summaryQ = useQuery({
    queryKey: ['ggh-summary'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_get_content_graph_summary');
      if (error) throw error;
      return data as unknown as Summary;
    },
    staleTime: 60_000,
  });

  const orphansQ = useQuery({
    queryKey: ['ggh-orphans'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_get_content_graph_orphans');
      if (error) throw error;
      return data as unknown as OrphansResult;
    },
    staleTime: 60_000,
  });

  const keywordQ = useQuery({
    queryKey: ['ggh-keyword-sync'],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('admin_check_keyword_graph_sync');
      if (error) throw error;
      return data as KeywordSync;
    },
    staleTime: 60_000,
  });

  const loading = summaryQ.isLoading || orphansQ.isLoading || keywordQ.isLoading;
  const error = summaryQ.error || orphansQ.error || keywordQ.error;

  const refresh = () => {
    summaryQ.refetch();
    orphansQ.refetch();
    keywordQ.refetch();
  };

  const summary = summaryQ.data;
  const orphans = orphansQ.data?.orphans ?? [];
  const km = keywordQ.data?.metrics;

  const totals = {
    money: orphans.filter((o) => o.missing_money_page).length,
    funnel: orphans.filter((o) => o.missing_funnel_next).length,
  };
  const orphanRate = summary?.nodes_total ? orphans.length / summary.nodes_total : 0;

  const sev = deriveSeverity({
    orphanRate,
    missingMoney: totals.money,
    missingFunnel: totals.funnel,
    missingRegistry: km?.missing_keyword_registry ?? 0,
    ownerMismatch: km?.keyword_owner_mismatch ?? 0,
    duplicateActive: km?.duplicate_active_keyword_owner ?? 0,
  });

  const lastComputed = [summary?.generated_at, orphansQ.data?.generated_at, keywordQ.data?.generated_at]
    .filter(Boolean)
    .sort()
    .pop();

  return (
    <Card className="shadow-elev-1">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-primary" />
            Growth Graph · Health Status
            <Badge variant="outline" className={`text-[10px] ${sevColor[sev.level]}`}>{sev.level}</Badge>
          </CardTitle>
          <CardDescription className="mt-1 text-xs">{sev.reason}</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={refresh} disabled={loading} className="gap-1">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <div className="rounded border border-destructive/30 bg-destructive-bg-subtle p-3 text-xs text-destructive">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" /> Fehler beim Laden
            </div>
            <div className="mt-1 opacity-80">{(error as Error).message}</div>
            <Button size="sm" variant="outline" onClick={refresh} className="mt-2">Retry</Button>
          </div>
        )}

        {loading && !error && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
          </div>
        )}

        {!loading && !error && summary && km && (
          <>
            <div>
              <div className="text-xs font-medium text-foreground mb-2 flex items-center gap-1.5">
                <Network className="h-3.5 w-3.5" /> Graph Health
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <Tile label="Nodes" value={summary.nodes_total} icon={Network} />
                <Tile label="Edges" value={summary.edges_total} icon={Network} />
                <Tile label="Orphan rate" value={`${(orphanRate * 100).toFixed(0)}%`} icon={AlertTriangle}
                  hint={`${orphans.length} orphans`} />
                <Tile label="Missing money" value={totals.money} icon={AlertTriangle} />
                <Tile label="Missing funnel" value={totals.funnel} icon={AlertTriangle} />
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-foreground mb-2 flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5" /> Keyword Sync
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <Tile label="Nodes w/ keyword" value={km.nodes_with_keyword_slug} icon={KeyRound} />
                <Tile label="Registered" value={km.keywords_registered} icon={CheckCircle2} />
                <Tile label="Missing registry" value={km.missing_keyword_registry} icon={AlertTriangle} />
                <Tile label="Owner mismatch" value={km.keyword_owner_mismatch} icon={AlertTriangle} />
                <Tile label="Duplicate active" value={km.duplicate_active_keyword_owner} icon={AlertTriangle} />
              </div>
            </div>

            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <div className="text-xs font-medium text-foreground">Empfohlene nächste Aktion</div>
              <div className="text-xs text-muted-foreground mt-0.5">{sev.action}</div>
            </div>

            {lastComputed && (
              <div className="text-[11px] text-muted-foreground">
                Last computed: {new Date(lastComputed).toLocaleString('de-DE')}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
