import { useSearchParams, useNavigate } from "react-router-dom";
import { AlertTriangle, RefreshCw, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useProductionWaveTriage, useProductionWaveTriageAction } from "@/hooks/useProductionWaveTriage";

const FILTERS = ["all", "blocked", "quality_gate_failed", "building", "queued"];

export default function ProductionWaveTriagePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const waveId = searchParams.get("wave");
  const status = searchParams.get("status") || "all";

  const { data, isLoading, refetch } = useProductionWaveTriage(
    waveId,
    status === "all" ? null : status,
  );
  const triageAction = useProductionWaveTriageAction();

  const items = data?.items || [];

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => navigate(`/admin/production/detail?wave=${waveId}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Zurück
          </Button>
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <AlertTriangle className="h-6 w-6" />
              Wave Triage Center
            </h1>
            <p className="text-sm text-muted-foreground">
              Blockierte und fehlgeschlagene Wave-Items gezielt bearbeiten
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Aktualisieren
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Filter</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f}
              size="sm"
              variant={status === f ? "default" : "outline"}
              onClick={() => {
                const next = new URLSearchParams();
                if (waveId) next.set("wave", waveId);
                next.set("status", f);
                setSearchParams(next);
              }}
            >
              {f}
            </Button>
          ))}
        </CardContent>
      </Card>

      <div className="space-y-4">
        {items.map((item: any) => (
          <Card key={item.wave_item_id}>
            <CardHeader>
              <CardTitle className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <span>{item.curriculum_title || item.curriculum_id}</span>
                <div className="flex flex-wrap gap-2">
                  <Badge>{item.wave_item_status}</Badge>
                  {item.package_status && <Badge variant="outline">pkg: {item.package_status}</Badge>}
                  <Badge variant="outline">prio: {item.priority}</Badge>
                  <Badge variant="outline">open: {item.open_jobs}</Badge>
                  <Badge variant="outline">failed: {item.failed_jobs}</Badge>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-sm text-muted-foreground">
                Paket: {item.package_title || item.package_id || "–"} · Progress: {item.build_progress ?? 0}%
              </div>

              {item.last_error && (
                <div className="rounded border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">
                  {item.last_error}
                </div>
              )}

              {item.failed_steps?.length > 0 && (
                <div className="rounded border p-2">
                  <div className="mb-2 text-sm font-medium">Failed Steps</div>
                  <div className="space-y-2">
                    {item.failed_steps.map((s: any, idx: number) => (
                      <div key={idx} className="text-xs rounded border p-2">
                        <div className="font-medium">{s.step_key}</div>
                        <div className="text-muted-foreground">{s.last_error || "–"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {item.failed_job_samples?.length > 0 && (
                <div className="rounded border p-2">
                  <div className="mb-2 text-sm font-medium">Failed Job Samples</div>
                  <div className="space-y-2">
                    {item.failed_job_samples.map((j: any, idx: number) => (
                      <div key={idx} className="text-xs rounded border p-2">
                        <div className="font-medium">{j.job_type}</div>
                        <div>attempts: {j.attempts}</div>
                        <div className="text-muted-foreground">{j.last_error || "–"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => triageAction.mutate({ waveItemId: item.wave_item_id, action: "retry" })}
                  disabled={triageAction.isPending}
                >
                  Retry
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => triageAction.mutate({ waveItemId: item.wave_item_id, action: "resume" })}
                  disabled={triageAction.isPending}
                >
                  Resume
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => triageAction.mutate({ waveItemId: item.wave_item_id, action: "skip" })}
                  disabled={triageAction.isPending}
                >
                  Skip
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}

        {items.length === 0 && !isLoading && (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              Keine Triage-Items gefunden.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
