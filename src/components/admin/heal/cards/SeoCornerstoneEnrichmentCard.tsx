/**
 * SeoCornerstoneEnrichmentCard — E3e.5 Content-Enrichment-Welle
 * SSOT: admin_get_cornerstone_enrichment_summary + admin_seo_cornerstone_snapshot_top_targets
 *
 * Read-only Diagnose-Card. Snapshot-Button persistiert aktuellen Top-N-Stand in
 * seo_cornerstone_enrichment_targets. Pillar-Flip pillar_to_cornerstone_blog
 * bleibt OFF bis ≥1 Blog die 0.60-Schwelle reißt — kein Auto-Promote.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Camera, RefreshCw, Target } from "lucide-react";
import { toast } from "sonner";

type Target = {
  rank: number;
  blog_slug: string;
  blog_title: string;
  cornerstone_score: number;
  gap_count: number;
  gap_dimensions: string[];
};

type Summary = {
  has_snapshot: boolean;
  snapshot_id?: string;
  snapshotted_at?: string;
  count?: number;
  top_score?: number;
  avg_score?: number;
  avg_gaps?: number;
  gap_histogram?: Record<string, number>;
  targets?: Target[];
};

export function SeoCornerstoneEnrichmentCard() {
  const qc = useQueryClient();
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["seo-cornerstone-enrichment-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_cornerstone_enrichment_summary" as never,
      );
      if (error) throw error;
      return data as unknown as Summary;
    },
  });

  const snapshot = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_seo_cornerstone_snapshot_top_targets" as never,
        { _n: 30 } as never,
      );
      if (error) throw error;
      return data as { snapshot_id: string; count: number };
    },
    onSuccess: (r) => {
      toast.success(`Snapshot gespeichert (${r.count} Targets)`);
      qc.invalidateQueries({ queryKey: ["seo-cornerstone-enrichment-summary"] });
    },
    onError: (e: Error) => toast.error(`Snapshot fehlgeschlagen: ${e.message}`),
  });

  if (isLoading) {
    return (
      <Card className="p-4">
        <Skeleton className="h-32 w-full" />
      </Card>
    );
  }

  const s = data;
  const targets = s?.targets ?? [];
  const histo = s?.gap_histogram ?? {};

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold">Cornerstone-Enrichment Top-30</h3>
            <p className="text-xs text-muted-foreground">
              Welche Blogs am nächsten an Cornerstone-Reife (≥0.60) sind.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
          <Button
            size="sm"
            onClick={() => snapshot.mutate()}
            disabled={snapshot.isPending}
          >
            <Camera className="h-3 w-3 mr-1" />
            {snapshot.isPending ? "Speichere…" : "Snapshot"}
          </Button>
        </div>
      </div>

      {!s?.has_snapshot ? (
        <div className="text-sm text-muted-foreground">
          Noch kein Snapshot vorhanden.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <Kpi label="Targets" value={String(s.count ?? 0)} />
            <Kpi
              label="Top-Score"
              value={(s.top_score ?? 0).toFixed(3)}
              hint="Schwelle 0.60"
            />
            <Kpi
              label="Ø Score"
              value={(s.avg_score ?? 0).toFixed(3)}
            />
            <Kpi
              label="Ø Gap-Dim."
              value={(s.avg_gaps ?? 0).toFixed(1)}
              hint="von 8"
            />
          </div>

          <div className="flex flex-wrap gap-1">
            {Object.entries(histo)
              .sort((a, b) => b[1] - a[1])
              .map(([dim, n]) => (
                <Badge key={dim} variant="secondary" className="text-xs">
                  {dim}: {n}
                </Badge>
              ))}
          </div>

          <div className="border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Blog</TableHead>
                  <TableHead className="w-20 text-right">Score</TableHead>
                  <TableHead className="w-16 text-right">Gaps</TableHead>
                  <TableHead>Gap-Dim.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {targets.slice(0, 30).map((t) => (
                  <TableRow key={t.rank}>
                    <TableCell className="text-muted-foreground">{t.rank}</TableCell>
                    <TableCell className="font-medium truncate max-w-[280px]" title={t.blog_title}>
                      {t.blog_title}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(t.cornerstone_score).toFixed(3)}
                    </TableCell>
                    <TableCell className="text-right">{t.gap_count}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-0.5">
                        {(t.gap_dimensions ?? []).map((d) => (
                          <Badge key={d} variant="outline" className="text-[10px] px-1 py-0">
                            {d}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Snapshot {s.snapshotted_at ? new Date(s.snapshotted_at).toLocaleString("de-DE") : "—"}.
            Pillar-Flip <code>pillar_to_cornerstone_blog</code> bleibt OFF bis Top-Score ≥ 0.60 (Human-Gate).
          </p>
        </>
      )}
    </Card>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-elev-1 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
