import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export default function SyntheticProbeCenterPage() {
  const [summary, setSummary] = useState<any>(null);
  const [results, setResults] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [definitions, setDefinitions] = useState<any[]>([]);
  const [runLog, setRunLog] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    const [s, d, a] = await Promise.all([
      supabase.rpc("get_probe_health_summary"),
      supabase.from("system_probe_definitions").select("*").order("probe_scope"),
      supabase.from("system_probe_alerts").select("*").eq("status", "open").order("created_at", { ascending: false }).limit(50),
    ]);

    const summaryData = s.data as any;
    setSummary(summaryData);
    setDefinitions(d.data || []);
    setAlerts(a.data || []);

    if (summaryData?.last_run_id) {
      const { data } = await supabase
        .from("system_probe_results")
        .select("*")
        .eq("probe_run_id", summaryData.last_run_id)
        .order("probe_scope");
      setResults(data || []);
    }
  }

  async function runProbes() {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("system-synthetic-probe-runner", {
      body: { run_type: "manual" },
    });
    setRunLog(error ? { error } : data);
    setLoading(false);
    await load();
  }

  useEffect(() => { load(); }, []);

  const statusColor = (s: string) =>
    s === "pass" ? "text-green-600" : s === "warn" ? "text-yellow-600" : "text-red-600";

  return (
    <div className="p-4 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Synthetic Probe Center</h1>
          <p className="text-sm text-muted-foreground">
            Cross-Layer E2E Probes, Golden Path Tests und Regression Snapshots
          </p>
        </div>
        <button
          className="px-4 py-2 rounded-md border bg-background hover:bg-accent"
          onClick={runProbes}
          disabled={loading}
        >
          {loading ? "Läuft..." : "Probes ausführen"}
        </button>
      </div>

      {/* Summary */}
      {summary?.has_run && (
        <div className="rounded-xl border p-4 grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
          <div><span className="text-muted-foreground">Status:</span> <span className="font-medium">{summary.status}</span></div>
          <div><span className="text-muted-foreground">Total:</span> {summary.total_probes}</div>
          <div className="text-green-600">Pass: {summary.passed_count}</div>
          <div className="text-yellow-600">Warn: {summary.warned_count}</div>
          <div className="text-red-600">Fail: {summary.failed_count} (crit: {summary.critical_failed_count})</div>
        </div>
      )}

      {runLog && (
        <pre className="rounded-xl border p-3 text-xs overflow-auto bg-muted/20 max-h-48">
          {JSON.stringify(runLog, null, 2)}
        </pre>
      )}

      {/* Results */}
      <div>
        <h2 className="font-medium mb-2">Letzte Ergebnisse</h2>
        <div className="space-y-2">
          {results.length === 0 && <p className="text-sm text-muted-foreground">Noch kein Run.</p>}
          {results.map((r: any) => (
            <div key={r.id} className="rounded-xl border p-3 text-sm flex items-start justify-between gap-2">
              <div>
                <span className={`font-medium ${statusColor(r.status)}`}>{r.status.toUpperCase()}</span>{" "}
                <span className="text-muted-foreground">{r.probe_scope}</span> · {r.probe_key}
                {r.message && <div className="text-xs text-muted-foreground mt-0.5">{r.message}</div>}
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">{r.latency_ms}ms</span>
            </div>
          ))}
        </div>
      </div>

      {/* Alerts */}
      <div>
        <h2 className="font-medium mb-2">Open Probe Alerts ({alerts.length})</h2>
        <div className="space-y-2">
          {alerts.map((a: any) => (
            <div key={a.id} className="rounded-xl border p-3 text-sm">
              <span className={`font-medium ${a.severity === "critical" ? "text-red-600" : "text-yellow-600"}`}>
                {a.severity}
              </span>{" "}
              {a.title}
              {a.message && <div className="text-xs text-muted-foreground">{a.message}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Definitions */}
      <div>
        <h2 className="font-medium mb-2">Probe Definitions ({definitions.length})</h2>
        <div className="space-y-2">
          {definitions.map((d: any) => (
            <div key={d.id} className="rounded-xl border p-3 text-sm flex justify-between">
              <div>
                {d.probe_key} · <span className="text-muted-foreground">{d.probe_scope} · {d.probe_type}</span>
              </div>
              <span className={d.is_enabled ? "text-green-600" : "text-muted-foreground"}>
                {d.is_enabled ? "aktiv" : "deaktiviert"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
