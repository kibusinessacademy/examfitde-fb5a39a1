import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldAlert, RefreshCw } from "lucide-react";

type SummaryRow = {
  drift_cause: string;
  severity: "critical" | "warn" | "info" | "ok";
  fix_scope: "platform" | "package";
  package_count: number;
};
type Summary = {
  generated_at: string;
  total_published_packages: number;
  by_cause: SummaryRow[];
};
type Pkg = {
  package_id: string;
  package_key: string;
  package_title: string;
  slug: string | null;
  drift_cause: string;
  severity: string;
  fix_scope: string;
  last_canonical_check: string | null;
  canonical_check_status: string | null;
};

const SEV: Record<string, string> = {
  critical: "bg-destructive-bg-subtle text-destructive",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  info: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};

export function CanonicalDriftRunbookCard() {
  const [cause, setCause] = useState<string | null>(null);

  const summary = useQuery({
    queryKey: ["canonical-drift-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_canonical_drift_summary" as any);
      if (error) throw error;
      return data as Summary;
    },
    refetchInterval: 60_000,
  });

  const drill = useQuery({
    queryKey: ["canonical-drift-pkgs", cause],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_canonical_drift_packages" as any, {
        _cause: cause,
        _severity: null,
        _limit: 50,
      });
      if (error) throw error;
      return (data ?? []) as Pkg[];
    },
    enabled: !!cause,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-primary" />
          Canonical Drift Runbook (2.3a, diagnose-only)
        </CardTitle>
        <Button size="sm" variant="outline" onClick={() => summary.refetch()} disabled={summary.isFetching}>
          {summary.isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Klassifiziert canonical-Drift pro published Paket. Plattform-Scope = 1 Fix für N Pakete.
          Per-Paket-Repair erst nach Reduktion der platform-Drifts.
        </p>

        {summary.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
        {summary.data && (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              Published: <b>{summary.data.total_published_packages}</b>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left py-1 pr-2">Ursache</th>
                    <th className="text-left py-1 pr-2">Severity</th>
                    <th className="text-left py-1 pr-2">Scope</th>
                    <th className="text-right py-1 pr-2">Pakete</th>
                    <th className="text-right py-1">Drill</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.data.by_cause.map((r) => (
                    <tr key={r.drift_cause} className="border-t border-border/40">
                      <td className="py-1 pr-2 font-mono">{r.drift_cause}</td>
                      <td className="py-1 pr-2">
                        <Badge className={SEV[r.severity] ?? ""}>{r.severity}</Badge>
                      </td>
                      <td className="py-1 pr-2">
                        <Badge variant="outline">{r.fix_scope}</Badge>
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums">{r.package_count}</td>
                      <td className="py-1 text-right">
                        <Button
                          size="sm"
                          variant={cause === r.drift_cause ? "default" : "ghost"}
                          onClick={() => setCause(cause === r.drift_cause ? null : r.drift_cause)}
                        >
                          {cause === r.drift_cause ? "schließen" : "öffnen"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {cause && (
          <div className="mt-2 border-t border-border/40 pt-2">
            <div className="text-xs font-semibold mb-1">
              Drill-down: <span className="font-mono">{cause}</span>
            </div>
            {drill.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {drill.data && drill.data.length === 0 && (
              <div className="text-xs text-muted-foreground">Keine Pakete.</div>
            )}
            {drill.data && drill.data.length > 0 && (
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground sticky top-0 bg-background">
                    <tr>
                      <th className="text-left py-1 pr-2">package_key</th>
                      <th className="text-left py-1 pr-2">slug</th>
                      <th className="text-left py-1 pr-2">last_check</th>
                      <th className="text-left py-1">status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drill.data.map((p) => (
                      <tr key={p.package_id} className="border-t border-border/40">
                        <td className="py-1 pr-2 font-mono">{p.package_key}</td>
                        <td className="py-1 pr-2 font-mono">{p.slug ?? "—"}</td>
                        <td className="py-1 pr-2">
                          {p.last_canonical_check ? new Date(p.last_canonical_check).toLocaleString() : "—"}
                        </td>
                        <td className="py-1">{p.canonical_check_status ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default CanonicalDriftRunbookCard;
