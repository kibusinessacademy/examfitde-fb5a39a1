/**
 * BuildIntegrityE2ECard — End-to-End Build-Integrity SSOT.
 * Zeigt pro Paket Step-Verteilung, Datenlücken, Vollständigkeit.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ListChecks, AlertTriangle } from "lucide-react";

interface Row {
  package_id: string;
  title: string;
  status: string;
  total_steps: number;
  done_steps: number;
  queued_steps: number;
  failed_steps: number;
  blocked_steps: number;
  pending_enqueue_steps: number;
  missing_step_keys: string[] | null;
  data_holes: number;
  completeness_pct: number | null;
  last_progress_at: string | null;
}

export function BuildIntegrityE2ECard() {
  const [filter, setFilter] = useState("");
  const q = useQuery({
    queryKey: ["build-integrity-e2e"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_build_integrity_e2e" as any, { p_limit: 200 });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 60_000,
  });

  const rows = (q.data ?? []).filter((r) =>
    filter ? r.title.toLowerCase().includes(filter.toLowerCase()) : true
  );

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <ListChecks className="h-4 w-4" /> E2E Build-Integrity
          <Badge variant="outline" className="text-[10px]">{q.data?.length ?? 0} Pakete</Badge>
        </h3>
        <Input
          placeholder="Filter..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-8 max-w-xs text-xs"
        />
      </div>

      {q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <TooltipProvider>
          <div className="overflow-x-auto max-h-[600px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b text-muted-foreground">
                  <th className="p-2 text-left">Paket</th>
                  <th className="p-2 text-center">Status</th>
                  <th className="p-2 text-center">Steps</th>
                  <th className="p-2 text-left">Fortschritt</th>
                  <th className="p-2 text-center">Datenlücken</th>
                  <th className="p-2 text-center">Fehlend</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.package_id} className="border-b hover:bg-muted/30">
                    <td className="p-2">
                      <div className="font-medium">{r.title}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">
                        {r.package_id.slice(0, 8)}
                      </div>
                    </td>
                    <td className="p-2 text-center">
                      <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                    </td>
                    <td className="p-2 text-center tabular-nums">
                      <Tooltip>
                        <TooltipTrigger>
                          {r.done_steps}/{r.total_steps}
                        </TooltipTrigger>
                        <TooltipContent>
                          done {r.done_steps} · queued {r.queued_steps} · failed {r.failed_steps} ·
                          blocked {r.blocked_steps} · pending {r.pending_enqueue_steps}
                        </TooltipContent>
                      </Tooltip>
                    </td>
                    <td className="p-2 w-32">
                      <div className="flex items-center gap-2">
                        <Progress value={r.completeness_pct ?? 0} className="h-2" />
                        <span className="tabular-nums text-[10px] w-10 text-right">
                          {r.completeness_pct?.toFixed(0) ?? 0}%
                        </span>
                      </div>
                    </td>
                    <td className="p-2 text-center">
                      {r.data_holes > 0 ? (
                        <Badge variant="destructive" className="text-[10px]">
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          {r.data_holes}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] border-green-500 text-green-700">ok</Badge>
                      )}
                    </td>
                    <td className="p-2 text-[10px] font-mono max-w-xs">
                      {(r.missing_step_keys?.length ?? 0) > 0 ? (
                        <Tooltip>
                          <TooltipTrigger className="text-destructive truncate">
                            {r.missing_step_keys?.length} fehlend
                          </TooltipTrigger>
                          <TooltipContent className="max-w-md">
                            {r.missing_step_keys?.join(", ")}
                          </TooltipContent>
                        </Tooltip>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TooltipProvider>
      )}
      <p className="text-[10px] text-muted-foreground mt-3">
        SSOT: <code>admin_build_integrity_e2e</code> — kanonische Step-Liste, Datenlücken =
        failed + blocked + fehlende Steps.
      </p>
    </Card>
  );
}
