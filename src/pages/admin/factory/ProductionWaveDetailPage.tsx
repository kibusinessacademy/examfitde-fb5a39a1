import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useProductionWaveDetail } from "@/hooks/useProductionWaveDetail";

const FILTERS = [
  "all",
  "pending",
  "queued",
  "building",
  "quality_gate_passed",
  "quality_gate_failed",
  "published",
  "blocked",
];

export default function ProductionWaveDetailPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const waveId = searchParams.get("wave");
  const status = searchParams.get("status") || "all";
  const [showJson, setShowJson] = useState(false);

  const { data, isLoading, refetch } = useProductionWaveDetail(
    waveId,
    status === "all" ? null : status,
  );

  const wave = data?.wave;
  const items = data?.items ?? [];
  const byStatus = data?.by_status ?? {};

  const terminalCount = useMemo(
    () =>
      (byStatus.published || 0) +
      (byStatus.blocked || 0) +
      (byStatus.quality_gate_passed || 0) +
      (byStatus.quality_gate_failed || 0),
    [byStatus],
  );

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => navigate("/admin/production")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Zurück
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">{wave?.name || "Wave Detail"}</h1>
            <p className="text-sm text-muted-foreground">
              Drilldown auf Items, Status und Finalreport
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Aktualisieren
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setShowJson((v) => !v)}>
            {showJson ? "JSON ausblenden" : "JSON anzeigen"}
          </Button>
        </div>
      </div>

      {/* Wave KPIs */}
      {wave && (
        <div className="grid gap-4 md:grid-cols-5">
          <Card>
            <CardHeader><CardTitle className="text-sm">Status</CardTitle></CardHeader>
            <CardContent className="text-lg font-semibold">{wave.status}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Target</CardTitle></CardHeader>
            <CardContent className="text-lg font-semibold">{wave.target_count ?? 0}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Seeded</CardTitle></CardHeader>
            <CardContent className="text-lg font-semibold">{wave.seeded_count ?? 0}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Terminal</CardTitle></CardHeader>
            <CardContent className="text-lg font-semibold">{terminalCount}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Max Concurrent</CardTitle></CardHeader>
            <CardContent className="text-lg font-semibold">{wave.max_concurrent ?? 0}</CardContent>
          </Card>
        </div>
      )}

      {/* Status filter */}
      <Card>
        <CardHeader><CardTitle>Status-Filter</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f}
              size="sm"
              variant={status === f ? "default" : "outline"}
              onClick={() => {
                if (!waveId) return;
                const next = new URLSearchParams();
                next.set("wave", waveId);
                next.set("status", f);
                setSearchParams(next);
              }}
            >
              {f}
            </Button>
          ))}
        </CardContent>
      </Card>

      {/* Status distribution */}
      <Card>
        <CardHeader><CardTitle>Status-Verteilung</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {Object.entries(byStatus).map(([k, v]) => (
            <Badge key={k} variant="outline">
              {k}: {String(v)}
            </Badge>
          ))}
        </CardContent>
      </Card>

      {/* Wave items */}
      <Card>
        <CardHeader><CardTitle>Wave Items ({items.length})</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {items.map((item: any) => (
            <div key={item.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="font-medium">{item.curriculum_title}</div>
                  <div className="text-sm text-muted-foreground">
                    Paket: {item.package_title || item.package_id || "–"}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge>{item.status}</Badge>
                  {item.package_status && <Badge variant="outline">pkg: {item.package_status}</Badge>}
                  {item.build_progress != null && (
                    <Badge variant="outline">progress: {item.build_progress}%</Badge>
                  )}
                  <Badge variant="outline">prio: {item.priority ?? 0}</Badge>
                </div>
              </div>

              {item.last_error && (
                <div className="text-sm text-destructive rounded border border-destructive/30 bg-destructive/5 p-2">
                  {item.last_error}
                </div>
              )}

              <div className="text-xs text-muted-foreground">
                started: {item.started_at || "–"} · finished: {item.finished_at || "–"} · published: {item.published_at || "–"}
              </div>
            </div>
          ))}

          {items.length === 0 && !isLoading && (
            <div className="text-sm text-muted-foreground">Keine Items gefunden.</div>
          )}
        </CardContent>
      </Card>

      {/* Final report from wave meta */}
      {wave?.meta?.final_report && (
        <Card>
          <CardHeader><CardTitle>Final Report</CardTitle></CardHeader>
          <CardContent>
            <pre className="overflow-auto whitespace-pre-wrap text-xs rounded-lg border p-3">
              {JSON.stringify(wave.meta.final_report, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Raw JSON export */}
      {showJson && (
        <Card>
          <CardHeader><CardTitle>Raw JSON</CardTitle></CardHeader>
          <CardContent>
            <pre className="overflow-auto whitespace-pre-wrap text-xs">
              {JSON.stringify(data, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
