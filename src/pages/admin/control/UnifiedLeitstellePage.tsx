import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUnifiedLeitstelleFeed, useUnifiedLeitstelleSnapshot } from "@/hooks/useUnifiedLeitstelle";
import HealthHero from "@/components/control/HealthHero";
import MetricCard from "@/components/control/MetricCard";
import RailCard from "@/components/control/RailCard";

export default function UnifiedLeitstellePage() {
  const { data: snapshot, isLoading: snapshotLoading, refetch: refetchSnapshot } = useUnifiedLeitstelleSnapshot();
  const { data: feed, isLoading: feedLoading, refetch: refetchFeed } = useUnifiedLeitstelleFeed(30);
  const [log, setLog] = useState<any>(null);
  const [running, setRunning] = useState(false);

  async function runAllControlLoops() {
    setRunning(true);
    const calls = [
      "control-plane-cron",
      "control-plane-phase2-cron",
      "executive-phase3-cron",
      "system-assertion-cron",
      "system-probe-cron",
      "system-scheduler-guardrail-cron",
    ];
    const results = [];
    for (const fn of calls) {
      const { data, error } = await supabase.functions.invoke(fn, { body: {} });
      results.push({ fn, ok: !error, data: error ? { error } : data });
    }
    setLog(results);
    setRunning(false);
    await refetchSnapshot();
    await refetchFeed();
  }

  const alerts = useMemo(() => feed?.alerts ?? [], [feed]);
  const decisions = useMemo(() => feed?.decisions ?? [], [feed]);
  const probes = useMemo(() => feed?.probe_results ?? [], [feed]);
  const cronRuns = useMemo(() => feed?.cron_runs ?? [], [feed]);

  const healthScore = snapshot?.control?.health_score ?? 0;
  const systemStatus = snapshot?.control?.status ?? "unknown";
  const blendedRoi = snapshot?.business?.blended_roi ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Unified Leitstelle</h1>
          <p className="text-sm text-muted-foreground">
            Health · Contracts · Probes · ROI · Executive Decisions · Scheduler
          </p>
        </div>
        <button
          className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
          onClick={runAllControlLoops}
          disabled={running}
        >
          {running ? "Aktualisiere…" : "Alle Schleifen ausführen"}
        </button>
      </div>

      {log && (
        <pre className="rounded-2xl border border-border bg-muted/30 p-4 text-xs overflow-auto max-h-60">
          {JSON.stringify(log, null, 2)}
        </pre>
      )}

      <HealthHero
        healthScore={healthScore}
        status={systemStatus}
        openAlerts={snapshot?.open_alerts_count ?? 0}
        blendedRoi={blendedRoi}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard title="Open Alerts" value={snapshot?.open_alerts_count ?? 0} subtitle="Control + Probe + Contract + Orphan" />
        <MetricCard title="Running Crons" value={snapshot?.scheduler?.running_crons ?? 0} subtitle={`Leases: ${snapshot?.scheduler?.active_leases ?? 0}`} />
        <MetricCard title="Blocked Waves" value={snapshot?.waves?.blocked_waves ?? 0} subtitle={`Aktiv: ${snapshot?.waves?.active_waves ?? 0}`} />
        <MetricCard title="Contract Violations" value={snapshot?.contracts?.open_violations ?? 0} subtitle={`Contracts: ${snapshot?.contracts?.active_contracts ?? 0}`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <RailCard title="Alert Rail" items={alerts} renderMeta={(i) => `${i.severity} · ${i.scope} · ${i.status}`} />
        <RailCard title="Executive Decisions" items={decisions} renderMeta={(i) => `${i.status} · Prio ${i.priority ?? "–"}`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <RailCard title="Probe Status" items={probes} renderMeta={(i) => `${i.status} · ${i.severity ?? "–"}`} />
        <RailCard title="Scheduler / Cron" items={cronRuns} renderMeta={(i) => `${i.status} · ${i.duration_ms ?? 0}ms`} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard title="Revenue Today" value={snapshot?.control?.finance?.revenue_today ?? 0} subtitle="Control Snapshot" />
        <MetricCard title="Active Campaigns" value={snapshot?.business?.active_campaigns ?? 0} subtitle="Business KPI" />
        <MetricCard title="Queued Decisions" value={snapshot?.decisions?.queued_decisions ?? 0} subtitle="Executive Portfolio" />
        <MetricCard title="Probe Fails" value={snapshot?.probes?.failed_count ?? 0} subtitle={`Critical: ${snapshot?.probes?.critical_failed_count ?? 0}`} />
      </div>

      {(snapshotLoading || feedLoading) && (
        <div className="text-sm text-muted-foreground animate-pulse">Leitstelle lädt…</div>
      )}
    </div>
  );
}
