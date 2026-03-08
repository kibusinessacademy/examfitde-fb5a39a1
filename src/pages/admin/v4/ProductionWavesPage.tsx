import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Rocket, Play, Pause, RotateCw, CheckCircle2, XCircle,
  AlertTriangle, Factory, Loader2, Eye, Package, Zap,
} from "lucide-react";

type Wave = {
  id: string;
  name: string;
  status: string;
  target: number;
  seeded: number;
  completed: number;
  failed: number;
  published: number;
  blocked: number;
  max_concurrent: number;
  started_at: string | null;
  finished_at: string | null;
};

type GlobalHealth = {
  packages_building: number;
  packages_queued: number;
  pending_jobs: number;
  failed_jobs_1h: number;
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  seeding: "bg-blue-500/20 text-blue-400",
  active: "bg-green-500/20 text-green-400",
  paused: "bg-yellow-500/20 text-yellow-400",
  completed: "bg-primary/20 text-primary",
  cancelled: "bg-destructive/20 text-destructive",
};

export default function ProductionWavesPage() {
  const { toast } = useToast();
  const [waves, setWaves] = useState<Wave[]>([]);
  const [health, setHealth] = useState<GlobalHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Seed form
  const [seedName, setSeedName] = useState("");
  const [seedLimit, setSeedLimit] = useState(5);
  const [seedTrack, setSeedTrack] = useState("AUSBILDUNG_VOLL");
  const [seedMaxConcurrent, setSeedMaxConcurrent] = useState(8);
  const [seedDryRun, setSeedDryRun] = useState(false);
  const [seedResult, setSeedResult] = useState<any>(null);

  const callSupervisor = useCallback(async (action: string, waveId?: string) => {
    const { data, error } = await supabase.functions.invoke("admin-production-supervisor", {
      body: { action, wave_id: waveId },
    });
    if (error) throw error;
    return data;
  }, []);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await callSupervisor("status");
      setWaves(data.waves || []);
      setHealth(data.global_health || null);
    } catch (e: any) {
      toast({ title: "Fehler", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [callSupervisor, toast]);

  const handleWaveAction = useCallback(async (action: string, waveId: string, label: string) => {
    setActionLoading(`${action}-${waveId}`);
    try {
      const data = await callSupervisor(action, waveId);
      toast({ title: `${label} erfolgreich`, description: JSON.stringify(data).slice(0, 200) });
      await loadStatus();
    } catch (e: any) {
      toast({ title: "Fehler", description: e.message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  }, [callSupervisor, toast, loadStatus]);

  const handleSeed = useCallback(async () => {
    setActionLoading("seed");
    try {
      const { data, error } = await supabase.functions.invoke("admin-seed-production-wave", {
        body: {
          name: seedName || `Wave ${new Date().toISOString().slice(0, 10)}`,
          limit: seedLimit,
          track: seedTrack || null,
          max_concurrent: seedMaxConcurrent,
          dry_run: seedDryRun,
        },
      });
      if (error) throw error;
      setSeedResult(data);
      if (!seedDryRun) {
        toast({ title: "Wave erstellt", description: `${data.seeded} Kurse geseeded` });
        await loadStatus();
      }
    } catch (e: any) {
      toast({ title: "Fehler", description: e.message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  }, [seedName, seedLimit, seedTrack, seedMaxConcurrent, seedDryRun, toast, loadStatus]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Factory className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Produktionswellen</h1>
            <p className="text-sm text-muted-foreground">Mass Course Factory — Orchestrierung & Monitoring</p>
          </div>
        </div>
        <Button onClick={loadStatus} disabled={loading} variant="outline">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
          <span className="ml-2">Laden</span>
        </Button>
      </div>

      {/* Global Health */}
      {health && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              <div className="text-2xl font-bold">{health.packages_building}</div>
              <div className="text-xs text-muted-foreground">Building</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              <div className="text-2xl font-bold">{health.packages_queued}</div>
              <div className="text-xs text-muted-foreground">Queued</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              <div className="text-2xl font-bold">{health.pending_jobs}</div>
              <div className="text-xs text-muted-foreground">Pending Jobs</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              <div className={`text-2xl font-bold ${health.failed_jobs_1h > 10 ? "text-destructive" : ""}`}>
                {health.failed_jobs_1h}
              </div>
              <div className="text-xs text-muted-foreground">Failed (1h)</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Seed New Wave */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Rocket className="h-5 w-5" />
            Neue Produktionswelle erstellen
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Name</label>
              <Input
                placeholder="Canary Wave 1"
                value={seedName}
                onChange={(e) => setSeedName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Limit</label>
              <Input
                type="number"
                value={seedLimit}
                onChange={(e) => setSeedLimit(Number(e.target.value))}
                min={1}
                max={500}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Track</label>
              <Input
                value={seedTrack}
                onChange={(e) => setSeedTrack(e.target.value)}
                placeholder="AUSBILDUNG_VOLL"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Max parallel</label>
              <Input
                type="number"
                value={seedMaxConcurrent}
                onChange={(e) => setSeedMaxConcurrent(Number(e.target.value))}
                min={1}
                max={30}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={() => { setSeedDryRun(true); handleSeed(); }}
              variant="outline"
              disabled={actionLoading === "seed"}
            >
              <Eye className="h-4 w-4 mr-1" />
              Preview
            </Button>
            <Button
              onClick={() => { setSeedDryRun(false); handleSeed(); }}
              disabled={actionLoading === "seed"}
            >
              {actionLoading === "seed"
                ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
                : <Zap className="h-4 w-4 mr-1" />}
              Wave erstellen
            </Button>
          </div>

          {seedResult && (
            <pre className="mt-3 p-3 bg-muted rounded-md text-xs overflow-auto max-h-60">
              {JSON.stringify(seedResult, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>

      {/* Active Waves */}
      {waves.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Wellen ({waves.length})</h2>
          {waves.map((w) => (
            <Card key={w.id} className="border-border">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold">{w.name}</span>
                    <Badge className={STATUS_COLORS[w.status] ?? "bg-muted"}>
                      {w.status}
                    </Badge>
                  </div>
                  <div className="flex gap-1">
                    {w.status === "draft" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleWaveAction("activate", w.id, "Aktiviert")}
                        disabled={!!actionLoading}
                      >
                        <Play className="h-3 w-3 mr-1" /> Start
                      </Button>
                    )}
                    {w.status === "active" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleWaveAction("tick", w.id, "Sync")}
                          disabled={!!actionLoading}
                        >
                          <RotateCw className="h-3 w-3 mr-1" /> Sync
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleWaveAction("pause", w.id, "Pausiert")}
                          disabled={!!actionLoading}
                        >
                          <Pause className="h-3 w-3 mr-1" /> Pause
                        </Button>
                      </>
                    )}
                    {w.status === "paused" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleWaveAction("activate", w.id, "Fortgesetzt")}
                        disabled={!!actionLoading}
                      >
                        <Play className="h-3 w-3 mr-1" /> Fortsetzen
                      </Button>
                    )}
                    {(w.status === "active" || w.status === "paused") && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleWaveAction("finalize", w.id, "Finalisiert")}
                        disabled={!!actionLoading}
                      >
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Abschließen
                      </Button>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mb-2">
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>{w.completed + w.published + w.failed + w.blocked} / {w.seeded || w.target}</span>
                    <span>
                      {w.seeded > 0
                        ? Math.round(((w.completed + w.published + w.failed + w.blocked) / w.seeded) * 100)
                        : 0}%
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden flex">
                    {w.published > 0 && (
                      <div
                        className="h-full bg-green-500"
                        style={{ width: `${(w.published / Math.max(w.seeded, 1)) * 100}%` }}
                      />
                    )}
                    {w.completed > 0 && (
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${(w.completed / Math.max(w.seeded, 1)) * 100}%` }}
                      />
                    )}
                    {w.failed > 0 && (
                      <div
                        className="h-full bg-yellow-500"
                        style={{ width: `${(w.failed / Math.max(w.seeded, 1)) * 100}%` }}
                      />
                    )}
                    {w.blocked > 0 && (
                      <div
                        className="h-full bg-destructive"
                        style={{ width: `${(w.blocked / Math.max(w.seeded, 1)) * 100}%` }}
                      />
                    )}
                  </div>
                </div>

                {/* Stats */}
                <div className="flex gap-4 text-xs">
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    {w.published} published
                  </span>
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-primary" />
                    {w.completed} passed
                  </span>
                  <span className="flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-yellow-500" />
                    {w.failed} failed
                  </span>
                  <span className="flex items-center gap-1">
                    <XCircle className="h-3 w-3 text-destructive" />
                    {w.blocked} blocked
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && waves.length === 0 && health === null && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Factory className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Klicke auf "Laden" um den aktuellen Status zu sehen</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
