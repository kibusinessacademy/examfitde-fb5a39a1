/**
 * ContentFeedbackPipelineCard — Bridge 3 (Support → Repair)
 * ──────────────────────────────────────────────────────────
 * Zeigt Backlog & MTTR pro Entitäts-Typ aus content_feedback_events.
 * Admin kann high-severity Events triagieren / auflösen / verwerfen.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquareWarning, Check, X, Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type PipelineRow = {
  entity_type: string;
  open_count: number;
  triaged_count: number;
  repair_enqueued_count: number;
  resolved_count: number;
  rejected_count: number;
  high_severity_open: number;
  last_24h: number;
  mttr_minutes_30d: number | null;
};

type FeedbackEvent = {
  id: string;
  source: string;
  entity_type: string;
  entity_id: string | null;
  package_id: string | null;
  severity: string;
  reason_code: string;
  status: string;
  description: string | null;
  created_at: string;
};

export function ContentFeedbackPipelineCard() {
  const qc = useQueryClient();
  const [filterEntity, setFilterEntity] = useState<string | null>(null);

  const pipeline = useQuery({
    queryKey: ["content-feedback-pipeline"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_content_feedback_pipeline" as never);
      if (error) throw error;
      return (data ?? []) as PipelineRow[];
    },
    refetchInterval: 30_000,
  });

  const events = useQuery({
    queryKey: ["content-feedback-events", filterEntity],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_list_content_feedback_events", {
        _status: "open",
        _entity_type: filterEntity,
        _limit: 25,
      });
      if (error) throw error;
      return (data ?? []) as FeedbackEvent[];
    },
    refetchInterval: 30_000,
  });

  const resolve = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "resolve" | "reject" | "duplicate" | "triage" }) => {
      const { error } = await supabase.rpc("admin_resolve_feedback_event" as never, {
        _event_id: id,
        _action: action,
        _notes: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Feedback-Event aktualisiert");
      qc.invalidateQueries({ queryKey: ["content-feedback-pipeline"] });
      qc.invalidateQueries({ queryKey: ["content-feedback-events"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Fehler"),
  });

  const totals = useMemo(() => {
    const rows = pipeline.data ?? [];
    return {
      open: rows.reduce((s, r) => s + Number(r.open_count ?? 0), 0),
      highOpen: rows.reduce((s, r) => s + Number(r.high_severity_open ?? 0), 0),
      enqueued: rows.reduce((s, r) => s + Number(r.repair_enqueued_count ?? 0), 0),
    };
  }, [pipeline.data]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <MessageSquareWarning className="h-4 w-4 text-primary" />
          Content Feedback Pipeline
          <Badge variant="outline" className="ml-2 text-xs">Bridge 3</Badge>
        </CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">{totals.open} open</Badge>
          {totals.highOpen > 0 && (
            <Badge variant="destructive" className="text-xs">{totals.highOpen} high/critical</Badge>
          )}
          <Badge variant="outline" className="text-xs">{totals.enqueued} repair-enqueued</Badge>
          <Button
            variant="ghost" size="icon" className="h-7 w-7"
            onClick={() => {
              qc.invalidateQueries({ queryKey: ["content-feedback-pipeline"] });
              qc.invalidateQueries({ queryKey: ["content-feedback-events"] });
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {pipeline.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (pipeline.data?.length ?? 0) === 0 ? (
          <p className="text-xs text-muted-foreground">Noch kein Content-Feedback erfasst.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-1.5 pr-2">Entity</th>
                  <th className="text-right px-2">Open</th>
                  <th className="text-right px-2">High</th>
                  <th className="text-right px-2">Enqueued</th>
                  <th className="text-right px-2">Resolved</th>
                  <th className="text-right px-2">24h</th>
                  <th className="text-right px-2">MTTR (min)</th>
                  <th className="text-right px-2"></th>
                </tr>
              </thead>
              <tbody>
                {pipeline.data!.map((r) => (
                  <tr key={r.entity_type} className="border-b last:border-0">
                    <td className="py-1.5 pr-2 font-medium">{r.entity_type}</td>
                    <td className="text-right px-2">{Number(r.open_count)}</td>
                    <td className="text-right px-2">
                      {Number(r.high_severity_open) > 0 ? (
                        <Badge variant="destructive" className="text-[10px]">{Number(r.high_severity_open)}</Badge>
                      ) : "0"}
                    </td>
                    <td className="text-right px-2">{Number(r.repair_enqueued_count)}</td>
                    <td className="text-right px-2 text-muted-foreground">{Number(r.resolved_count)}</td>
                    <td className="text-right px-2">{Number(r.last_24h)}</td>
                    <td className="text-right px-2 text-muted-foreground">
                      {r.mttr_minutes_30d != null ? Math.round(Number(r.mttr_minutes_30d)) : "–"}
                    </td>
                    <td className="text-right px-2">
                      <Button
                        variant="ghost" size="sm" className="h-6 text-[10px]"
                        onClick={() => setFilterEntity(filterEntity === r.entity_type ? null : r.entity_type)}
                      >
                        {filterEntity === r.entity_type ? "Alle" : "Filter"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">
            Open events{filterEntity ? ` · ${filterEntity}` : ""}
          </div>
          {events.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : (events.data?.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground">Keine offenen Events.</p>
          ) : (
            <div className="space-y-1.5">
              {events.data!.map((e) => (
                <div key={e.id} className="flex items-center gap-2 p-2 rounded border bg-card/50 text-xs">
                  <Badge
                    variant={e.severity === "critical" ? "destructive" : e.severity === "high" ? "default" : "secondary"}
                    className="text-[10px]"
                  >
                    {e.severity}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">{e.entity_type}</Badge>
                  <span className="text-muted-foreground text-[10px]">{e.reason_code}</span>
                  <span className="truncate flex-1 text-muted-foreground">{e.description ?? "—"}</span>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" className="h-6 w-6" title="Triage"
                      onClick={() => resolve.mutate({ id: e.id, action: "triage" })}
                      disabled={resolve.isPending}>
                      <Copy className="h-3 w-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6 text-green-600" title="Resolve"
                      onClick={() => resolve.mutate({ id: e.id, action: "resolve" })}
                      disabled={resolve.isPending}>
                      <Check className="h-3 w-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" title="Reject"
                      onClick={() => resolve.mutate({ id: e.id, action: "reject" })}
                      disabled={resolve.isPending}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
