import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";

type Config = {
  decay_tau_days: number;
  ewma_alpha: number;
  confidence_sample_anchor: number;
  repair_threshold: number;
  drill_threshold: number;
  reinforce_threshold: number;
  decay_alert_threshold: number;
  updated_at: string;
};

type DecayRow = {
  day: number;
  mastery_score: number;
  decay_score: number;
  exam_readiness: number;
};

type PathRow = {
  step: number;
  days_since_prev: number;
  correct: boolean;
  mastery_score: number;
  confidence: number;
  decay_score: number;
  exam_readiness: number;
};

const DAYS_DEFAULT = [0, 1, 3, 7, 14, 21, 30, 45, 60];

export default function MasteryEngineSimulatorPage() {
  const qc = useQueryClient();

  const cfg = useQuery({
    queryKey: ["mastery-engine-config"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_mastery_engine_config" as any,
      );
      if (error) throw error;
      return data as Config;
    },
  });

  const [draft, setDraft] = useState<Partial<Config>>({});
  const merged = { ...(cfg.data ?? {}), ...draft } as Config | undefined;

  const update = useMutation({
    mutationFn: async (d: Partial<Config>) => {
      const { data, error } = await supabase.rpc(
        "admin_update_mastery_engine_config" as any,
        {
          p_decay_tau_days: d.decay_tau_days ?? null,
          p_ewma_alpha: d.ewma_alpha ?? null,
          p_confidence_sample_anchor: d.confidence_sample_anchor ?? null,
          p_repair_threshold: d.repair_threshold ?? null,
          p_drill_threshold: d.drill_threshold ?? null,
          p_reinforce_threshold: d.reinforce_threshold ?? null,
          p_decay_alert_threshold: d.decay_alert_threshold ?? null,
        },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: "Config gespeichert" });
      setDraft({});
      qc.invalidateQueries({ queryKey: ["mastery-engine-config"] });
    },
    onError: (e: Error) =>
      toast({ title: "Fehler", description: e.message, variant: "destructive" }),
  });

  // Decay simulator
  const [initialMastery, setInitialMastery] = useState(100);
  const [tauOverride, setTauOverride] = useState<number | "">("");
  const decay = useQuery({
    queryKey: ["mastery-decay-sim", initialMastery, tauOverride],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_simulate_mastery_decay" as any,
        {
          p_initial_mastery: initialMastery,
          p_days_array: DAYS_DEFAULT,
          p_tau_override: tauOverride === "" ? null : Number(tauOverride),
        },
      );
      if (error) throw error;
      return (data ?? []) as DecayRow[];
    },
  });

  // Path simulator
  const [pathInput, setPathInput] = useState(
    JSON.stringify(
      [
        { correct: true, days_since_prev: 0 },
        { correct: true, days_since_prev: 2 },
        { correct: false, days_since_prev: 1 },
        { correct: true, days_since_prev: 3 },
        { correct: true, days_since_prev: 7 },
      ],
      null,
      2,
    ),
  );
  const [pathTau, setPathTau] = useState<number | "">("");
  const [pathAlpha, setPathAlpha] = useState<number | "">("");
  const path = useQuery({
    queryKey: ["mastery-path-sim", pathInput, pathTau, pathAlpha],
    queryFn: async () => {
      let attempts: unknown[];
      try {
        attempts = JSON.parse(pathInput);
      } catch {
        return [] as PathRow[];
      }
      const { data, error } = await supabase.rpc(
        "admin_simulate_mastery_path" as any,
        {
          p_attempts: attempts,
          p_tau_override: pathTau === "" ? null : Number(pathTau),
          p_alpha_override: pathAlpha === "" ? null : Number(pathAlpha),
          p_anchor_override: null,
        },
      );
      if (error) throw error;
      return (data ?? []) as PathRow[];
    },
  });

  const NumberField = ({
    label,
    field,
  }: {
    label: string;
    field: keyof Config;
  }) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        step="0.01"
        value={(merged?.[field] as number | undefined) ?? ""}
        onChange={(e) =>
          setDraft({ ...draft, [field]: parseFloat(e.target.value) })
        }
        className="h-8 text-sm"
      />
    </div>
  );

  return (
    <div className="space-y-4 p-4 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold">Mastery Engine Simulator</h1>
        <p className="text-sm text-muted-foreground">
          Live-Config der Lern-Engine + Decay/Path Simulation
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Live Config
            {cfg.data?.updated_at ? (
              <Badge variant="outline" className="text-[10px]">
                updated {new Date(cfg.data.updated_at).toLocaleString("de-DE")}
              </Badge>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {cfg.isLoading ? (
            <p className="text-sm text-muted-foreground">Lade…</p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <NumberField label="τ (decay days)" field="decay_tau_days" />
                <NumberField label="α (EWMA)" field="ewma_alpha" />
                <NumberField
                  label="Confidence anchor"
                  field="confidence_sample_anchor"
                />
                <NumberField label="Decay alert <" field="decay_alert_threshold" />
                <NumberField label="REPAIR <" field="repair_threshold" />
                <NumberField label="DRILL <" field="drill_threshold" />
                <NumberField label="REINFORCE <" field="reinforce_threshold" />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => update.mutate(draft)}
                  disabled={!Object.keys(draft).length || update.isPending}
                >
                  Speichern
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDraft({})}
                  disabled={!Object.keys(draft).length}
                >
                  Zurücksetzen
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Decay-Simulator</CardTitle>
          <p className="text-xs text-muted-foreground">
            Wie verfällt eine Mastery von X über die Tage (mit τ-Override)?
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 mb-3 items-end">
            <div>
              <Label className="text-xs">Initial Mastery</Label>
              <Input
                type="number"
                value={initialMastery}
                onChange={(e) => setInitialMastery(parseFloat(e.target.value))}
                className="h-8 w-24"
              />
            </div>
            <div>
              <Label className="text-xs">τ Override (leer = Live)</Label>
              <Input
                type="number"
                value={tauOverride}
                onChange={(e) =>
                  setTauOverride(e.target.value === "" ? "" : parseFloat(e.target.value))
                }
                className="h-8 w-24"
                placeholder={String(cfg.data?.decay_tau_days ?? 14)}
              />
            </div>
          </div>
          {decay.data?.length ? (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={decay.data}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="mastery_score" stroke="hsl(var(--chart-1))" />
                  <Line type="monotone" dataKey="decay_score" stroke="hsl(var(--chart-3))" />
                  <Line
                    type="monotone"
                    dataKey="exam_readiness"
                    stroke="hsl(var(--chart-2))"
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Keine Daten.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Path-Simulator</CardTitle>
          <p className="text-xs text-muted-foreground">
            JSON-Liste von Attempts {`{correct, days_since_prev}`} simulieren — vergleicht
            Mastery, Confidence, Readiness pro Schritt.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <div className="md:col-span-1">
              <Label className="text-xs">Attempts (JSON)</Label>
              <textarea
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                className="w-full h-48 text-xs font-mono p-2 border rounded-md bg-background"
              />
            </div>
            <div className="md:col-span-2 space-y-3">
              <div className="flex gap-3">
                <div>
                  <Label className="text-xs">τ Override</Label>
                  <Input
                    type="number"
                    value={pathTau}
                    onChange={(e) =>
                      setPathTau(
                        e.target.value === "" ? "" : parseFloat(e.target.value),
                      )
                    }
                    className="h-8 w-24"
                    placeholder={String(cfg.data?.decay_tau_days ?? 14)}
                  />
                </div>
                <div>
                  <Label className="text-xs">α Override</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={pathAlpha}
                    onChange={(e) =>
                      setPathAlpha(
                        e.target.value === "" ? "" : parseFloat(e.target.value),
                      )
                    }
                    className="h-8 w-24"
                    placeholder={String(cfg.data?.ewma_alpha ?? 0.3)}
                  />
                </div>
              </div>
              {path.data?.length ? (
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={path.data}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="step" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line
                        type="monotone"
                        dataKey="mastery_score"
                        stroke="hsl(var(--chart-1))"
                      />
                      <Line
                        type="monotone"
                        dataKey="confidence"
                        stroke="hsl(var(--chart-4))"
                      />
                      <Line
                        type="monotone"
                        dataKey="decay_score"
                        stroke="hsl(var(--chart-3))"
                      />
                      <Line
                        type="monotone"
                        dataKey="exam_readiness"
                        stroke="hsl(var(--chart-2))"
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">JSON parsen fehlgeschlagen oder leer.</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
