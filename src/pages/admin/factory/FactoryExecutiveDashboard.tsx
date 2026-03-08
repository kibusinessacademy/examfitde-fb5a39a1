import { useNavigate } from "react-router-dom";
import { RefreshCw, Factory, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useFactoryExecutiveReport } from "@/hooks/useFactoryExecutiveReport";

export default function FactoryExecutiveDashboard() {
  const navigate = useNavigate();
  const { data, isLoading, refetch } = useFactoryExecutiveReport();

  if (!data?.ok) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {isLoading ? "Lade Executive Report…" : "Kein Report verfügbar."}
      </div>
    );
  }

  const k = data;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Factory className="h-6 w-6" />
            Factory Executive Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            Gesamtübersicht der Produktionspipeline
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Top KPIs */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Active Waves</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">
            {k.waves_active} <span className="text-base text-muted-foreground">/ {k.waves_total}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Publish Rate</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{k.publish_rate_pct}%</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Block Rate</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{k.block_rate_pct}%</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">AI Cost (24h)</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">€{k.ai_cost_24h_eur}</CardContent>
        </Card>
      </div>

      {/* Pipeline Load */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Building</CardTitle></CardHeader>
          <CardContent className="text-lg font-semibold">{k.packages_building}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Queued</CardTitle></CardHeader>
          <CardContent className="text-lg font-semibold">{k.packages_queued}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Pending Jobs</CardTitle></CardHeader>
          <CardContent className="text-lg font-semibold">{k.pending_jobs}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Failed Jobs (1h)</CardTitle></CardHeader>
          <CardContent className="text-lg font-semibold text-destructive">{k.failed_jobs_1h}</CardContent>
        </Card>
      </div>

      {/* Auto-Heal + Totals */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Items Total</CardTitle></CardHeader>
          <CardContent className="text-lg font-semibold">{k.items_total}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Published</CardTitle></CardHeader>
          <CardContent className="text-lg font-semibold">{k.published_total}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Auto-Heal (24h)</CardTitle></CardHeader>
          <CardContent className="text-lg font-semibold">
            {k.auto_heal_24h} <span className="text-sm text-muted-foreground">({k.auto_heal_success_24h} ok)</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">AI Calls (24h)</CardTitle></CardHeader>
          <CardContent className="text-lg font-semibold">{k.ai_calls_24h}</CardContent>
        </Card>
      </div>

      {/* Model Usage */}
      <Card>
        <CardHeader><CardTitle>Model / Provider Usage (24h)</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(k.model_usage || []).map((p: any) => (
            <div key={p.model} className="flex items-center justify-between rounded border p-2 text-sm">
              <div className="font-medium truncate max-w-[250px]">{p.model}</div>
              <div className="text-muted-foreground text-xs">
                {p.calls} calls · €{p.cost_eur} · {p.avg_latency_ms}ms
              </div>
            </div>
          ))}
          {(!k.model_usage || k.model_usage.length === 0) && (
            <div className="text-sm text-muted-foreground">Keine AI-Daten (24h).</div>
          )}
        </CardContent>
      </Card>

      {/* Recent Waves */}
      <Card>
        <CardHeader><CardTitle>Recent Waves</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(k.waves || []).map((w: any) => (
            <div key={w.id} className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between rounded border p-2 text-sm">
              <div className="font-medium">{w.name}</div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{w.status}</Badge>
                <Badge variant="outline">target: {w.target_count}</Badge>
                <Badge variant="outline">published: {w.published_count ?? 0}</Badge>
                <Badge variant="outline">blocked: {w.blocked_count ?? 0}</Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigate(`/admin/production/detail?wave=${w.id}`)}
                >
                  <Eye className="mr-1 h-3 w-3" />
                  Detail
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
