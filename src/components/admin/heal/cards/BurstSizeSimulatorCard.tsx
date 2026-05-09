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
      </CardContent>
    </Card>
  );
}
