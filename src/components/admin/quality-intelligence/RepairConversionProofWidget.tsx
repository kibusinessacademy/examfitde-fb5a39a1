import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, TrendingUp, AlertCircle } from "lucide-react";

interface Sample {
  ts: string;
  jobs_completed: number;
  publishable_reached: number;
}

/**
 * KIMI.INTELLIGENCE.2 — Proof Window Widget
 * Pollt v_qil_repair_conversion_summary alle 60s und zeigt Delta seit Mount
 * (= Wave-1 Hotfix-Beweisfenster). Confirms jobs_completed > 0 und
 * publishable_delta ≥ 1.
 */
export function RepairConversionProofWidget() {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [latest, setLatest] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const { data, error } = await supabase
        .from("v_qil_repair_conversion_summary" as any)
        .select("*")
        .limit(1)
        .maybeSingle();
      if (cancelled || error || !data) return;
      const row: any = data;
      setLatest(row);
      setSamples((prev) => {
        const next = [
          ...prev,
          {
            ts: new Date().toISOString(),
            jobs_completed: Number(row.jobs_completed ?? 0),
            publishable_reached: Number(row.publishable_reached ?? 0),
          },
        ];
        return next.slice(-60);
      });
      setLoading(false);
    };
    tick();
    const iv = setInterval(tick, 60_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);

  const baseline = samples[0];
  const current = samples[samples.length - 1];
  const jobsDelta = baseline && current ? current.jobs_completed - baseline.jobs_completed : 0;
  const publishableDelta =
    baseline && current ? current.publishable_reached - baseline.publishable_reached : 0;
  const proofMet = (current?.jobs_completed ?? 0) > 0 && publishableDelta >= 1;

  return (
    <Card className={proofMet ? "border-emerald-500/50 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4" /> Wave-1 Proof Window
          <Badge variant={proofMet ? "default" : "secondary"} className="ml-2">
            {loading ? "lädt…" : proofMet ? "BEWEIS ERBRACHT" : "BEWEISFENSTER OFFEN"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {latest ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <div className="text-xs text-muted-foreground">jobs_completed</div>
              <div className="text-2xl font-semibold">{latest.jobs_completed ?? 0}</div>
              <div className="text-xs text-emerald-600 flex items-center gap-1">
                <TrendingUp className="h-3 w-3" /> Δ +{jobsDelta} seit Mount
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">publishable_reached</div>
              <div className="text-2xl font-semibold">{latest.publishable_reached ?? 0}</div>
              <div className="text-xs text-emerald-600 flex items-center gap-1">
                <TrendingUp className="h-3 w-3" /> Δ +{publishableDelta} seit Mount
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">applied_repairs</div>
              <div className="text-2xl font-semibold">{latest.applied_repairs ?? 0}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">jobs_failed</div>
              <div className="text-2xl font-semibold text-red-600">{latest.jobs_failed ?? 0}</div>
            </div>
          </div>
        ) : (
          <div className="text-muted-foreground">Noch keine Messung…</div>
        )}

        {!proofMet && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground border-t pt-2">
            <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
            <span>
              Beweis erforderlich: <strong>jobs_completed &gt; 0</strong> UND{" "}
              <strong>publishable_delta ≥ 1</strong>. Cron-Snapshot in 8h automatisch.
              Polling-Intervall: 60s · Samples: {samples.length}/60.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
