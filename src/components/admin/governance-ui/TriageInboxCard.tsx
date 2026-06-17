import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { useState } from "react";

type Score = {
  id: string;
  source_kind: string;
  source_id: string | null;
  package_id: string | null;
  rule_key: string;
  severity: string;
  composite_score: number | null;
  confidence: number | null;
  rationale: string | null;
  created_at: string;
};

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  ignore: 4,
};

function severityVariant(s: string): "destructive" | "default" | "secondary" | "outline" {
  if (s === "critical") return "destructive";
  if (s === "high") return "default";
  if (s === "medium") return "secondary";
  return "outline";
}

export function TriageInboxCard() {
  const [severityFilter, setSeverityFilter] = useState<string>("all");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["governance-triage-inbox", severityFilter],
    queryFn: async () => {
      let q = supabase
        .from("qualification_scores")
        .select("id,source_kind,source_id,package_id,rule_key,severity,composite_score,confidence,rationale,created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (severityFilter !== "all") q = q.eq("severity", severityFilter);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as Score[];
      rows.sort((a, b) => {
        const sa = SEVERITY_ORDER[a.severity] ?? 9;
        const sb = SEVERITY_ORDER[b.severity] ?? 9;
        if (sa !== sb) return sa - sb;
        return (b.composite_score ?? 0) - (a.composite_score ?? 0);
      });
      return rows;
    },
    refetchInterval: 30_000,
  });

  async function quarantine(pkg: string | null, reason: string) {
    if (!pkg) {
      toast.error("Kein package_id auf diesem Finding");
      return;
    }
    const { error } = await supabase.rpc("fn_package_quarantine" as any, {
      p_package_id: pkg,
      p_reason_code: reason,
      p_reason_detail: "Triage Inbox manual quarantine",
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Package quarantined");
      refetch();
    }
  }

  async function release(pkg: string | null) {
    if (!pkg) return;
    const reason = window.prompt("Release-Grund?");
    if (!reason) return;
    const { error } = await supabase.rpc("fn_package_quarantine_release" as any, {
      p_package_id: pkg,
      p_release_reason: reason,
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Released");
      refetch();
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle>Triage Inbox</CardTitle>
          <div className="flex gap-1">
            {["all", "critical", "high", "medium", "low"].map((s) => (
              <Button
                key={s}
                size="sm"
                variant={severityFilter === s ? "default" : "outline"}
                onClick={() => setSeverityFilter(s)}
              >
                {s}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Lade…</p>
        ) : !data?.length ? (
          <p className="text-sm text-muted-foreground">Keine Findings.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Severity</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Rule</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Package</TableHead>
                  <TableHead>Rationale</TableHead>
                  <TableHead>Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Badge variant={severityVariant(r.severity)}>{r.severity}</Badge>
                    </TableCell>
                    <TableCell>{r.composite_score?.toFixed(2) ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.rule_key}</TableCell>
                    <TableCell className="font-mono text-xs">{r.source_kind}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.package_id ? r.package_id.slice(0, 8) : "—"}
                    </TableCell>
                    <TableCell className="text-xs max-w-[280px] truncate" title={r.rationale ?? ""}>
                      {r.rationale ?? "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!r.package_id}
                          onClick={() => quarantine(r.package_id, r.rule_key)}
                        >
                          Quarantine
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!r.package_id}
                          onClick={() => release(r.package_id)}
                        >
                          Release
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
