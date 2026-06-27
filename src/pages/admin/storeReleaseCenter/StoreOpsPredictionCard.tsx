// STORE.OPS.PREDICTION.OS.1 — Admin card.
// Triggers predict-store-ops; renders deterministic forecast, risk, confidence, factors.
// No execute/publish/submit/rollout buttons.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

type RunRow = {
  id: string;
  evaluated_at: string;
  operation_key: string;
  planned_action_types: string[];
  expected_manifest_count: number;
  success_probability: number;
  expected_failures: number;
  expected_blocked: number;
  expected_succeeded: number;
  expected_duration_seconds: number;
  expected_manual_interventions: number;
  queue_load_factor: number;
  risk_total: number;
  risk_level: string;
  risk_breakdown: Record<string, unknown>;
  confidence_score: number;
  confidence_breakdown: Record<string, unknown>;
  explainability: Record<string, unknown>;
  warnings: string[];
};

type ResultRow = {
  id: string;
  run_id: string;
  kind: string;
  key: string;
  value_numeric: number | null;
  value_text: string | null;
  detail: Record<string, unknown>;
};

const RISK_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  low: "default",
  medium: "secondary",
  high: "destructive",
  critical: "destructive",
};

const ALLOWED_ACTIONS = [
  "run_review_gate",
  "run_store_ops_kpi",
  "run_lifecycle_projection",
  "generate_listing",
  "enqueue_screenshots",
  "run_android_dry_build",
  "run_ios_dry_build",
  "create_release_candidate",
  "export_submission_package",
];

export function StoreOpsPredictionCard() {
  const qc = useQueryClient();
  const [opKey, setOpKey] = useState("autopilot:safe_execute");
  const [manifestCount, setManifestCount] = useState(10);
  const [actionsCsv, setActionsCsv] = useState(
    "run_review_gate,run_android_dry_build,run_ios_dry_build,create_release_candidate",
  );
  const [selectedRun, setSelectedRun] = useState<string | null>(null);

  const runs = useQuery({
    queryKey: ["store-ops-prediction-runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("store_ops_prediction_runs" as any)
        .select("*")
        .order("evaluated_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as unknown as RunRow[];
    },
  });

  const latest = runs.data?.[0];
  const activeRunId = selectedRun ?? latest?.id ?? null;

  const results = useQuery({
    queryKey: ["store-ops-prediction-results", activeRunId],
    enabled: !!activeRunId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("store_ops_prediction_results" as any)
        .select("*")
        .eq("run_id", activeRunId)
        .order("kind", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as ResultRow[];
    },
  });

  const predict = useMutation({
    mutationFn: async () => {
      const planned_action_types = actionsCsv
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && ALLOWED_ACTIONS.includes(s));
      const { data, error } = await supabase.functions.invoke("predict-store-ops", {
        body: {
          planned: {
            operation_key: opKey,
            planned_action_types,
            expected_manifest_count: manifestCount,
          },
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Prognose abgeschlossen");
      qc.invalidateQueries({ queryKey: ["store-ops-prediction-runs"] });
    },
    onError: (e: any) => toast.error(`Prognose fehlgeschlagen: ${e.message ?? e}`),
  });

  const byKind = (kind: string) => (results.data ?? []).filter((r) => r.kind === kind);
  const factors = byKind("influence_factor");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Store Operations Prediction</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label htmlFor="op-key">Operation</Label>
            <Input id="op-key" value={opKey} onChange={(e) => setOpKey(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="op-count">Erwartete Manifests</Label>
            <Input
              id="op-count"
              type="number"
              min={0}
              value={manifestCount}
              onChange={(e) => setManifestCount(Math.max(0, Number(e.target.value)))}
            />
          </div>
          <div>
            <Label htmlFor="op-actions">Geplante Aktionstypen (allow-listed)</Label>
            <Input id="op-actions" value={actionsCsv} onChange={(e) => setActionsCsv(e.target.value)} />
          </div>
        </div>
        <div>
          <Button size="sm" onClick={() => predict.mutate()} disabled={predict.isPending}>
            {predict.isPending ? "Analysiere…" : "Analyse starten"}
          </Button>
        </div>

        {runs.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !latest ? (
          <p className="text-sm text-muted-foreground">Noch keine Prognose vorhanden.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Metric label="Erfolgswahrscheinlichkeit" value={`${(latest.success_probability * 100).toFixed(1)} %`} />
              <Metric label="Risiko (gesamt)" value={`${latest.risk_total}`}>
                <Badge variant={RISK_VARIANT[latest.risk_level] ?? "outline"}>{latest.risk_level}</Badge>
              </Metric>
              <Metric label="Erwartete Dauer" value={formatDuration(latest.expected_duration_seconds)} />
              <Metric label="Confidence" value={`${(latest.confidence_score * 100).toFixed(1)} %`} />
              <Metric label="Erwartete Fehler" value={`${latest.expected_failures}`} />
              <Metric label="Erwartete Blocker" value={`${latest.expected_blocked}`} />
              <Metric label="Manuelle Eingriffe" value={`${latest.expected_manual_interventions}`} />
              <Metric label="Queue-Last (Faktor)" value={`${latest.queue_load_factor}`} />
            </div>
            {latest.warnings.length > 0 && (
              <div className="text-xs text-amber-600">⚠ {latest.warnings.join(", ")}</div>
            )}

            {results.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FindingList title="Erwartete Blocker" rows={byKind("expected_blocker")} />
                <FindingList title="Erwartete Rejections" rows={byKind("expected_rejection")} />
                <FindingList title="Erwartete Dauer pro Aktion" rows={byKind("expected_duration")} suffix=" s" />
                <FindingList title="Risiko-Komponenten" rows={byKind("risk_component")} showText />
              </div>
            )}

            {factors.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-2">Einflussfaktoren</div>
                <ul className="space-y-1 text-sm">
                  {factors.slice(0, 8).map((f) => (
                    <li key={f.id} className="flex justify-between gap-2 border rounded p-2">
                      <span className="truncate">
                        <strong>{f.key}</strong> — {(f.detail as any)?.explanation ?? ""}
                      </span>
                      <span className="text-muted-foreground">
                        {f.value_text} · w={f.value_numeric}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="text-xs text-muted-foreground">
              Letzte Läufe:
              <div className="mt-1 flex flex-wrap gap-2">
                {runs.data?.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setSelectedRun(r.id)}
                    className={`underline ${r.id === activeRunId ? "font-semibold" : ""}`}
                  >
                    {new Date(r.evaluated_at).toLocaleString("de-DE")} · {r.operation_key}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-base font-semibold">{value}</span>
        {children}
      </div>
    </div>
  );
}

function FindingList({
  title,
  rows,
  showText,
  suffix,
}: {
  title: string;
  rows: ResultRow[];
  showText?: boolean;
  suffix?: string;
}) {
  return (
    <div>
      <div className="text-sm font-medium mb-1">{title}</div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Keine Daten.</p>
      ) : (
        <ul className="text-sm space-y-1">
          {rows.slice(0, 8).map((r) => (
            <li key={r.id} className="flex justify-between gap-2">
              <span className="truncate">{r.key}</span>
              <span className="text-muted-foreground">
                {showText ? `${r.value_text ?? ""} (${r.value_numeric ?? ""})` : `${r.value_numeric ?? ""}${suffix ?? ""}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatDuration(sec: number): string {
  if (!sec) return "0 s";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${s} s`;
  return `${s} s`;
}
