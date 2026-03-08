import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, RefreshCw, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useProductionWaveDetail } from "@/hooks/useProductionWaveDetail";
import WaveKpiBoard from "@/components/admin/factory/WaveKpiBoard";
import WaveItemList from "@/components/admin/factory/WaveItemList";

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
  const kpi = data?.kpi_report;

  const terminalCount = useMemo(
    () =>
      (byStatus.published || 0) +
      (byStatus.blocked || 0) +
      (byStatus.quality_gate_passed || 0) +
      (byStatus.quality_gate_failed || 0),
    [byStatus],
  );

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wave-${waveId}-report.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
          <Button variant="outline" size="sm" onClick={handleExport} disabled={!data}>
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
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

      {/* KPI Report Board */}
      <WaveKpiBoard kpi={kpi} />

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
      <WaveItemList items={items} isLoading={isLoading} />

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
