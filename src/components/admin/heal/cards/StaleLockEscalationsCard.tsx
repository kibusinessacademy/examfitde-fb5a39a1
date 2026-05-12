import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Row = {
  job_id: string;
  job_type: string;
  package_id: string | null;
  package_key: string | null;
  package_title: string | null;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  recovery_count: number;
  reap_count: number;
  escalation_state: string;
  stale_seconds: number | null;
  updated_at: string;
};

const STATE_TONE: Record<string, string> = {
  HARD_KILLED: "bg-destructive-bg-subtle text-destructive border-destructive/30",
  EXHAUSTED_RECOVERY: "bg-destructive-bg-subtle text-destructive border-destructive/30",
  STALE_LONG: "bg-warning-bg-subtle text-warning border-warning/30",
  RECOVERING: "bg-info-bg-subtle text-info border-info/30",
  STALE_SHORT: "bg-info-bg-subtle text-info border-info/30",
  TERMINAL: "bg-muted text-muted-foreground border-border",
};

export function StaleLockEscalationsCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin_get_stale_lock_escalations"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_stale_lock_escalations");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 30_000,
  });

  const rows = data ?? [];
  const hardKilled = rows.filter((r) => r.escalation_state === "HARD_KILLED").length;
  const stale = rows.filter((r) => r.escalation_state.startsWith("STALE_")).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldAlert className="h-4 w-4 text-primary" />
          Stale-Lock Escalations
          {hardKilled > 0 && (
            <Badge variant="outline" className="text-[10px] bg-destructive-bg-subtle text-destructive border-destructive/30">
              {hardKilled} hard-killed
            </Badge>
          )}
          {stale > 0 && (
            <Badge variant="outline" className="text-[10px] bg-warning-bg-subtle text-warning border-warning/30">
              {stale} stale
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : rows.length === 0 ? (
          <div className="text-xs text-muted-foreground p-4 text-center">Keine Stale-Lock Eskalationen.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b">
                <tr className="text-left">
                  <th className="py-2 pr-2">State</th>
                  <th className="py-2 pr-2">Job-Typ</th>
                  <th className="py-2 pr-2">Paket</th>
                  <th className="py-2 pr-2 text-right">Att.</th>
                  <th className="py-2 pr-2 text-right">Recov.</th>
                  <th className="py-2 pr-2 text-right">Reap</th>
                  <th className="py-2 pr-2 text-right">Stale</th>
                  <th className="py-2 pr-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.job_id} className="border-b border-border/50 hover:bg-muted/40">
                    <td className="py-1.5 pr-2">
                      <Badge variant="outline" className={`text-[10px] ${STATE_TONE[r.escalation_state] ?? ""}`}>
                        {r.escalation_state}
                      </Badge>
                    </td>
                    <td className="py-1.5 pr-2 font-mono text-[10px]">{r.job_type}</td>
                    <td className="py-1.5 pr-2">
                      <div className="font-mono text-[10px] text-muted-foreground">{r.package_key ?? r.package_id?.slice(0, 8) ?? "—"}</div>
                      <div className="truncate max-w-[200px]">{r.package_title ?? "—"}</div>
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{r.attempts}/{r.max_attempts}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{r.recovery_count}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{r.reap_count}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-[10px]">
                      {r.stale_seconds != null ? `${Math.floor(r.stale_seconds / 60)}m` : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-[10px] text-muted-foreground">
                      {new Date(r.updated_at).toLocaleString("de-DE", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
