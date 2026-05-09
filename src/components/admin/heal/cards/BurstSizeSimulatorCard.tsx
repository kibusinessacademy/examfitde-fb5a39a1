import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Save, Trash2 } from "lucide-react";

const STORAGE_KEY = "burst-sim-scenarios-v1";

type Scenario = {
  id: string;
  name: string;
  inputs: Inputs;
  result: number | null;
  saved_at: string;
};

type Inputs = {
  pending: number;
  failure_rate_15m: number;
  reaper_churn_5m: number;
  lane: string;
  pool: string;
};

const LANES = ["any", "default", "control", "recovery", "tutor", "premium"];
const POOLS = ["default", "premium", "tutor"];

export function BurstSizeSimulatorCard() {
  const [inputs, setInputs] = useState<Inputs>({
    pending: 500,
    failure_rate_15m: 0.05,
    reaper_churn_5m: 0,
    lane: "any",
    pool: "default",
  });

  const result = useQuery({
    queryKey: ["burst-size-v2-sim", inputs],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "fn_adaptive_burst_size_v2" as any,
        {
          p_pending: inputs.pending,
          p_failure_rate_15m: inputs.failure_rate_15m,
          p_reaper_churn_5m: inputs.reaper_churn_5m,
          p_lane: inputs.lane === "any" ? null : inputs.lane,
          p_pool: inputs.pool,
        },
      );
      if (error) throw error;
      return data as number;
    },
  });

  const set = <K extends keyof Inputs>(k: K, v: Inputs[K]) =>
    setInputs((s) => ({ ...s, [k]: v }));

  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenarioName, setScenarioName] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setScenarios(JSON.parse(raw));
    } catch {}
  }, []);

  function persist(next: Scenario[]) {
    setScenarios(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }

  function saveScenario() {
    const name = scenarioName.trim() || `Szenario ${scenarios.length + 1}`;
    const next: Scenario[] = [
      ...scenarios,
      {
        id: crypto.randomUUID(),
        name,
        inputs: { ...inputs },
        result: result.data ?? null,
        saved_at: new Date().toISOString(),
      },
    ];
    persist(next);
    setScenarioName("");
    toast.success(`Szenario gespeichert: ${name}`);
  }

  function loadScenario(s: Scenario) {
    setInputs(s.inputs);
    toast(`Szenario geladen: ${s.name}`);
  }

  function deleteScenario(id: string) {
    persist(scenarios.filter((s) => s.id !== id));
  }

  const recommendation = result.data ?? null;
  const rationale = (() => {
    if (recommendation == null) return "";
    if (inputs.failure_rate_15m > 0.2) return "shedding: failure_rate > 20% halbiert burst";
    if (inputs.reaper_churn_5m > 5) return "shedding: reaper_churn > 5 halbiert burst";
    if (inputs.lane === "control") return "control-lane Cap (≤35)";
    if (inputs.lane === "recovery") return "recovery-lane Floor (≥35)";
    if (inputs.pool !== "default") return "non-default pool Cap (≤25)";
    if (inputs.pending < 100) return "low pending → kleiner burst";
    if (inputs.pending > 1000) return "high pending + healthy → großer burst";
    return "normaler burst";
  })();

  return (
    <Card data-testid="burst-size-simulator-card">
      <CardHeader>
        <CardTitle>Burst-Size Simulator (v2)</CardTitle>
        <p className="text-xs text-muted-foreground">
          Live-Test der Worker-Burst-Logik: pending + failure + churn + lane + pool → empfohlene burst_size.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <div>
            <Label className="text-xs">pending</Label>
            <Input
              type="number"
              value={inputs.pending}
              onChange={(e) => set("pending", parseInt(e.target.value || "0", 10))}
              className="h-8"
              data-testid="burst-input-pending"
            />
          </div>
          <div>
            <Label className="text-xs">failure_rate_15m</Label>
            <Input
              type="number"
              step="0.01"
              value={inputs.failure_rate_15m}
              onChange={(e) => set("failure_rate_15m", parseFloat(e.target.value || "0"))}
              className="h-8"
              data-testid="burst-input-failure"
            />
          </div>
          <div>
            <Label className="text-xs">reaper_churn_5m</Label>
            <Input
              type="number"
              value={inputs.reaper_churn_5m}
              onChange={(e) => set("reaper_churn_5m", parseInt(e.target.value || "0", 10))}
              className="h-8"
              data-testid="burst-input-churn"
            />
          </div>
          <div>
            <Label className="text-xs">lane</Label>
            <Select value={inputs.lane} onValueChange={(v) => set("lane", v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LANES.map((l) => (<SelectItem key={l} value={l}>{l}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">pool</Label>
            <Select value={inputs.pool} onValueChange={(v) => set("pool", v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {POOLS.map((p) => (<SelectItem key={p} value={p}>{p}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-3 p-3 rounded-md bg-muted/50">
          <div className="text-xs text-muted-foreground">Empfehlung:</div>
          <Badge variant="default" className="text-base font-mono px-3 py-1" data-testid="burst-recommendation">
            {result.isLoading ? "…" : recommendation ?? "—"}
          </Badge>
          <div className="text-xs text-muted-foreground">{rationale}</div>
        </div>

        <div className="mt-4 border-t pt-3 space-y-2" data-testid="burst-scenarios">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Szenario-Name"
              value={scenarioName}
              onChange={(e) => setScenarioName(e.target.value)}
              className="h-8 text-xs max-w-xs"
              data-testid="burst-scenario-name"
            />
            <Button size="sm" variant="outline" onClick={saveScenario} className="h-8">
              <Save className="h-3.5 w-3.5 mr-1" /> Speichern
            </Button>
          </div>
          {scenarios.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              Noch keine Szenarien gespeichert. Speichere Inputs+Empfehlung zum Vergleichen.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-1 px-1">Name</th>
                    <th className="text-right py-1 px-1">pending</th>
                    <th className="text-right py-1 px-1">fail%</th>
                    <th className="text-right py-1 px-1">churn</th>
                    <th className="text-left py-1 px-1">lane</th>
                    <th className="text-left py-1 px-1">pool</th>
                    <th className="text-right py-1 px-1">→ burst</th>
                    <th className="py-1 px-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {scenarios.map((s) => (
                    <tr key={s.id} className="border-b hover:bg-muted/30">
                      <td className="py-1 px-1">
                        <button
                          className="underline-offset-2 hover:underline text-left"
                          onClick={() => loadScenario(s)}
                          data-testid="burst-scenario-load"
                        >
                          {s.name}
                        </button>
                      </td>
                      <td className="text-right tabular-nums">{s.inputs.pending}</td>
                      <td className="text-right tabular-nums">{(s.inputs.failure_rate_15m * 100).toFixed(1)}</td>
                      <td className="text-right tabular-nums">{s.inputs.reaper_churn_5m}</td>
                      <td className="font-mono text-[10px]">{s.inputs.lane}</td>
                      <td className="font-mono text-[10px]">{s.inputs.pool}</td>
                      <td className="text-right">
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {s.result ?? "—"}
                        </Badge>
                      </td>
                      <td className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          onClick={() => deleteScenario(s.id)}
                          aria-label={`Szenario ${s.name} löschen`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
