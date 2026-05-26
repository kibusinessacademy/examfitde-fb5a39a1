import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import {
  useBerufOSGraphSummary,
  useBerufOSGraphDrift,
  useBerufOSGraphRebuild,
} from '@/hooks/useBerufOSGraph';
import { Network, Activity, AlertTriangle, RefreshCw, Layers } from 'lucide-react';

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

export default function BerufOSGraphPage() {
  const summary = useBerufOSGraphSummary();
  const drift = useBerufOSGraphDrift();
  const rebuild = useBerufOSGraphRebuild();
  const [lastRebuild, setLastRebuild] = useState<any>(null);

  const handleRebuild = async (dryRun: boolean) => {
    try {
      const res = await rebuild.mutateAsync({ dryRun });
      setLastRebuild(res);
      toast.success(
        dryRun
          ? `Dry-Run: ${res.node_count} Nodes / ${res.edge_count} Edges`
          : `Rebuild abgeschlossen — Snapshot ${res.snapshot_id?.slice(0, 8)}`,
      );
    } catch (e: any) {
      toast.error(e?.message ?? 'Rebuild fehlgeschlagen');
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">BerufOS Intelligence Graph</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Fünf-Layer-Graph: Skill · Competency · Workflow · Outcome · Recovery. Erweitert{' '}
            <code className="text-xs">berufs_ki_graph_*</code> SSOT — keine Parallelstrukturen.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleRebuild(true)}
            disabled={rebuild.isPending}
          >
            <RefreshCw className="h-4 w-4 mr-2" /> Dry-Run
          </Button>
          <Button size="sm" onClick={() => handleRebuild(false)} disabled={rebuild.isPending}>
            <RefreshCw className="h-4 w-4 mr-2" /> Rebuild
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Network className="h-4 w-4 text-primary" /> Graph Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {summary.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <>
                <KV label="Active Nodes" value={summary.data?.totals?.total_nodes ?? 0} />
                <KV label="Active Edges" value={summary.data?.totals?.total_edges ?? 0} />
                <KV label="Node Types" value={summary.data?.totals?.distinct_node_types ?? 0} />
                <KV label="Edge Types" value={summary.data?.totals?.distinct_edge_types ?? 0} />
                <KV label="Evidence" value={summary.data?.evidence_count ?? 0} />
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" /> Nodes nach Typ
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summary.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(summary.data?.nodes_by_type ?? {}).map(([k, v]) => (
                  <Badge key={k} variant="secondary" className="font-mono text-xs">
                    {k} · {v}
                  </Badge>
                ))}
                {!summary.data?.nodes_by_type && (
                  <span className="text-xs text-muted-foreground">Keine Daten</span>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" /> Edges nach Typ
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summary.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(summary.data?.edges_by_type ?? {}).map(([k, v]) => (
                  <Badge key={k} variant="outline" className="font-mono text-xs">
                    {k} · {v}
                  </Badge>
                ))}
                {!summary.data?.edges_by_type && (
                  <span className="text-xs text-muted-foreground">Keine Daten</span>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" /> Drift &amp; Integrität
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {drift.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <>
                <KV label="Edges ohne Evidence" value={drift.data?.edges_without_evidence ?? 0} />
                <KV label="Orphan Nodes" value={drift.data?.orphan_active_nodes ?? 0} />
                <KV label="Proposed stale ≥7d" value={drift.data?.proposed_stale_7d ?? 0} />
                <KV
                  label="Deprecated mit aktiven Edges"
                  value={drift.data?.deprecated_with_active_edges ?? 0}
                />
                <KV
                  label="Low-Confidence aktiv"
                  value={drift.data?.low_confidence_active_edges ?? 0}
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Letzter Snapshot</CardTitle>
          <CardDescription>
            Deterministische Versionierung mit Checksum — stabil bei idempotentem Rebuild.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {summary.data?.latest_snapshot ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KV label="Scope" value={summary.data.latest_snapshot.graph_scope} />
              <KV label="Nodes" value={summary.data.latest_snapshot.node_count} />
              <KV label="Edges" value={summary.data.latest_snapshot.edge_count} />
              <KV
                label="Checksum"
                value={
                  <code className="text-xs">
                    {summary.data.latest_snapshot.checksum.slice(0, 12)}…
                  </code>
                }
              />
              <KV
                label="Generated"
                value={new Date(summary.data.latest_snapshot.generated_at).toLocaleString('de-DE')}
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Noch kein Snapshot — Rebuild ausführen.
            </p>
          )}
        </CardContent>
      </Card>

      {lastRebuild && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Letzter Rebuild-Run</CardTitle>
            <CardDescription>
              {lastRebuild.dry_run ? 'Dry-Run' : 'Persistiert'} · Scope {lastRebuild.scope}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KV label="Nodes (aktiv)" value={lastRebuild.node_count} />
              <KV label="Edges (aktiv)" value={lastRebuild.edge_count} />
              <KV
                label="Checksum"
                value={<code className="text-xs">{String(lastRebuild.checksum).slice(0, 12)}…</code>}
              />
              <KV label="Snapshot" value={lastRebuild.snapshot_id?.slice(0, 8) ?? '—'} />
            </div>
            <Separator />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KV label="+ Curricula" value={lastRebuild.inserted?.curricula ?? 0} />
              <KV label="+ Certifications" value={lastRebuild.inserted?.certifications ?? 0} />
              <KV label="+ Competencies" value={lastRebuild.inserted?.competencies ?? 0} />
              <KV label="+ belongs_to Edges" value={lastRebuild.inserted?.belongs_to_edges ?? 0} />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Governance</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>• Keine AI-generierten aktiven Kanten ohne Review (proposed → active nur via Admin oder deterministischer Builder)</p>
          <p>• Jede Edge braucht Evidence (admin_activate_proposed_edge blockt sonst)</p>
          <p>• Deprecated statt delete · Snapshot vor/nach Rebuild · 7 Audit-Contracts aktiv</p>
        </CardContent>
      </Card>
    </div>
  );
}
