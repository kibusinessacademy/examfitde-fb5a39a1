/**
 * RetryLoopTabContent — Inhalt für Queue-Cockpit Tab "Retry-Loops"
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { RefreshCcw, Bell } from "lucide-react";
import { SingleJobRecoveryButton } from "@/components/admin/heal/SingleJobRecoveryButton";

interface LoopRow {
  job_id: string;
  package_id: string | null;
  job_type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  last_error_code: string | null;
  updated_at: string;
  age_seconds: number;
  guard_condition: string;
  involved_function: string;
}

const guardSeverity = (g: string): "destructive" | "warning" | "secondary" => {
  if (g.includes("HEALER_REGRESSION") || g.includes("PRODUCER_EVIDENCE")) return "destructive";
  if (g.includes("REQUEUE_LOOP") || g.includes("STALE_PROCESSING")) return "warning";
  return "secondary";
};

export function RetryLoopTabContent() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["retry-loop-candidates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_retry_loop_candidates" as never)
        .select("*")
        .order("attempts", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as LoopRow[];
    },
    refetchInterval: 60_000,
  });

  const detect = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("detect_retry_loops");
      if (error) throw error;
      return data as Array<{ job_id: string; notified: boolean }>;
    },
    onSuccess: (rows) => {
      const fresh = rows.filter((r) => r.notified).length;
      toast({
        title: "Detection complete",
        description: `${rows.length} loop(s) found, ${fresh} new notification(s) sent.`,
      });
      qc.invalidateQueries({ queryKey: ["retry-loop-candidates"] });
    },
    onError: (e) => {
      toast({
        title: "Detection failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCcw className="h-4 w-4 mr-1.5" /> Refresh
        </Button>
        <Button size="sm" onClick={() => detect.mutate()} disabled={detect.isPending}>
          <Bell className="h-4 w-4 mr-1.5" />
          {detect.isPending ? "Detecting…" : "Run Detection & Notify"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Active loop candidates {data ? `(${data.length})` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
          {data && data.length === 0 && (
            <div className="text-sm text-muted-foreground py-6 text-center">
              No deterministic retry loops detected. ✅
            </div>
          )}
          {data && data.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job Type</TableHead>
                    <TableHead className="text-right">Attempts</TableHead>
                    <TableHead>Guard Condition</TableHead>
                    <TableHead>Last Error</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((r) => (
                    <TableRow key={r.job_id}>
                      <TableCell>
                        <code className="text-xs">{r.job_type}</code>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline">
                          {r.attempts}/{r.max_attempts}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            guardSeverity(r.guard_condition) as "destructive" | "secondary"
                          }
                        >
                          {r.guard_condition}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-md">
                        <div className="text-xs truncate" title={r.last_error ?? ""}>
                          {r.last_error ?? "—"}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {new Date(r.updated_at).toLocaleString("de-DE")}
                      </TableCell>
                      <TableCell className="text-right">
                        <SingleJobRecoveryButton jobId={r.job_id} size="sm" label="Recover" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
