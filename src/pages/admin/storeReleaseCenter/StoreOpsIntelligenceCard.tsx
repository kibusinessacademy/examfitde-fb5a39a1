// STORE.OPS.INTELLIGENCE.OS.1 — Admin card.
// Triggers analyze-store-ops; shows risk, confidence, top blockers/failures, trend, recommendations.
// No publish/submit/rollout buttons. No policy or gate mutations.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

type RunRow = {
  id: string;
  evaluated_at: string;
  risk_total: number;
  risk_level: string;
  risk_technical: number;
  risk_governance: number;
  risk_operational: number;
  confidence_score: number;
  recommendation_codes: string[];
  warnings: string[];
};

type FindingRow = {
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

export function StoreOpsIntelligenceCard() {
  const qc = useQueryClient();
  const [selectedRun, setSelectedRun] = useState<string | null>(null);

  const runs = useQuery({
    queryKey: ["store-ops-intelligence-runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("store_ops_intelligence_runs" as any)
        .select("*")
        .order("evaluated_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as unknown as RunRow[];
    },
  });

  const latest = runs.data?.[0];
  const activeRunId = selectedRun ?? latest?.id ?? null;

  const findings = useQuery({
    queryKey: ["store-ops-intelligence-findings", activeRunId],
    enabled: !!activeRunId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("store_ops_intelligence_findings" as any)
        .select("*")
        .eq("run_id", activeRunId)
        .order("kind", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as FindingRow[];
    },
  });

  const analyze = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("analyze-store-ops", { body: {} });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Intelligence-Analyse abgeschlossen");
      qc.invalidateQueries({ queryKey: ["store-ops-intelligence-runs"] });
    },
    onError: (e: any) => toast.error(`Analyse fehlgeschlagen: ${e.message ?? e}`),
  });

  const byKind = (kind: string) => (findings.data ?? []).filter((f) => f.kind === kind);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Store Operations Intelligence</CardTitle>
        <Button size="sm" onClick={() => analyze.mutate()} disabled={analyze.isPending}>
          {analyze.isPending ? "Analysiere…" : "Analyse starten"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {runs.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !latest ? (
          <p className="text-sm text-muted-foreground">Noch keine Intelligence-Analyse vorhanden.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Metric label="Risiko (gesamt)" value={`${latest.risk_total}`}>
                <Badge variant={RISK_VARIANT[latest.risk_level] ?? "outline"}>{latest.risk_level}</Badge>
              </Metric>
              <Metric label="Technisch" value={`${latest.risk_technical}`} />
              <Metric label="Governance" value={`${latest.risk_governance}`} />
              <Metric label="Operativ" value={`${latest.risk_operational}`} />
            </div>
            <div className="text-sm">
              Confidence: <strong>{(latest.confidence_score * 100).toFixed(1)} %</strong>
              {latest.warnings.length > 0 && (
                <span className="ml-2 text-amber-600">⚠ {latest.warnings.join(", ")}</span>
              )}
            </div>

            {findings.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FindingList title="Top Blocker" rows={byKind("top_blocker")} />
                <FindingList title="Häufigste Fehler" rows={byKind("top_failure")} />
                <FindingList title="Top Rejections" rows={byKind("top_rejection")} />
                <FindingList title="Trend" rows={byKind("trend")} showText />
              </div>
            )}

            <RecommendationsList rows={byKind("recommendation")} />

            <div className="text-xs text-muted-foreground">
              Letzte Läufe:
              <div className="mt-1 flex flex-wrap gap-2">
                {runs.data?.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setSelectedRun(r.id)}
                    className={`underline ${r.id === activeRunId ? "font-semibold" : ""}`}
                  >
                    {new Date(r.evaluated_at).toLocaleString("de-DE")}
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
        <span className="text-lg font-semibold">{value}</span>
        {children}
      </div>
    </div>
  );
}

function FindingList({ title, rows, showText }: { title: string; rows: FindingRow[]; showText?: boolean }) {
  return (
    <div>
      <div className="text-sm font-medium mb-1">{title}</div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Keine Daten.</p>
      ) : (
        <ul className="text-sm space-y-1">
          {rows.slice(0, 5).map((r) => (
            <li key={r.id} className="flex justify-between gap-2">
              <span className="truncate">{r.key}</span>
              <span className="text-muted-foreground">
                {showText ? `${r.value_text ?? ""} ${r.value_numeric ?? ""}` : r.value_numeric}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecommendationsList({ rows }: { rows: FindingRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="text-sm font-medium mb-2">Empfehlungen</div>
      <ul className="space-y-2">
        {rows.map((r) => {
          const d = r.detail as any;
          return (
            <li key={r.id} className="rounded-md border p-3">
              <div className="flex items-center justify-between">
                <div className="font-medium text-sm">{r.value_text ?? r.key}</div>
                <Badge variant="outline">{r.key}</Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">{d?.rationale}</p>
              <div className="mt-2 text-xs text-muted-foreground">
                Daten: {(d?.used_data ?? []).join(", ") || "—"}
              </div>
              <div className="text-xs text-muted-foreground">
                Muster: {(d?.detected_patterns ?? []).slice(0, 4).join(", ") || "—"}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
