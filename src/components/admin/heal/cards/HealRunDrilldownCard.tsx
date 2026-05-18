/**
 * HealRunDrilldownCard — Drill-Down pro Heal-Run.
 * Verschmilzt auto_heal_log + job_queue Events chronologisch in einer
 * Timeline. Zeigt Reihenfolge der Tail-Jobs, Statusübergänge,
 * Log-Lines + bronze_lock_override Flags zusammen.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GitMerge, ArrowDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import { de } from "date-fns/locale";

type Item = {
  at: string;
  kind: "heal_log" | "job_enqueued" | "job_finished";
  event: string;
  status: string | null;
  payload: Record<string, any>;
};

export function HealRunDrilldownCard() {
  const [pkgId, setPkgId] = useState("");
  const [hours, setHours] = useState("72");
  const [data, setData] = useState<any>(null);

  const run = useMutation({
    mutationFn: async () => {
      if (!/^[0-9a-f-]{36}$/i.test(pkgId.trim())) throw new Error("Ungültige UUID");
      const { data, error } = await supabase.rpc(
        "admin_get_heal_run_timeline" as any,
        { p_package_id: pkgId.trim(), p_window_hours: Number(hours), p_limit: 300 } as any,
      );
      if (error) throw error;
      return data as any;
    },
    onSuccess: (d) => {
      setData(d);
      toast.success(`${d.timeline?.length ?? 0} Events`);
    },
    onError: (e: any) => toast.error(e.message ?? "Fehler"),
  });

  const items: Item[] = data?.timeline ?? [];

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <GitMerge className="h-4 w-4" />
          Heal-Run Drilldown (Timeline)
        </h3>
        <Badge variant="outline" className="text-[10px]">log + jobs merged</Badge>
      </div>

      <div className="flex gap-2 mb-3">
        <Input
          value={pkgId}
          onChange={(e) => setPkgId(e.target.value)}
          placeholder="Package-UUID"
          className="text-xs font-mono"
        />
        <Select value={hours} onValueChange={setHours}>
          <SelectTrigger className="w-[100px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["6","24","72","168"].map((h) => <SelectItem key={h} value={h}>{h}h</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
          Lade
        </Button>
      </div>

      {run.isPending && <Skeleton className="h-48 w-full" />}

      {data && (
        <>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-3 text-xs">
            <Stat label="Logs" v={data.summary.log_entries} />
            <Stat label="Enqueued" v={data.summary.jobs_enqueued} />
            <Stat label="Done" v={data.summary.jobs_completed} tone="ok" />
            <Stat label="Cancel" v={data.summary.jobs_cancelled} tone="warn" />
            <Stat label="Failed" v={data.summary.jobs_failed} tone="bad" />
            <Stat label="Bronze-Override" v={data.summary.bronze_overrides} tone="warn" />
          </div>

          <div className="text-[11px] text-muted-foreground mb-2">
            Status: <span className="font-mono">{data.pkg_status}</span> · Progress: <span className="font-mono">{data.pkg_progress}%</span>
          </div>

          <div className="border-l-2 border-border ml-2 pl-3 space-y-2 max-h-[500px] overflow-y-auto">
            {items.map((it, i) => (
              <TimelineItem key={i} item={it} />
            ))}
            {items.length === 0 && (
              <div className="text-xs text-muted-foreground italic">Keine Events im Fenster.</div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function Stat({ label, v, tone }: { label: string; v: number; tone?: "ok" | "warn" | "bad" }) {
  const c = tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : tone === "bad" ? "text-destructive" : "";
  return (
    <div className="rounded border p-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`font-mono font-semibold ${c}`}>{v ?? 0}</div>
    </div>
  );
}

function TimelineItem({ item }: { item: Item }) {
  const dotColor =
    item.kind === "heal_log" ? "bg-blue-500" :
    item.kind === "job_enqueued" ? "bg-amber-500" :
    item.status === "completed" ? "bg-emerald-500" :
    item.status === "cancelled" ? "bg-muted-foreground" :
    item.status === "failed" ? "bg-destructive" : "bg-border";

  const reason = item.payload.reason ?? item.payload.detail ?? item.payload.last_error;
  const bronzeOverride = item.payload.bronze_lock_override;

  return (
    <div className="relative text-xs">
      <span className={`absolute -left-[17px] top-1.5 w-3 h-3 rounded-full ${dotColor} border-2 border-background`} />
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-mono text-[10px] text-muted-foreground whitespace-nowrap">
          {format(new Date(item.at), "HH:mm:ss")}
        </span>
        <Badge variant="outline" className="text-[9px] py-0">{item.kind}</Badge>
        <span className="font-mono text-[11px] font-semibold">{item.event}</span>
        {item.status && (
          <Badge
            className={`text-[9px] ${
              item.status === "completed" || item.status === "ok" || item.status === "success" ? "bg-emerald-500/15 text-emerald-700" :
              item.status === "failed" ? "bg-destructive-bg-subtle text-destructive" :
              item.status === "cancelled" || item.status === "skipped" ? "bg-muted text-muted-foreground" :
              "bg-amber-500/15 text-amber-700"
            }`}
          >{item.status}</Badge>
        )}
        {bronzeOverride && (
          <Badge className="bg-amber-500/15 text-amber-700 text-[9px]">bronze_override</Badge>
        )}
        {item.payload.lane && (
          <span className="text-[10px] font-mono text-muted-foreground">lane:{item.payload.lane}</span>
        )}
        {item.payload.duration_sec != null && (
          <span className="text-[10px] text-muted-foreground">{item.payload.duration_sec}s</span>
        )}
        {item.payload.duration_ms != null && (
          <span className="text-[10px] text-muted-foreground">{item.payload.duration_ms}ms</span>
        )}
      </div>
      {reason && (
        <div className="ml-3 mt-0.5 text-[11px] text-muted-foreground">{reason}</div>
      )}
      {item.payload.enqueue_source && (
        <div className="ml-3 text-[10px] font-mono text-muted-foreground">
          src: {item.payload.enqueue_source}
        </div>
      )}
    </div>
  );
}
