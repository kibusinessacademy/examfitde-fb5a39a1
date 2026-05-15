/**
 * FailedJobHotloopsCard — Failed-Job Hotloop Cockpit
 * ───────────────────────────────────────────────────
 * Zeigt (package, job_type, error_code) mit ≥5 Failures in 24h.
 * Quarantine-Aktion stoppt den Loop sofort (cancel + step skip + audit).
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, ShieldAlert, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type Hotloop = {
  package_id: string;
  package_title: string | null;
  job_type: string;
  error_code: string;
  fail_count: number;
  last_failed_at: string;
  first_failed_at: string;
  last_error_text: string | null;
  quarantined: boolean;
};

export function FailedJobHotloopsCard() {
  const qc = useQueryClient();

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["failed-job-hotloops-24h"],
    queryFn: async (): Promise<Hotloop[]> => {
      const { data, error } = await supabase.rpc("admin_get_failed_job_hotloops_24h");
      if (error) throw error;
      return (data ?? []) as Hotloop[];
    },
    refetchInterval: 60_000,
  });

  const quarantine = useMutation({
    mutationFn: async (row: Hotloop) => {
      const { data, error } = await supabase.rpc("admin_quarantine_job_hotloop", {
        p_package_id: row.package_id,
        p_job_type: row.job_type,
        p_reason: `ui_quarantine:${row.error_code}`,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (res: any, row) => {
      toast.success(
        `Quarantine gesetzt — ${row.job_type}`,
        { description: `${res?.cancelled ?? 0} Jobs cancelled, ${res?.steps_steps_skipped ?? res?.steps_skipped ?? 0} Steps skipped` }
      );
      qc.invalidateQueries({ queryKey: ["failed-job-hotloops-24h"] });
    },
    onError: (e: any) => toast.error("Quarantine fehlgeschlagen", { description: e?.message }),
  });

  const rows = data ?? [];
  const above20 = rows.filter((r) => r.fail_count >= 20).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-status-warning-fg" />
          Failed-Job Hotloops (24h)
          <Badge variant="outline" className="ml-2">{rows.length}</Badge>
          {above20 > 0 && (
            <Badge className="bg-destructive text-destructive-foreground">
              {above20} ≥ 20 Fehler
            </Badge>
          )}
          <Button
            variant="ghost" size="sm" className="ml-auto"
            onClick={() => refetch()} disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-text-muted text-sm">Lade …</div>
        ) : rows.length === 0 ? (
          <div className="text-text-muted text-sm">Keine Hotloops in den letzten 24h.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Paket</TableHead>
                <TableHead>Job-Type</TableHead>
                <TableHead>Fehlercode</TableHead>
                <TableHead className="text-right">Fehler</TableHead>
                <TableHead>Letzter Fehler</TableHead>
                <TableHead className="text-right">Aktion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.package_id}-${r.job_type}-${r.error_code}`}>
                  <TableCell className="max-w-[220px]">
                    <div className="font-medium truncate" title={r.package_title ?? r.package_id}>
                      {r.package_title ?? "—"}
                    </div>
                    <div className="text-xs text-text-muted font-mono truncate">{r.package_id}</div>
                  </TableCell>
                  <TableCell><code className="text-xs">{r.job_type}</code></TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-xs">{r.error_code}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge className={r.fail_count >= 20 ? "bg-destructive text-destructive-foreground" : "bg-status-warning-bg-subtle text-status-warning-fg"}>
                      {r.fail_count}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[280px]">
                    <div className="text-xs truncate" title={r.last_error_text ?? ""}>
                      {r.last_error_text ?? "—"}
                    </div>
                    <div className="text-[10px] text-text-muted">
                      {new Date(r.last_failed_at).toLocaleString()}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {r.quarantined ? (
                      <Badge className="bg-status-info-bg-subtle text-status-info-fg">quarantined</Badge>
                    ) : (
                      <Button
                        size="sm" variant="outline"
                        onClick={() => quarantine.mutate(r)}
                        disabled={quarantine.isPending}
                      >
                        <ShieldAlert className="h-3.5 w-3.5 mr-1.5" />
                        Quarantine
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
