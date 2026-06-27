// STORE.OPS.AUTOPILOT.OS.1 — Admin Autopilot card.
// Plan-only or safe-execute orchestration. No publish/submit/rollout.
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import type { AutopilotMode } from "@/lib/storeOpsAutopilot";

type RunRow = {
  id: string;
  mode: string;
  state: string;
  risk_score: number;
  risk_level: string;
  safe_count: number;
  manual_count: number;
  blocked_count: number;
  succeeded: number;
  failed: number;
  estimated_runtime_seconds: number;
  recommended_sequence: string[];
  next_manual_step: string | null;
  evaluated_at: string;
};

const RISK_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  low: "default",
  medium: "secondary",
  high: "destructive",
  critical: "destructive",
};

export function StoreOpsAutopilotCard() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<AutopilotMode>("recommend_only");

  const runs = useQuery({
    queryKey: ["store-ops-autopilot-runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("store_ops_autopilot_runs" as any)
        .select("*")
        .order("evaluated_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as unknown as RunRow[];
    },
  });

  const planMutation = useMutation({
    mutationFn: async (opts: { simulation: boolean }) => {
      const { data, error } = await supabase.functions.invoke("plan-store-autopilot", {
        body: { mode, simulation: opts.simulation },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Autopilot-Plan erzeugt");
      qc.invalidateQueries({ queryKey: ["store-ops-autopilot-runs"] });
    },
    onError: (e: any) => toast.error(`Plan fehlgeschlagen: ${e.message ?? e}`),
  });

  const runMutation = useMutation({
    mutationFn: async (runId: string) => {
      const { data, error } = await supabase.functions.invoke("run-store-autopilot", {
        body: { run_id: runId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Safe Run gestartet");
      qc.invalidateQueries({ queryKey: ["store-ops-autopilot-runs"] });
    },
    onError: (e: any) => toast.error(`Safe Run fehlgeschlagen: ${e.message ?? e}`),
  });

  const latest = useMemo(() => runs.data?.[0] ?? null, [runs.data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>StoreOps Autopilot</CardTitle>
        <p className="text-sm text-muted-foreground">
          Empfehlungen + sichere Operator-Aktionen. Niemals Veröffentlichen, Einreichen oder Ausrollen.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={mode} onValueChange={(v) => setMode(v as AutopilotMode)}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="disabled">Disabled</SelectItem>
              <SelectItem value="recommend_only">Recommend only</SelectItem>
              <SelectItem value="safe_execute">Safe execute</SelectItem>
              <SelectItem value="maintenance">Maintenance</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => planMutation.mutate({ simulation: false })} disabled={planMutation.isPending}>
            Plan erzeugen
          </Button>
          <Button variant="outline" onClick={() => planMutation.mutate({ simulation: true })} disabled={planMutation.isPending}>
            Simulation
          </Button>
          <Button
            variant="secondary"
            onClick={() => latest && runMutation.mutate(latest.id)}
            disabled={!latest || runMutation.isPending || latest.mode === "disabled" || latest.mode === "recommend_only" || latest.safe_count === 0}
          >
            Safe Run
          </Button>
          <Button variant="ghost" onClick={() => setMode("disabled")}>Autopilot deaktivieren</Button>
        </div>

        {runs.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !latest ? (
          <p className="text-sm text-muted-foreground">Noch kein Plan erstellt.</p>
        ) : (
          <div className="space-y-3 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline">Mode: {latest.mode}</Badge>
              <Badge variant={RISK_VARIANT[latest.risk_level] ?? "outline"}>
                Risk {latest.risk_score} ({latest.risk_level})
              </Badge>
              <Badge variant="outline">State: {latest.state}</Badge>
              <Badge variant="outline">~{latest.estimated_runtime_seconds}s</Badge>
            </div>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="rounded-md border p-2"><div className="text-muted-foreground">Safe</div><div className="text-xl font-semibold">{latest.safe_count}</div></div>
              <div className="rounded-md border p-2"><div className="text-muted-foreground">Manual</div><div className="text-xl font-semibold">{latest.manual_count}</div></div>
              <div className="rounded-md border p-2"><div className="text-muted-foreground">Blocked</div><div className="text-xl font-semibold">{latest.blocked_count}</div></div>
            </div>
            {latest.next_manual_step && (
              <div className="rounded-md bg-muted p-2 text-xs">
                <span className="font-medium">Next manual step:</span> {latest.next_manual_step}
              </div>
            )}
            {latest.recommended_sequence?.length > 0 && (
              <div className="text-xs text-muted-foreground">
                Sequenz: {latest.recommended_sequence.join(" → ")}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
