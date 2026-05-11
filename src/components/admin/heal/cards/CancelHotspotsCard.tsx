/**
 * CancelHotspotsCard — Cancel-Cluster nach Step × Reason × Paket im Zeitfenster.
 * Ergänzt CancelReasonBreakdownCard um Paket-Hotspots, damit Healer-Bursts
 * (z.B. wiederholte STEP_ALREADY_DONE_PHANTOM auf demselben Paket) sofort sichtbar sind.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";

interface Row {
  job_type: string;
  reason_code: string;
  package_id: string;
  package_title: string | null;
  package_status: string | null;
  cnt: number;
  pct: number;
  first_seen: string;
  last_seen: string;
}

const HOUR_OPTIONS = [6, 24, 72, 168];

export function CancelHotspotsCard() {
  const [hours, setHours] = useState(24);

  const q = useQuery({
    queryKey: ["admin-cancel-hotspots", hours],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_cancel_hotspots" as any,
        { p_hours: hours, p_limit: 80 },
      );
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 60_000,
  });

  const total = (q.data ?? []).reduce((s, r) => s + Number(r.cnt), 0);
  const phantomBurst = (q.data ?? []).filter(
    (r) => r.reason_code === "STEP_ALREADY_DONE_PHANTOM" && Number(r.cnt) >= 3,
  ).length;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Flame className="h-4 w-4" /> Cancel-Hotspots
          <span className="text-muted-foreground font-normal">
            · {total} cancels · per Paket
          </span>
          {phantomBurst > 0 && (
            <Badge
              variant="outline"
              className="text-[10px] border-destructive text-destructive"
            >
              {phantomBurst} Phantom-Bursts (≥3)
            </Badge>
          )}
        </h3>
        <div className="flex gap-1">
          {HOUR_OPTIONS.map((h) => (
            <Button
              key={h}
              size="sm"
              variant={hours === h ? "default" : "outline"}
              className="h-6 px-2 text-[10px]"
              onClick={() => setHours(h)}
            >
              {h}h
            </Button>
          ))}
        </div>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : (q.data ?? []).length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">
          Keine Cancellations in den letzten {hours}h.
        </p>
      ) : (
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {q.data!.map((r, i) => {
            const isPhantom = r.reason_code === "STEP_ALREADY_DONE_PHANTOM";
            const isUnknown = r.reason_code === "UNCLASSIFIED";
            const isBurst = isPhantom && Number(r.cnt) >= 3;
            return (
              <div
                key={i}
                className={cn(
                  "flex items-center justify-between text-xs px-2 py-1.5 rounded border gap-3",
                  isBurst && "border-destructive bg-destructive-bg-subtle",
                  !isBurst && isPhantom && "border-destructive/30",
                  isUnknown && "border-warning/40 bg-warning-bg-subtle",
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[11px] truncate">
                    {r.job_type}
                  </div>
                  <div
                    className={cn(
                      "text-[10px] uppercase tracking-wide",
                      isPhantom
                        ? "text-destructive"
                        : isUnknown
                        ? "text-warning-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {r.reason_code}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                    <span className="font-mono">
                      {r.package_id.slice(0, 8)}
                    </span>
                    {r.package_title ? ` · ${r.package_title}` : ""}
                    {r.package_status ? (
                      <Badge
                        variant="outline"
                        className="ml-1 text-[9px] py-0 px-1 h-3.5"
                      >
                        {r.package_status}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <div className="text-right tabular-nums">
                  <div className="font-bold">{r.cnt}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {r.pct}%
                  </div>
                  <div className="text-[9px] text-muted-foreground">
                    {new Date(r.last_seen).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
