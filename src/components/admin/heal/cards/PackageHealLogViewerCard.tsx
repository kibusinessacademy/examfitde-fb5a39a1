/**
 * PackageHealLogViewerCard — Per-Package Log-Viewer für auto_heal_log
 * Zeigt: action_type, reason, result, plus alle enqueued Jobs mit
 * payload.bronze_lock_override-Flag transparent.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";

export function PackageHealLogViewerCard() {
  const [pkgId, setPkgId] = useState("");
  const [data, setData] = useState<any>(null);

  const run = useMutation({
    mutationFn: async () => {
      if (!/^[0-9a-f-]{36}$/i.test(pkgId.trim())) throw new Error("Ungültige UUID");
      const { data, error } = await supabase.rpc(
        "admin_get_package_heal_log" as any,
        { p_package_id: pkgId.trim(), p_limit: 100 } as any,
      );
      if (error) throw error;
      return data as any;
    },
    onSuccess: (d) => {
      setData(d);
      toast.success(`${d.log_entries?.length ?? 0} Log + ${d.enqueued_jobs?.length ?? 0} Jobs`);
    },
    onError: (e: any) => toast.error(e.message ?? "Fehler"),
  });

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <ScrollText className="h-4 w-4" />
          Heal-Log Viewer (per Paket)
        </h3>
        <Badge variant="outline" className="text-[10px]">
          auto_heal_log + bronze_lock_override
        </Badge>
      </div>

      <div className="flex gap-2 mb-3">
        <Input
          value={pkgId}
          onChange={(e) => setPkgId(e.target.value)}
          placeholder="Package-UUID"
          className="text-xs font-mono"
        />
        <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
          Lade
        </Button>
      </div>

      {run.isPending && <Skeleton className="h-32 w-full" />}

      {data && (
        <div className="space-y-3 text-xs">
          <section>
            <div className="font-semibold mb-1">
              Auto-Heal Log ({data.log_entries?.length ?? 0})
            </div>
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {(data.log_entries ?? []).map((l: any) => (
                <div key={l.id} className="border rounded p-2 bg-muted/30">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px]">{l.action_type}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(l.created_at), { addSuffix: true, locale: de })}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <Badge variant={l.result_status === "ok" || l.result_status === "success"
                                    ? "default" : l.result_status === "skipped"
                                    ? "secondary" : "destructive"}
                           className="text-[10px]">
                      {l.result_status ?? "—"}
                    </Badge>
                    {l.trigger_source && (
                      <Badge variant="outline" className="text-[10px]">{l.trigger_source}</Badge>
                    )}
                    {l.duration_ms != null && (
                      <Badge variant="outline" className="text-[10px]">{l.duration_ms}ms</Badge>
                    )}
                  </div>
                  {l.reason && (
                    <div className="mt-1 text-[11px]"><span className="text-muted-foreground">reason:</span> {l.reason}</div>
                  )}
                  {l.result_detail && (
                    <div className="mt-1 text-[11px] text-muted-foreground">{l.result_detail}</div>
                  )}
                  {l.error_message && (
                    <div className="mt-1 text-[11px] text-destructive">⚠ {l.error_message}</div>
                  )}
                </div>
              ))}
              {(!data.log_entries || data.log_entries.length === 0) && (
                <div className="text-muted-foreground italic">Keine Einträge</div>
              )}
            </div>
          </section>

          <section>
            <div className="font-semibold mb-1">
              Enqueued Jobs (7 Tage, {data.enqueued_jobs?.length ?? 0})
            </div>
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {(data.enqueued_jobs ?? []).map((j: any) => (
                <div key={j.id} className="border rounded p-2 flex items-center gap-2">
                  <Badge variant={j.status === "completed" ? "default" :
                                   j.status === "failed" ? "destructive" :
                                   j.status === "cancelled" ? "secondary" : "outline"}
                         className="text-[10px] w-20 justify-center">{j.status}</Badge>
                  <span className="font-mono text-[11px] flex-1 truncate">{j.job_type}</span>
                  {j.bronze_lock_override && (
                    <Badge className="bg-amber-500/15 text-amber-700 text-[10px]">
                      bronze_lock_override
                    </Badge>
                  )}
                  {j.enqueue_source && (
                    <span className="text-[10px] text-muted-foreground font-mono">{j.enqueue_source}</span>
                  )}
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {formatDistanceToNow(new Date(j.created_at), { addSuffix: true, locale: de })}
                  </span>
                </div>
              ))}
              {(!data.enqueued_jobs || data.enqueued_jobs.length === 0) && (
                <div className="text-muted-foreground italic">Keine Jobs</div>
              )}
            </div>
          </section>
        </div>
      )}
    </Card>
  );
}
