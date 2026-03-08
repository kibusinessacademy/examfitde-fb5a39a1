import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export default function SchedulerGovernancePage() {
  const [audit, setAudit] = useState<any>(null);
  const [crons, setCrons] = useState<any[]>([]);
  const [runners, setRunners] = useState<any[]>([]);
  const [guardrails, setGuardrails] = useState<any[]>([]);
  const [retryPolicies, setRetryPolicies] = useState<any[]>([]);
  const [orphans, setOrphans] = useState<any[]>([]);
  const [executions, setExecutions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [runLog, setRunLog] = useState<any>(null);

  async function load() {
    const [c, r, g, rp, o, e] = await Promise.all([
      supabase.from("system_cron_registry").select("*").order("layer_key"),
      supabase.from("system_runner_registry").select("*").order("layer_key"),
      supabase.from("system_scheduler_guardrails").select("*").order("layer_key"),
      supabase.from("system_retry_policies").select("*").order("scope_type"),
      supabase.from("system_orphan_executions").select("*").eq("status", "open").order("created_at", { ascending: false }).limit(50),
      supabase.from("system_cron_executions").select("*").order("started_at", { ascending: false }).limit(30),
    ]);
    setCrons(c.data || []);
    setRunners(r.data || []);
    setGuardrails(g.data || []);
    setRetryPolicies(rp.data || []);
    setOrphans(o.data || []);
    setExecutions(e.data || []);
  }

  async function runAudit() {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("system-scheduler-guardrail-cron", { body: {} });
    setRunLog(error ? { error } : data);
    setLoading(false);
    await load();
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="p-4 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Scheduler Governance</h1>
          <p className="text-sm text-muted-foreground">
            Cron Registry, Runner, Retry Policies, Guardrails und Orphan Reaper
          </p>
        </div>
        <button className="px-4 py-2 rounded-md border bg-background hover:bg-accent" onClick={runAudit} disabled={loading}>
          {loading ? "Läuft..." : "Governance Audit"}
        </button>
      </div>

      {runLog && (
        <pre className="rounded-xl border p-3 text-xs overflow-auto bg-muted/20 max-h-48">
          {JSON.stringify(runLog, null, 2)}
        </pre>
      )}

      {/* Cron Registry */}
      <div>
        <h2 className="font-medium mb-2">Cron Registry ({crons.length})</h2>
        <div className="space-y-2">
          {crons.map((c: any) => (
            <div key={c.id} className="rounded-xl border p-3 text-sm flex justify-between">
              <div>
                <span className="font-medium">{c.cron_key}</span>
                <span className="text-muted-foreground"> · {c.layer_key} · {c.cadence_key} · {c.timeout_seconds}s</span>
              </div>
              <span className={c.is_enabled ? "text-green-600" : "text-muted-foreground"}>
                {c.is_enabled ? "aktiv" : "aus"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Executions */}
      <div>
        <h2 className="font-medium mb-2">Letzte Cron Executions ({executions.length})</h2>
        <div className="space-y-2">
          {executions.map((e: any) => (
            <div key={e.id} className="rounded-xl border p-3 text-sm flex justify-between">
              <div>
                <span className="font-medium">{e.cron_key}</span>
                <span className="text-muted-foreground"> · {e.status}</span>
                {e.duration_ms != null && <span className="text-muted-foreground"> · {e.duration_ms}ms</span>}
              </div>
              <span className="text-xs text-muted-foreground">{new Date(e.started_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Runners */}
      <div>
        <h2 className="font-medium mb-2">Runner Registry ({runners.length})</h2>
        <div className="space-y-2">
          {runners.map((r: any) => (
            <div key={r.id} className="rounded-xl border p-3 text-sm">
              <span className="font-medium">{r.runner_key}</span>
              <span className="text-muted-foreground"> · {r.layer_key} · {r.runner_type} · max {r.max_concurrency}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Guardrails */}
      <div>
        <h2 className="font-medium mb-2">Scheduler Guardrails ({guardrails.length})</h2>
        <div className="space-y-2">
          {guardrails.map((g: any) => (
            <div key={g.id} className="rounded-xl border p-3 text-sm">
              <span className="font-medium">{g.guardrail_key}</span>
              <span className="text-muted-foreground"> · {g.guardrail_type} · threshold {g.threshold_numeric} · {g.action_mode}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Retry Policies */}
      <div>
        <h2 className="font-medium mb-2">Retry Policies ({retryPolicies.length})</h2>
        <div className="space-y-2">
          {retryPolicies.map((p: any) => (
            <div key={p.id} className="rounded-xl border p-3 text-sm">
              <span className="font-medium">{p.policy_key}</span>
              <span className="text-muted-foreground"> · {p.backoff_mode} · max {p.max_attempts} · base {p.base_delay_seconds}s</span>
            </div>
          ))}
        </div>
      </div>

      {/* Orphans */}
      <div>
        <h2 className="font-medium mb-2">Open Orphans ({orphans.length})</h2>
        <div className="space-y-2">
          {orphans.length === 0 && <p className="text-sm text-muted-foreground">Keine Orphans.</p>}
          {orphans.map((o: any) => (
            <div key={o.id} className="rounded-xl border p-3 text-sm">
              <span className="font-medium">{o.orphan_type}</span>
              <span className="text-muted-foreground"> · {o.severity} · {o.object_ref}</span>
              <div className="text-xs text-muted-foreground mt-1">{o.message}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
