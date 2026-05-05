/**
 * LaneDrilldownDialog — per-lane Drilldown.
 * Zeigt Paket-IDs, Job-Alter, Klassifikation (true_zombie / dag_waiting /
 * bronze_locked / manual_review / complete_published / fresh_pending).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface Row {
  lane: string;
  package_id: string;
  package_title: string | null;
  pkg_status: string | null;
  job_id: string;
  job_type: string;
  job_status: string;
  job_age_minutes: number;
  is_bronze: boolean;
  has_open_steps: boolean;
  open_step_count: number;
  classification:
    | "true_zombie"
    | "dag_waiting"
    | "bronze_locked"
    | "manual_review"
    | "complete_published"
    | "fresh_pending";
  reason: string;
}

const TONE: Record<Row["classification"], string> = {
  true_zombie: "border-destructive/50 text-destructive",
  dag_waiting: "border-blue-500/40 text-blue-700 dark:text-blue-300",
  bronze_locked: "border-amber-500/40 text-amber-700 dark:text-amber-300",
  manual_review: "border-amber-500/40 text-amber-700 dark:text-amber-300",
  complete_published: "border-green-500/40 text-green-700 dark:text-green-400",
  fresh_pending: "border-muted text-muted-foreground",
};

export function LaneDrilldownDialog({
  lane,
  open,
  onOpenChange,
}: {
  lane: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const q = useQuery({
    queryKey: ["lane-drilldown", lane],
    enabled: open && !!lane,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_lane_drilldown" as any,
        { p_lane: lane },
      );
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: open ? 30_000 : false,
  });

  const counts = (q.data ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.classification] = (acc[r.classification] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Lane Drilldown · <span className="font-mono">{lane}</span>
          </DialogTitle>
          <DialogDescription>
            Pro Job: Paket-ID, Status, Job-Alter, Klassifikation und Begründung.
            SSOT: <code>admin_get_lane_drilldown</code>.
          </DialogDescription>
        </DialogHeader>

        {/* Klassifikations-Counts */}
        <div className="flex flex-wrap gap-2 mb-2 text-xs">
          {Object.entries(counts).map(([k, v]) => (
            <Badge
              key={k}
              variant="outline"
              className={cn("text-[10px]", TONE[k as Row["classification"]])}
            >
              {k}: {v}
            </Badge>
          ))}
          {(q.data ?? []).length === 0 && !q.isLoading && (
            <span className="text-muted-foreground text-xs">
              Keine Pending-Jobs in dieser Lane.
            </span>
          )}
        </div>

        {q.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="overflow-x-auto max-h-[60vh]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b text-muted-foreground">
                  <th className="p-2 text-left">Paket</th>
                  <th className="p-2 text-left">Job</th>
                  <th className="p-2 text-center">Alter</th>
                  <th className="p-2 text-center">offene Steps</th>
                  <th className="p-2 text-left">Klassifikation</th>
                  <th className="p-2 text-left">Begründung</th>
                </tr>
              </thead>
              <tbody>
                {(q.data ?? []).map((r) => (
                  <tr key={r.job_id} className="border-b hover:bg-muted/30">
                    <td className="p-2">
                      <div className="font-medium truncate max-w-[18ch]">
                        {r.package_title ?? "—"}
                      </div>
                      <div className="text-[10px] text-muted-foreground font-mono">
                        {r.package_id?.slice(0, 8) ?? "—"} ·{" "}
                        <span>{r.pkg_status ?? "—"}</span>
                        {r.is_bronze && (
                          <Badge
                            variant="outline"
                            className="ml-1 text-[9px] border-amber-500 text-amber-700"
                          >
                            bronze
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="p-2">
                      <div className="font-mono text-[11px]">{r.job_type}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {r.job_status}
                      </div>
                    </td>
                    <td className="p-2 text-center tabular-nums">
                      {r.job_age_minutes}m
                    </td>
                    <td className="p-2 text-center tabular-nums">
                      {r.open_step_count}
                    </td>
                    <td className="p-2">
                      <Badge
                        variant="outline"
                        className={cn("text-[10px]", TONE[r.classification])}
                      >
                        {r.classification}
                      </Badge>
                    </td>
                    <td className="p-2 text-[11px] text-muted-foreground">
                      {r.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
