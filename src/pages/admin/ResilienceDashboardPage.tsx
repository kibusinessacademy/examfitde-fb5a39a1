import { useQuery } from "@tanstack/react-query";
import { adminRpc } from "@/integrations/supabase/admin-rpc";
import { KpiCard } from "@/components/admin/cards/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, Trash2, Scale, RefreshCw } from "lucide-react";

export default function ResilienceDashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "resilience-dashboard"],
    queryFn: adminRpc.resilienceDashboard,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-destructive">
        Fehler beim Laden: {error instanceof Error ? error.message : "Unbekannt"}
      </div>
    );
  }

  const totals = data?.totals ?? {
    stale_recovered: 0,
    reaped: 0,
    blueprint_variants_pending: 0,
    other_pending: 0,
    blueprint_share_pct: 0,
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Resilience Ops</h1>
        <p className="text-sm text-muted-foreground">
          Dauermaßnahmen: Stale-Lock Recovery, Non-Building Reaper, Fan-Out Fairness
        </p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard
          label="Stale-Lock Recovered"
          value={totals.stale_recovered}
          hint="Jobs via Auto-Recovery wiederhergestellt"
          icon={<Shield className="h-4 w-4 text-primary" />}
        />
        <KpiCard
          label="Reaped Jobs"
          value={totals.reaped}
          hint="Non-Building Jobs automatisch bereinigt"
          icon={<Trash2 className="h-4 w-4 text-destructive" />}
        />
        <KpiCard
          label="Blueprint Variants"
          value={totals.blueprint_variants_pending}
          hint={`${totals.blueprint_share_pct}% Anteil an Pending-Queue`}
          icon={<Scale className="h-4 w-4 text-accent-foreground" />}
        />
        <KpiCard
          label="Andere Pending"
          value={totals.other_pending}
          hint="Nicht-Variant-Jobs in der Queue"
          icon={<Scale className="h-4 w-4 text-muted-foreground" />}
        />
      </div>

      {/* Fan-Out Fairness */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Scale className="h-4 w-4" />
            Fan-Out Claim Fairness
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {(data?.fanout_share ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Keine aktiven Jobs in der Queue.</p>
            ) : (
              <div className="space-y-2">
                {(data?.fanout_share ?? []).map((r, i) => {
                  const total = totals.blueprint_variants_pending + totals.other_pending;
                  const pct = total > 0 ? Math.round((r.cnt / total) * 100) : 0;
                  return (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant={r.category === "blueprint_variants" ? "secondary" : "outline"}>
                          {r.category}
                        </Badge>
                        <span className="text-muted-foreground">{r.status}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="h-2 w-24 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                        <span className="w-12 text-right font-mono">{r.cnt}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {totals.blueprint_share_pct > 60 && (
              <p className="mt-2 text-xs text-warning">
                ⚠ Blueprint-Variants belegen &gt;60% der Pending-Queue — Fan-Out-Cap prüfen.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Reaped Non-Building Jobs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Trash2 className="h-4 w-4" />
            Reaped Non-Building Jobs
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(data?.reaped_non_building ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine bereinigten Jobs — Reaper hatte nichts zu tun.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4">Job-Typ</th>
                    <th className="pb-2 pr-4">Tag</th>
                    <th className="pb-2 text-right">Anzahl</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.reaped_non_building ?? []).map((r, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-2 pr-4 font-mono text-xs">{r.job_type}</td>
                      <td className="py-2 pr-4">{r.day}</td>
                      <td className="py-2 text-right font-mono">{r.cnt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stale-Lock Recoveries */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4" />
            Stale-Lock Auto-Recoveries
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(data?.stale_recovery ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Stale-Lock-Recoveries — System läuft stabil.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4">Job-Typ</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 pr-4">Recoveries</th>
                    <th className="pb-2 pr-4">Tag</th>
                    <th className="pb-2 text-right">Anzahl</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.stale_recovery ?? []).map((r, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-2 pr-4 font-mono text-xs">{r.job_type}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={r.status === "completed" ? "default" : "secondary"}>
                          {r.status}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4 font-mono">{r.recovery_count}×</td>
                      <td className="py-2 pr-4">{r.day}</td>
                      <td className="py-2 text-right font-mono">{r.cnt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
