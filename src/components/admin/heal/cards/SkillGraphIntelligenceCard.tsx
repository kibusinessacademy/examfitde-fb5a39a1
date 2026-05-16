import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Network, RefreshCw } from "lucide-react";

type Summary = {
  edges?: {
    total?: number;
    prerequisite?: number;
    blocks?: number;
    transfer?: number;
    co_occurs?: number;
    high_confidence?: number;
  };
  nodes?: {
    total?: number;
    bottlenecks?: number;
    hubs?: number;
    bridges?: number;
    isolated?: number;
  };
  transfer_patterns?: {
    total?: number;
    mastery?: number;
    recovery?: number;
    negative?: number;
  };
  top_bottlenecks?: Array<{
    competency_id: string;
    blocks_count: number;
    out_degree: number;
    centrality_score: number;
  }>;
  top_transfer_sources?: Array<{
    source_competency_id: string;
    targets_affected: number;
    avg_transfer_score: number;
    total_sample_size: number;
  }>;
  generated_at?: string;
};

export function SkillGraphIntelligenceCard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [recomputing, setRecomputing] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc(
        "admin_get_skill_graph_summary" as any,
      );
      if (error) throw error;
      setSummary((data as Summary) || null);
    } catch (e: any) {
      toast.error(e?.message ?? "Skill-Graph laden fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }

  async function recompute() {
    setRecomputing(true);
    try {
      const { data, error } = await supabase.rpc(
        "admin_recompute_skill_graph" as any,
      );
      if (error) throw error;
      toast.success(
        `Knowledge-Graph neu berechnet: ${(data as any)?.nodes_upserted ?? 0} Knoten`,
      );
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Recompute fehlgeschlagen");
    } finally {
      setRecomputing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const e = summary?.edges ?? {};
  const n = summary?.nodes ?? {};
  const t = summary?.transfer_patterns ?? {};

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Network className="h-4 w-4 text-primary" />
          Skill Graph & Dependency Intelligence
          <Badge variant="outline" className="ml-2 text-[10px]">
            Bridge 12
          </Badge>
        </CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Refresh
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={recompute}
            disabled={recomputing}
          >
            {recomputing ? "Berechne…" : "Recompute Graph"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <Kpi label="Edges total" value={e.total ?? 0} />
          <Kpi label="High-confidence" value={e.high_confidence ?? 0} />
          <Kpi label="Prerequisites" value={e.prerequisite ?? 0} />
          <Kpi label="Transfer edges" value={e.transfer ?? 0} />
          <Kpi label="Nodes total" value={n.total ?? 0} />
          <Kpi label="Bottlenecks" value={n.bottlenecks ?? 0} tone="destructive" />
          <Kpi label="Hubs" value={n.hubs ?? 0} />
          <Kpi label="Bridges" value={n.bridges ?? 0} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <Kpi label="Transfer Patterns" value={t.total ?? 0} />
          <Kpi label="Mastery Transfer" value={t.mastery ?? 0} />
          <Kpi
            label="Negative Transfer"
            value={t.negative ?? 0}
            tone={t.negative ? "destructive" : "default"}
          />
        </div>

        {summary?.top_bottlenecks && summary.top_bottlenecks.length > 0 && (
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2">
              Top Bottleneck-Kompetenzen
            </div>
            <div className="space-y-1">
              {summary.top_bottlenecks.slice(0, 5).map((b) => (
                <div
                  key={b.competency_id}
                  className="flex items-center justify-between text-xs border rounded px-2 py-1.5"
                >
                  <code className="text-[10px] truncate max-w-[260px]">
                    {b.competency_id}
                  </code>
                  <div className="flex gap-2">
                    <Badge variant="destructive" className="text-[10px]">
                      blocks {b.blocks_count}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      out {b.out_degree}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      score {Number(b.centrality_score).toFixed(1)}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {summary?.top_transfer_sources &&
          summary.top_transfer_sources.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-2">
                Top Transfer-Quellen
              </div>
              <div className="space-y-1">
                {summary.top_transfer_sources.slice(0, 5).map((s) => (
                  <div
                    key={s.source_competency_id}
                    className="flex items-center justify-between text-xs border rounded px-2 py-1.5"
                  >
                    <code className="text-[10px] truncate max-w-[260px]">
                      {s.source_competency_id}
                    </code>
                    <div className="flex gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        targets {s.targets_affected}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        score {Number(s.avg_transfer_score ?? 0).toFixed(2)}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        n {s.total_sample_size}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        {(!summary?.edges?.total || summary.edges.total === 0) && !loading && (
          <div className="text-xs text-muted-foreground border-dashed border rounded p-3">
            Noch keine Skill-Edges. Edges entstehen empirisch aus Readiness-,
            Intervention- und Outcome-Daten. „Recompute Graph" aktualisiert die
            Knoten-Metriken auf Basis vorhandener Edges.
          </div>
        )}

        {summary?.generated_at && (
          <p className="text-[10px] text-muted-foreground">
            Stand: {new Date(summary.generated_at).toLocaleString("de-DE")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Kpi({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "destructive";
}) {
  return (
    <div className="rounded border bg-card px-2 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div
        className={`text-base font-semibold tabular-nums ${
          tone === "destructive" && value > 0 ? "text-destructive" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
