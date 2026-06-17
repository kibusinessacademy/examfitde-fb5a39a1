import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

type Q = {
  id: string;
  package_id: string;
  reason_code: string;
  reason_detail: string | null;
  attempts_before: number | null;
  qualification_severity: string | null;
  council_verdict: string | null;
  status: string;
  quarantined_at: string;
  released_at: string | null;
};

type AuditRow = {
  id: string;
  action_type: string;
  target_id: string | null;
  target_type: string | null;
  metadata: any;
  created_at: string;
};

export function QuarantineCockpitCard() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["quarantine-ledger-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("package_quarantine_ledger")
        .select("*")
        .in("status", ["quarantined", "under_review"])
        .order("quarantined_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Q[];
    },
    refetchInterval: 30_000,
  });

  const { data: audit } = useQuery({
    queryKey: ["quarantine-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("auto_heal_log")
        .select("id,action_type,target_id,target_type,metadata,created_at")
        .ilike("action_type", "%quarantine%")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
    refetchInterval: 60_000,
  });

  async function release(packageId: string) {
    const reason = window.prompt("Release-Grund (Pflicht)?");
    if (!reason) return;
    const { error } = await supabase.rpc("fn_package_quarantine_release" as any, {
      p_package_id: packageId,
      p_release_reason: reason,
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Released");
      refetch();
    }
  }

  function ageMinutes(iso: string) {
    return Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quarantäne-Cockpit</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Lade…</p>
        ) : !data?.length ? (
          <p className="text-sm text-muted-foreground">Keine aktiven Quarantänen.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Package</TableHead>
                  <TableHead>Grund</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Alter</TableHead>
                  <TableHead>Aktion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Badge variant={r.status === "quarantined" ? "destructive" : "secondary"}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{r.qualification_severity ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.package_id.slice(0, 8)}</TableCell>
                    <TableCell className="text-xs max-w-[280px]">
                      <div className="font-mono">{r.reason_code}</div>
                      {r.reason_detail && (
                        <div className="text-muted-foreground truncate" title={r.reason_detail}>
                          {r.reason_detail}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{r.attempts_before ?? "—"}</TableCell>
                    <TableCell className="text-xs">{ageMinutes(r.quarantined_at)} min</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => release(r.package_id)}>
                        Release
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Audit-Historie</h3>
          {!audit?.length ? (
            <p className="text-sm text-muted-foreground">Keine Einträge.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {audit.map((a) => (
                <li key={a.id} className="flex items-start gap-2 border-b pb-1">
                  <Badge variant="outline">{a.action_type}</Badge>
                  {a.target_id && (
                    <span className="font-mono text-muted-foreground">
                      {a.target_type ?? "ref"}:{String(a.target_id).slice(0, 8)}
                    </span>
                  )}
                  <span className="ml-auto text-muted-foreground">
                    {new Date(a.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
