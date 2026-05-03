import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search } from "lucide-react";

interface DrilldownRow {
  package_id: string;
  package_title: string | null;
  package_status: string | null;
  build_progress: number | null;
  alert_at: string;
  last_seen: string | null;
  event_count: number;
  apps: string[] | null;
  users: string[] | null;
  client_addrs: string[] | null;
  last_block_at: string | null;
  protection_reason: string | null;
  approved_questions: number | null;
  pending_tail_jobs: number | null;
  application_name: string | null;
  usename: string | null;
  client_addr: string | null;
  caller_query: string | null;
}

const fmt = (s?: string | null) =>
  s ? new Date(s).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

export function RevertProducerDrilldownCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["revert-producer-drilldown"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_revert_producer_drilldown" as never);
      if (error) throw error;
      return (data ?? []) as unknown as DrilldownRow[];
    },
    refetchInterval: 60_000,
  });

  return (
    <Card className="p-4 space-y-3 border-warning/40 bg-warning-bg-subtle">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-warning" />
        <h3 className="text-sm font-semibold">Forensik-Drilldown: letzte 20min Revert-Producer</h3>
        <Badge variant="outline" className="text-[10px]">{data?.length ?? 0}</Badge>
      </div>
      {isLoading ? (
        <Skeleton className="h-20" />
      ) : !data || data.length === 0 ? (
        <div className="text-xs text-muted-foreground py-3 text-center">
          ✅ Keine Revert-Producer in den letzten 20 Minuten.
        </div>
      ) : (
        <div className="space-y-2">
          {data.map((r) => (
            <div key={r.package_id} className="border border-border-subtle rounded-md p-2.5 text-xs space-y-1.5 bg-surface-1">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="font-semibold">
                  {r.package_title ?? r.package_id}
                  {r.build_progress !== null && (
                    <Badge variant="outline" className="ml-2 text-[10px]">
                      {r.build_progress}% · {r.package_status}
                    </Badge>
                  )}
                </div>
                <span className="font-mono text-muted-foreground">{fmt(r.last_seen)}</span>
              </div>
              <div className="font-mono text-[10px] text-muted-foreground break-all">{r.package_id}</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                <div>
                  <span className="text-muted-foreground">Producer:</span>{" "}
                  {(r.apps ?? []).join(",")} / {(r.users ?? []).join(",")}
                </div>
                <div>
                  <span className="text-muted-foreground">Client:</span>{" "}
                  {(r.client_addrs ?? []).join(", ") || "—"}
                </div>
                <div>
                  <span className="text-muted-foreground">Events:</span> {r.event_count}
                </div>
                <div>
                  <span className="text-muted-foreground">Letzter Block:</span> {fmt(r.last_block_at)}
                </div>
              </div>
              {r.protection_reason && (
                <div className="text-[11px]">
                  <span className="text-muted-foreground">Revert-Reason:</span>{" "}
                  <Badge variant="secondary" className="text-[10px]">{r.protection_reason}</Badge>{" "}
                  approved={r.approved_questions} · tail={r.pending_tail_jobs}
                </div>
              )}
              {r.caller_query && (
                <details className="text-[10px]">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    Caller-Query anzeigen
                  </summary>
                  <pre className="mt-1 p-2 bg-surface-2 rounded font-mono whitespace-pre-wrap break-all">
                    {r.caller_query}
                  </pre>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
