/**
 * HealAutomationControlCard
 *
 * Bundles four sub-views in one Cockpit card to keep page-level imports tight:
 *   1. Heal-Run Audit-Trail   (admin_get_heal_run_audit_trail)
 *   2. Parity-Cron-Guard      (admin_get_parity_cron_health)
 *   3. Mismatch Alerts + Cfg  (admin_get_heal_alerts_summary + admin_update_heal_alert_config)
 *   4. Heal-Queue Audit       (admin_get_heal_queue_audit)
 *   5. Drift Coverage Matrix  (admin_get_drift_coverage_matrix)
 *
 * Closed-loop control surface: detect → alert → audit → re-check.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { RefreshCw, ShieldCheck, AlertTriangle, Save, Link as LinkIcon } from "lucide-react";

type AuditRow = {
  id: string; created_at: string; action_type: string;
  origin: string | null; recommended_action: string | null;
  package_count: number; package_ids: string[]; jobs: any[];
  result_status: string | null; result_detail: string | null;
};
type CronHealth = { last_check_at: string | null; status: string; detail: string; metadata?: any };
type AlertsSummary = {
  last_eval_at: string | null; status: string;
  alerts: Array<{ alert_key: string; severity: string; value: number; threshold: number; message: string; deep_link: string }>;
  mismatch_count: number; enqueued: number;
  config?: Record<string, { threshold: number; enabled: boolean; channels: string[] }>;
};
type QueueAuditRow = {
  heal_action: string; pending: number; processing: number;
  done: number; failed: number; cancelled: number; total: number; completion_pct: number;
};
type CoverageRow = {
  domain: string; drift_risk: string; check: string; cron: string;
  audit: string; guard: string; self_heal: string; cockpit: string; status: string;
};

const sevBadge = (s?: string | null) => {
  if (s === "ok") return <Badge variant="outline" className="gap-1"><ShieldCheck className="h-3 w-3" />OK</Badge>;
  if (s === "warn" || s === "alert" || s === "mismatch")
    return <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />{s}</Badge>;
  if (s === "critical") return <Badge variant="destructive">CRIT</Badge>;
  return <Badge variant="outline">{s ?? "—"}</Badge>;
};

export function HealAutomationControlCard() {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Heal-Automation Control Loop</CardTitle></CardHeader>
      <CardContent>
        <Tabs defaultValue="audit">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="audit">Audit-Trail</TabsTrigger>
            <TabsTrigger value="cron">Cron-Guard</TabsTrigger>
            <TabsTrigger value="alerts">Alerts</TabsTrigger>
            <TabsTrigger value="queue">Queue-Audit</TabsTrigger>
            <TabsTrigger value="coverage">Coverage</TabsTrigger>
          </TabsList>
          <TabsContent value="audit"><AuditTrail /></TabsContent>
          <TabsContent value="cron"><CronGuard /></TabsContent>
          <TabsContent value="alerts"><AlertsPanel /></TabsContent>
          <TabsContent value="queue"><QueueAudit /></TabsContent>
          <TabsContent value="coverage"><CoverageMatrix /></TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function AuditTrail() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["heal-cockpit", "audit-trail"],
    queryFn: async (): Promise<AuditRow[]> => {
      const { data, error } = await supabase.rpc("admin_get_heal_run_audit_trail" as never, { p_limit: 50 } as never);
      if (error) throw error;
      return (data as unknown as AuditRow[]) ?? [];
    },
    staleTime: 30_000, refetchInterval: 60_000,
  });
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {isLoading ? <Skeleton className="h-32 w-full" /> : (
        <div className="max-h-96 overflow-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="bg-surface-2">
              <tr>
                <th className="px-2 py-1 text-left">Zeit</th>
                <th className="px-2 py-1 text-left">Action</th>
                <th className="px-2 py-1 text-left">Origin</th>
                <th className="px-2 py-1 text-left">Recommended</th>
                <th className="px-2 py-1 text-right">Pakete</th>
                <th className="px-2 py-1 text-right">Jobs</th>
                <th className="px-2 py-1 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((r) => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="px-2 py-1 font-mono">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-2 py-1 font-mono">{r.action_type}</td>
                  <td className="px-2 py-1">{r.origin ?? "—"}</td>
                  <td className="px-2 py-1 font-mono">{r.recommended_action ?? "—"}</td>
                  <td className="px-2 py-1 text-right font-mono">{r.package_count}</td>
                  <td className="px-2 py-1 text-right font-mono">{Array.isArray(r.jobs) ? r.jobs.length : 0}</td>
                  <td className="px-2 py-1">{sevBadge(r.result_status)}<div className="text-muted-foreground">{r.result_detail}</div></td>
                </tr>
              ))}
              {(data ?? []).length === 0 && (
                <tr><td colSpan={7} className="px-2 py-4 text-center text-muted-foreground">Keine Einträge.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CronGuard() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["heal-cockpit", "parity-cron-health"],
    queryFn: async (): Promise<CronHealth> => {
      const { data, error } = await supabase.rpc("admin_get_parity_cron_health" as never);
      if (error) throw error;
      return data as unknown as CronHealth;
    },
    staleTime: 60_000, refetchInterval: 120_000,
  });
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">{sevBadge(data?.status)}<span className="text-xs text-muted-foreground">{data?.detail}</span></div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {isLoading ? <Skeleton className="h-20 w-full" /> : (
        <pre className="max-h-72 overflow-auto rounded-md border border-border bg-surface-2 p-2 text-[11px]">
{JSON.stringify(data?.metadata ?? {}, null, 2)}
        </pre>
      )}
      <div className="text-[11px] text-muted-foreground">
        Cron <code>parity-cron-guard-daily</code> läuft täglich 04:07 UTC.
      </div>
    </div>
  );
}

function AlertsPanel() {
  const qc = useQueryClient();
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["heal-cockpit", "heal-alerts"],
    queryFn: async (): Promise<AlertsSummary> => {
      const { data, error } = await supabase.rpc("admin_get_heal_alerts_summary" as never);
      if (error) throw error;
      return data as unknown as AlertsSummary;
    },
    staleTime: 30_000, refetchInterval: 60_000,
  });
  const updateCfg = useMutation({
    mutationFn: async ({ key, threshold, enabled }: { key: string; threshold: number; enabled: boolean }) => {
      const { error } = await supabase.rpc("admin_update_heal_alert_config" as never, {
        p_alert_key: key, p_threshold: threshold, p_enabled: enabled,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Alert-Konfig aktualisiert"); qc.invalidateQueries({ queryKey: ["heal-cockpit", "heal-alerts"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Update fehlgeschlagen"),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">{sevBadge(data?.status)}<span className="text-xs text-muted-foreground">letzter Lauf: {data?.last_eval_at ? new Date(data.last_eval_at).toLocaleString() : "—"}</span></div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {(data?.alerts ?? []).length > 0 && (
        <div className="space-y-2">
          {data!.alerts.map((a, i) => (
            <div key={i} className="flex items-start justify-between rounded-md border border-destructive/30 bg-destructive-bg-subtle p-2 text-xs">
              <div>
                <div className="font-semibold">{a.message}</div>
                <div className="text-muted-foreground font-mono">{a.alert_key} • value={a.value} threshold={a.threshold}</div>
              </div>
              <a href={a.deep_link} className="inline-flex items-center gap-1 text-primary hover:underline"><LinkIcon className="h-3 w-3" />Deep-Link</a>
            </div>
          ))}
        </div>
      )}

      {isLoading ? <Skeleton className="h-24 w-full" /> : (
        <div className="rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="bg-surface-2">
              <tr>
                <th className="px-2 py-1 text-left">Alert</th>
                <th className="px-2 py-1 text-right">Threshold</th>
                <th className="px-2 py-1 text-center">Enabled</th>
                <th className="px-2 py-1 text-left">Channels</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data?.config ?? {}).map(([key, cfg]) => (
                <ConfigRow key={key} alertKey={key} cfg={cfg} onSave={(t, e) => updateCfg.mutate({ key, threshold: t, enabled: e })} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ConfigRow({ alertKey, cfg, onSave }: {
  alertKey: string; cfg: { threshold: number; enabled: boolean; channels: string[] };
  onSave: (t: number, e: boolean) => void;
}) {
  const [t, setT] = useState(String(cfg.threshold));
  const [e, setE] = useState(cfg.enabled);
  return (
    <tr className="border-t border-border">
      <td className="px-2 py-1 font-mono">{alertKey}</td>
      <td className="px-2 py-1 text-right">
        <Input type="number" value={t} onChange={(ev) => setT(ev.target.value)} className="h-7 w-24 text-right text-xs" />
      </td>
      <td className="px-2 py-1 text-center">
        <input type="checkbox" checked={e} onChange={(ev) => setE(ev.target.checked)} />
      </td>
      <td className="px-2 py-1 font-mono text-muted-foreground">{cfg.channels.join(",")}</td>
      <td className="px-2 py-1 text-right">
        <Button size="sm" variant="outline" onClick={() => onSave(Number(t), e)}><Save className="h-3 w-3" /></Button>
      </td>
    </tr>
  );
}

function QueueAudit() {
  const { data, isLoading } = useQuery({
    queryKey: ["heal-cockpit", "heal-queue-audit"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_heal_queue_audit" as never, { p_hours: 48 } as never);
      if (error) throw error;
      return data as { window_hours: number; rows: QueueAuditRow[] };
    },
    staleTime: 60_000, refetchInterval: 120_000,
  });
  if (isLoading) return <Skeleton className="h-24 w-full" />;
  return (
    <div>
      <div className="mb-2 text-xs text-muted-foreground">Fenster: letzte {data?.window_hours}h • Source: lesson_join_parity</div>
      <table className="w-full text-xs">
        <thead className="bg-surface-2">
          <tr>
            <th className="px-2 py-1 text-left">Action</th>
            <th className="px-2 py-1 text-right">pending</th>
            <th className="px-2 py-1 text-right">processing</th>
            <th className="px-2 py-1 text-right">done</th>
            <th className="px-2 py-1 text-right">failed</th>
            <th className="px-2 py-1 text-right">cancelled</th>
            <th className="px-2 py-1 text-right">total</th>
            <th className="px-2 py-1 text-right">% done</th>
          </tr>
        </thead>
        <tbody>
          {(data?.rows ?? []).map((r) => (
            <tr key={r.heal_action} className="border-t border-border">
              <td className="px-2 py-1 font-mono">{r.heal_action}</td>
              <td className="px-2 py-1 text-right font-mono">{r.pending}</td>
              <td className="px-2 py-1 text-right font-mono">{r.processing}</td>
              <td className="px-2 py-1 text-right font-mono">{r.done}</td>
              <td className="px-2 py-1 text-right font-mono">{r.failed}</td>
              <td className="px-2 py-1 text-right font-mono">{r.cancelled}</td>
              <td className="px-2 py-1 text-right font-mono">{r.total}</td>
              <td className="px-2 py-1 text-right font-mono">{r.completion_pct}%</td>
            </tr>
          ))}
          {(data?.rows ?? []).length === 0 && (
            <tr><td colSpan={8} className="px-2 py-4 text-center text-muted-foreground">Keine Heal-Queue-Items im Fenster.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function CoverageMatrix() {
  const { data, isLoading } = useQuery({
    queryKey: ["heal-cockpit", "drift-coverage"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_drift_coverage_matrix" as never);
      if (error) throw error;
      return data as { matrix: CoverageRow[]; generated_at: string };
    },
    staleTime: 5 * 60_000,
  });
  if (isLoading) return <Skeleton className="h-32 w-full" />;
  return (
    <div className="overflow-auto">
      <table className="w-full text-xs">
        <thead className="bg-surface-2">
          <tr>
            <th className="px-2 py-1 text-left">Domain</th>
            <th className="px-2 py-1 text-left">Drift-Risk</th>
            <th className="px-2 py-1 text-left">Check</th>
            <th className="px-2 py-1 text-left">Cron</th>
            <th className="px-2 py-1 text-left">Audit</th>
            <th className="px-2 py-1 text-left">Guard</th>
            <th className="px-2 py-1 text-left">Self-Heal</th>
            <th className="px-2 py-1 text-left">Cockpit</th>
            <th className="px-2 py-1 text-left">Status</th>
          </tr>
        </thead>
        <tbody>
          {(data?.matrix ?? []).map((r) => (
            <tr key={r.domain} className="border-t border-border align-top">
              <td className="px-2 py-1 font-semibold">{r.domain}</td>
              <td className="px-2 py-1 text-muted-foreground">{r.drift_risk}</td>
              <td className="px-2 py-1 font-mono">{r.check}</td>
              <td className="px-2 py-1 font-mono">{r.cron}</td>
              <td className="px-2 py-1 font-mono">{r.audit}</td>
              <td className="px-2 py-1 font-mono">{r.guard}</td>
              <td className="px-2 py-1 font-mono">{r.self_heal}</td>
              <td className="px-2 py-1 font-mono">{r.cockpit}</td>
              <td className="px-2 py-1">
                {r.status === "automated" ? <Badge variant="outline">automated</Badge> : <Badge variant="secondary">{r.status}</Badge>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 text-[10px] text-muted-foreground">generated: {data?.generated_at && new Date(data.generated_at).toLocaleString()}</div>
    </div>
  );
}
