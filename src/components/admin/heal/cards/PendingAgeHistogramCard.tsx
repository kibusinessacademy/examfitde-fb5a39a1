/**
 * PendingAgeHistogramCard — Verteilung des Alters wartender Jobs.
 * >24h Bucket markiert kritisch.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface Bucket {
  bucket: string;
  cnt: number;
  oldest_sec: number;
}

const ORDER = ["<5m", "5-30m", "30-60m", "1-6h", "6-24h", ">24h"];

function fmtSec(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function PendingAgeHistogramCard() {
  const q = useQuery({
    queryKey: ["admin-pending-age-histogram"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_pending_age_histogram" as any);
      if (error) throw error;
      return (data ?? []) as Bucket[];
    },
    refetchInterval: 30_000,
  });

  const max = Math.max(1, ...((q.data ?? []).map((b) => Number(b.cnt))));
  const total = (q.data ?? []).reduce((s, b) => s + Number(b.cnt), 0);
  const critical = (q.data ?? []).find((b) => b.bucket === ">24h");

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Clock className="h-4 w-4" /> Pending-Age Histogramm
          <span className="text-muted-foreground font-normal">· {total} Jobs</span>
        </h3>
        {critical && critical.cnt > 0 && (
          <Badge variant="destructive" className="text-[10px]">
            {critical.cnt} &gt;24h · oldest {fmtSec(critical.oldest_sec)}
          </Badge>
        )}
      </div>

      {q.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <div className="space-y-1.5">
          {ORDER.map((bk) => {
            const row = (q.data ?? []).find((b) => b.bucket === bk);
            const cnt = row ? Number(row.cnt) : 0;
            const pct = (cnt / max) * 100;
            const isCritical = bk === ">24h" && cnt > 0;
            const isWarn = bk === "6-24h" && cnt > 0;
            return (
              <div key={bk} className="flex items-center gap-2 text-xs">
                <div className="w-14 font-mono text-muted-foreground">{bk}</div>
                <div className="flex-1 h-5 rounded bg-muted/40 relative overflow-hidden">
                  <div
                    className={cn(
                      "h-full transition-all",
                      isCritical ? "bg-destructive" : isWarn ? "bg-warning" : "bg-primary/70",
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="w-12 text-right tabular-nums font-bold">{cnt}</div>
                <div className="w-12 text-right text-[10px] text-muted-foreground tabular-nums">
                  {row ? fmtSec(row.oldest_sec) : "—"}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
