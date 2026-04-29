/**
 * CancelReasonBreakdownCard — Top Cancel-Reasons der letzten N Stunden.
 * Hebt UNCLASSIFIED hervor (Classifier-Lücke) und STEP_ALREADY_DONE_PHANTOM (Reentry-Bug).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Ban } from "lucide-react";
import { cn } from "@/lib/utils";

interface Row {
  job_type: string;
  reason_code: string;
  cnt: number;
  pct: number;
}

const HOUR_OPTIONS = [6, 24, 72, 168];

export function CancelReasonBreakdownCard() {
  const [hours, setHours] = useState(24);

  const q = useQuery({
    queryKey: ["admin-cancel-reason", hours],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_cancel_reason_breakdown" as any,
        { p_hours: hours },
      );
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 60_000,
  });

  const total = (q.data ?? []).reduce((s, r) => s + Number(r.cnt), 0);
  const unclassified = (q.data ?? []).filter(r => r.reason_code === "UNCLASSIFIED")
    .reduce((s, r) => s + Number(r.cnt), 0);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Ban className="h-4 w-4" /> Cancel-Reasons
          <span className="text-muted-foreground font-normal">· {total} cancels</span>
          {unclassified > 0 && (
            <Badge variant="outline" className="text-[10px] border-warning text-warning-foreground">
              {unclassified} UNCLASSIFIED · Classifier-Lücke
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
        <div className="space-y-1 max-h-80 overflow-y-auto">
          {q.data!.map((r, i) => {
            const isPhantom = r.reason_code === "STEP_ALREADY_DONE_PHANTOM";
            const isUnknown = r.reason_code === "UNCLASSIFIED";
            return (
              <div
                key={i}
                className={cn(
                  "flex items-center justify-between text-xs px-2 py-1.5 rounded border",
                  isPhantom && "border-destructive/40 bg-destructive/5",
                  isUnknown && "border-warning/40 bg-warning/5",
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-mono truncate">{r.job_type}</div>
                  <div className={cn(
                    "text-[10px] uppercase tracking-wide",
                    isPhantom ? "text-destructive" : isUnknown ? "text-warning-foreground" : "text-muted-foreground",
                  )}>
                    {r.reason_code}
                  </div>
                </div>
                <div className="text-right tabular-nums ml-3">
                  <div className="font-bold">{r.cnt}</div>
                  <div className="text-[10px] text-muted-foreground">{r.pct}%</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
