import { useMemo, useState } from "react";
import { RefreshCw, Play, Pause, RotateCw, CheckCircle2, Factory, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useProductionWaveStatus, useSeedProductionWave, useWaveAction } from "@/hooks/useProductionWaves";
import { useRunProductionSupervisor, useRunWaveBackpressure } from "@/hooks/useProductionSupervisor";

export default function ProductionWavesPage() {
  const { data, isLoading, refetch } = useProductionWaveStatus();
  const seedWave = useSeedProductionWave();
  const waveAction = useWaveAction();
  const runSupervisor = useRunProductionSupervisor();

  const [name, setName] = useState(`Wave ${new Date().toISOString().slice(0, 10)}`);
  const [limit, setLimit] = useState(5);
  const [maxConcurrent, setMaxConcurrent] = useState(8);
  const [priorityMin, setPriorityMin] = useState(1);
  const [priorityMax, setPriorityMax] = useState(10);
  const [dryRun, setDryRun] = useState(true);

  const waves = data?.waves ?? [];
  const health = data?.global_health ?? {};

  const activeWave = useMemo(
    () => waves.find((w: any) => ["active", "paused", "draft", "seeding"].includes(w.status)),
    [waves],
  );

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Factory className="h-6 w-6" />
            Production Waves
          </h1>
          <p className="text-sm text-muted-foreground">
            Seed, activate, überwachen und finalisieren von Produktionswellen
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => runSupervisor.mutate()}
            disabled={runSupervisor.isPending}
          >
            <Zap className="mr-2 h-4 w-4" />
            Supervisor Run
          </Button>
          <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Aktualisieren
          </Button>
        </div>
      </div>

      {/* Global Health KPIs */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Building</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{health.packages_building ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Queued</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{health.packages_queued ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Pending Jobs</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{health.pending_jobs ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Failed Jobs 1h</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{health.failed_jobs_1h ?? 0}</CardContent>
        </Card>
      </div>

      {/* Seed new wave */}
      <Card>
        <CardHeader>
          <CardTitle>Neue Welle anlegen</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Limit</Label>
            <Input type="number" value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
          </div>
          <div className="space-y-2">
            <Label>Max Concurrent</Label>
            <Input type="number" value={maxConcurrent} onChange={(e) => setMaxConcurrent(Number(e.target.value))} />
          </div>
          <div className="space-y-2">
            <Label>Priority Min</Label>
            <Input type="number" value={priorityMin} onChange={(e) => setPriorityMin(Number(e.target.value))} />
          </div>
          <div className="space-y-2">
            <Label>Priority Max</Label>
            <Input type="number" value={priorityMax} onChange={(e) => setPriorityMax(Number(e.target.value))} />
          </div>
          <div className="flex items-end gap-2">
            <Button
              variant="outline"
              onClick={() =>
                seedWave.mutate({
                  name,
                  limit,
                  max_concurrent: maxConcurrent,
                  priority_min: priorityMin,
                  priority_max: priorityMax,
                  dry_run: true,
                })
              }
              disabled={seedWave.isPending}
            >
              Dry Run
            </Button>
            <Button
              onClick={() =>
                seedWave.mutate({
                  name,
                  limit,
                  max_concurrent: maxConcurrent,
                  priority_min: priorityMin,
                  priority_max: priorityMax,
                  dry_run: false,
                })
              }
              disabled={seedWave.isPending}
            >
              Wave anlegen
            </Button>
          </div>

          {seedWave.data && (
            <div className="md:col-span-3 rounded-lg border p-3 text-sm">
              <pre className="overflow-auto whitespace-pre-wrap">
                {JSON.stringify(seedWave.data, null, 2)}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active wave controls */}
      {activeWave && (
        <Card>
          <CardHeader>
            <CardTitle>Aktive / letzte Welle</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Badge>{activeWave.name}</Badge>
            <Badge variant="outline">{activeWave.status}</Badge>
            <Badge variant="outline">Target: {activeWave.target}</Badge>
            <Badge variant="outline">Seeded: {activeWave.seeded}</Badge>
            <Badge variant="outline">Published: {activeWave.published}</Badge>
            <Badge variant="outline">Blocked: {activeWave.blocked}</Badge>

            <Button
              size="sm"
              onClick={() => waveAction.mutate({ action: "activate", wave_id: activeWave.id })}
              disabled={waveAction.isPending}
            >
              <Play className="mr-2 h-4 w-4" />
              Aktivieren
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => waveAction.mutate({ action: "tick", wave_id: activeWave.id })}
              disabled={waveAction.isPending}
            >
              <RotateCw className="mr-2 h-4 w-4" />
              Tick
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => waveAction.mutate({ action: "pause", wave_id: activeWave.id })}
              disabled={waveAction.isPending}
            >
              <Pause className="mr-2 h-4 w-4" />
              Pause
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => waveAction.mutate({ action: "finalize", wave_id: activeWave.id })}
              disabled={waveAction.isPending}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Finalisieren
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Wave history */}
      <Card>
        <CardHeader>
          <CardTitle>Wellenhistorie</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {waves.length === 0 && (
            <p className="text-sm text-muted-foreground">Keine Wellen vorhanden.</p>
          )}
          {waves.map((wave: any) => (
            <div
              key={wave.id}
              className="rounded-lg border p-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{wave.name}</span>
                <Badge variant="outline">{wave.status}</Badge>
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                <span>Target: {wave.target}</span>
                <span>Seeded: {wave.seeded}</span>
                <span>Completed: {wave.completed}</span>
                <span>Published: {wave.published ?? 0}</span>
                <span>Failed: {wave.failed}</span>
                <span>Blocked: {wave.blocked ?? 0}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Action result */}
      {waveAction.data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Letztes Ergebnis</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-auto whitespace-pre-wrap text-sm rounded-lg border p-3">
              {JSON.stringify(waveAction.data, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Supervisor result */}
      {runSupervisor.data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Letzter Supervisor-Run</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-auto whitespace-pre-wrap text-xs rounded-lg border p-3">
              {JSON.stringify(runSupervisor.data, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
