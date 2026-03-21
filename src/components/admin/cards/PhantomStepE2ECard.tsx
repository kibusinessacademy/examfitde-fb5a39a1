import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { runPhantomStepE2ETest, type PhantomStepTestResult } from "@/lib/admin/runPhantomStepE2ETest";
import { CheckCircle, XCircle, AlertTriangle, SkipForward, Play, Loader2, Clock, Shield } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";

interface RunRow {
  id: string;
  test_run_id: string;
  mode: string;
  overall_pass: boolean;
  verdict: string;
  summary: { total: number; passed: number; failed: number; warned: number; skipped: number };
  layer_summary: Record<string, { total: number; passed: number; failed: number; warned: number; skipped: number }>;
  elapsed_ms: number;
  ssot_step_count: number;
  triggered_by: string;
  created_at: string;
}

export function PhantomStepE2ECard() {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();

  const { data: lastRun, isLoading } = useQuery({
    queryKey: ["phantom-step-e2e", "last-run"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("phantom_step_e2e_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as RunRow | null;
    },
    refetchInterval: 60_000,
  });

  const runMutation = useMutation({
    mutationFn: () => runPhantomStepE2ETest(),
    onSuccess: () => {
      toast.success("Phantom-Step E2E Test abgeschlossen");
      queryClient.invalidateQueries({ queryKey: ["phantom-step-e2e"] });
    },
    onError: (err: Error) => {
      toast.error(`E2E Test fehlgeschlagen: ${err.message}`);
    },
  });

  const summary = lastRun?.summary;
  const layers = lastRun?.layer_summary;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Phantom-Step E2E</h3>
          {lastRun && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
              lastRun.overall_pass
                ? "bg-emerald-500/10 text-emerald-500"
                : "bg-destructive/10 text-destructive"
            }`}>
              {lastRun.overall_pass ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
              {lastRun.overall_pass ? "PASS" : "FAIL"}
            </span>
          )}
        </div>
        <button
          onClick={() => runMutation.mutate()}
          disabled={runMutation.isPending}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
        >
          {runMutation.isPending
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <Play className="h-3 w-3" />}
          {runMutation.isPending ? "Läuft…" : "Jetzt testen"}
        </button>
      </div>

      {isLoading && <div className="text-xs text-muted-foreground animate-pulse">Laden…</div>}

      {lastRun && summary && (
        <>
          <div className="grid grid-cols-4 gap-2">
            <CountBadge icon={<CheckCircle className="h-3 w-3 text-emerald-500" />} label="Pass" count={summary.passed} />
            <CountBadge icon={<XCircle className="h-3 w-3 text-destructive" />} label="Fail" count={summary.failed} />
            <CountBadge icon={<AlertTriangle className="h-3 w-3 text-amber-500" />} label="Warn" count={summary.warned} />
            <CountBadge icon={<SkipForward className="h-3 w-3 text-muted-foreground" />} label="Skip" count={summary.skipped} />
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDistanceToNow(new Date(lastRun.created_at), { addSuffix: true, locale: de })}
            </span>
            <span>{lastRun.elapsed_ms}ms</span>
            <span className="capitalize">{lastRun.mode}</span>
            <span>{lastRun.triggered_by}</span>
            <span>{lastRun.ssot_step_count} SSOT-Steps</span>
          </div>

          <p className="text-xs font-medium text-foreground/80">{lastRun.verdict}</p>

          {layers && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-primary hover:underline"
            >
              {expanded ? "Layer-Details ausblenden" : "Layer-Details anzeigen"}
            </button>
          )}

          {expanded && layers && (
            <div className="space-y-1">
              {Object.entries(layers).map(([layer, s]) => (
                <div key={layer} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-1.5 text-xs">
                  <span className="font-mono text-foreground/70">{layer}</span>
                  <div className="flex gap-2">
                    {s.passed > 0 && <span className="text-emerald-500">{s.passed}✓</span>}
                    {s.failed > 0 && <span className="text-destructive">{s.failed}✗</span>}
                    {s.warned > 0 && <span className="text-amber-500">{s.warned}⚠</span>}
                    {s.skipped > 0 && <span className="text-muted-foreground">{s.skipped}⏭</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {!isLoading && !lastRun && (
        <p className="text-xs text-muted-foreground">Noch kein Testlauf vorhanden. Klicke „Jetzt testen".</p>
      )}
    </div>
  );
}

function CountBadge({ icon, label, count }: { icon: React.ReactNode; label: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-muted/30 px-2 py-1.5">
      {icon}
      <span className="text-xs font-medium">{count}</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}
