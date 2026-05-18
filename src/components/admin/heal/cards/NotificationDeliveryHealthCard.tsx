import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { RefreshCw, AlertTriangle, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Health = {
  status: "healthy" | "degraded" | "critical";
  window_minutes: number;
  totals: {
    total: number; sent: number; skipped: number; failed: number; pending: number;
    skipped_pct: number; failed_pct: number; oldest_pending_age_min: number;
  };
  destinations: { total: number; enabled: number };
  skipped_reasons: Record<string, number>;
  failed_reasons: Record<string, number>;
  issues: Array<{ code: string; severity: string; message: string; reasons?: Record<string, number> }>;
  checked_at: string;
};

type Escalation = {
  escalated: boolean;
  recent_checks?: number;
  bad_checks?: number;
  last_status?: string;
  severity?: string;
  reason?: string;
};

type ConfigRow = { alert_key: string; threshold: number; enabled: boolean; channels: string[]; updated_at: string };

type OutboxRow = {
  id: string; channel: string; target: string; alert_key: string; severity: string;
  status: string; attempts: number; max_attempts: number; last_error: string | null;
  next_attempt_at: string | null; sent_at: string | null; dispatched_at: string | null;
  created_at: string; age_minutes: number; payload_summary: Record<string, unknown>;
};

const statusVariant = (s: string) =>
  s === "critical" ? "destructive" : s === "degraded" ? "default" : "secondary";

const DRILL_STATUSES = ["failed", "skipped", "stale_pending", "dlq", "all"] as const;

export function NotificationDeliveryHealthCard() {
  const [data, setData] = useState<Health | null>(null);
  const [escalation, setEscalation] = useState<Escalation | null>(null);
  const [configs, setConfigs] = useState<ConfigRow[]>([]);
  const [outbox, setOutbox] = useState<OutboxRow[]>([]);
  const [drillStatus, setDrillStatus] = useState<typeof DRILL_STATUSES[number]>("failed");
  const [drillOpen, setDrillOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const [{ data: h, error: he }, { data: e }, { data: c }] = await Promise.all([
      supabase.rpc("admin_get_notification_delivery_health", { p_window_minutes: 60 }),
      supabase.rpc("admin_get_delivery_escalation_status"),
      supabase.rpc("admin_get_heal_alert_config"),
    ]);
    if (he) setErr(he.message);
    else setData(h as unknown as Health);
    setEscalation((e as unknown as Escalation) ?? null);
    setConfigs(((c as unknown as ConfigRow[]) ?? []));
    setLoading(false);
  }, []);

  const loadOutbox = useCallback(async (status: typeof DRILL_STATUSES[number]) => {
    const { data: rows, error } = await supabase.rpc("admin_get_notification_outbox_entries", {
      p_status: status, p_limit: 50,
    });
    if (error) { toast.error(error.message); return; }
    setOutbox((rows as unknown as OutboxRow[]) ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (drillOpen) loadOutbox(drillStatus); }, [drillOpen, drillStatus, loadOutbox]);

  const saveConfig = async (row: ConfigRow, patch: Partial<ConfigRow>) => {
    setSavingKey(row.alert_key);
    const next = { ...row, ...patch };
    const { error } = await supabase.rpc("admin_upsert_heal_alert_config", {
      p_alert_key: next.alert_key,
      p_threshold: Number(next.threshold),
      p_enabled: next.enabled,
      p_channels: next.channels,
    });
    setSavingKey(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`${row.alert_key} aktualisiert`);
    load();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base">Notification Delivery Health</CardTitle>
          <CardDescription>Heal-Alert Outbox · letzte 60 min · skipped/failed/stale_pending</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {data && <Badge variant={statusVariant(data.status)}>{data.status}</Badge>}
          <Button size="sm" variant="ghost" onClick={load} disabled={loading} aria-label="Reload">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {err && <p className="text-sm text-destructive">{err}</p>}

        {escalation?.escalated && (
          <div className="rounded-md border border-destructive-border bg-destructive-bg-subtle p-3 text-sm flex gap-2 items-start">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
            <div className="space-y-1">
              <div className="font-medium text-destructive">
                Eskalation: anhaltende Liefer-Probleme ({escalation.severity ?? "high"})
              </div>
              <div className="text-muted-foreground text-xs">
                {escalation.bad_checks}/{escalation.recent_checks} der letzten Health-Checks degraded/critical · last={escalation.last_status}
              </div>
            </div>
          </div>
        )}

        {data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
              <Metric label="Total" value={data.totals.total} />
              <Metric label="Sent" value={data.totals.sent} />
              <Metric label="Skipped" value={`${data.totals.skipped} (${data.totals.skipped_pct}%)`} />
              <Metric label="Failed" value={`${data.totals.failed} (${data.totals.failed_pct}%)`} />
              <Metric label="Pending" value={`${data.totals.pending} · ${data.totals.oldest_pending_age_min}m`} />
            </div>
            <div className="text-xs text-muted-foreground">
              Destinations: {data.destinations.enabled}/{data.destinations.total} enabled · checked {new Date(data.checked_at).toLocaleTimeString()}
            </div>

            {data.issues.length > 0 && (
              <div className="space-y-2">
                {data.issues.map((i, idx) => (
                  <div key={idx} className="rounded-md border border-border p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant={i.severity === "critical" ? "destructive" : "default"}>{i.severity}</Badge>
                      <span className="font-medium">{i.code}</span>
                    </div>
                    <p className="text-muted-foreground mt-1">{i.message}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Threshold editor */}
            <div className="rounded-md border border-border">
              <button
                type="button"
                onClick={() => setConfigOpen((o) => !o)}
                className="w-full flex items-center justify-between p-2 text-sm hover:bg-muted/50"
                aria-expanded={configOpen}
              >
                <span className="font-medium">Thresholds (heal_alert_config)</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${configOpen ? "rotate-180" : ""}`} />
              </button>
              {configOpen && (
                <div className="p-2 space-y-2">
                  {configs.length === 0 && <p className="text-xs text-muted-foreground">Keine Konfigurationen.</p>}
                  {configs.map((row) => (
                    <ConfigEditor
                      key={row.alert_key}
                      row={row}
                      saving={savingKey === row.alert_key}
                      onSave={(patch) => saveConfig(row, patch)}
                    />
                  ))}
                  <p className="text-[11px] text-muted-foreground">
                    Werte werden auch von Simulator-/Regression-Tests gelesen (z. B. <code>parity_cron_stale_hours</code>).
                  </p>
                </div>
              )}
            </div>

            {/* Drilldown */}
            <div className="rounded-md border border-border">
              <button
                type="button"
                onClick={() => setDrillOpen((o) => !o)}
                className="w-full flex items-center justify-between p-2 text-sm hover:bg-muted/50"
                aria-expanded={drillOpen}
              >
                <span className="font-medium">Outbox-Drilldown</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${drillOpen ? "rotate-180" : ""}`} />
              </button>
              {drillOpen && (
                <div className="p-2 space-y-2">
                  <div className="flex flex-wrap gap-1">
                    {DRILL_STATUSES.map((s) => (
                      <Button
                        key={s}
                        size="sm"
                        variant={drillStatus === s ? "default" : "outline"}
                        onClick={() => setDrillStatus(s)}
                      >
                        {s}
                      </Button>
                    ))}
                    <Button size="sm" variant="ghost" onClick={() => loadOutbox(drillStatus)} aria-label="Reload outbox">
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {outbox.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Keine Einträge für Status „{drillStatus}".</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="text-muted-foreground">
                          <tr>
                            <th className="text-left p-1">alert</th>
                            <th className="text-left p-1">sev</th>
                            <th className="text-left p-1">status</th>
                            <th className="text-left p-1">att</th>
                            <th className="text-left p-1">age</th>
                            <th className="text-left p-1">next</th>
                            <th className="text-left p-1">error</th>
                          </tr>
                        </thead>
                        <tbody>
                          {outbox.map((r) => (
                            <tr key={r.id} className="border-t border-border">
                              <td className="p-1 font-mono">{r.alert_key}</td>
                              <td className="p-1">{r.severity}</td>
                              <td className="p-1">
                                <Badge variant={r.status === "dlq" || r.status === "failed" ? "destructive" : "secondary"}>
                                  {r.status}
                                </Badge>
                              </td>
                              <td className="p-1">{r.attempts}/{r.max_attempts}</td>
                              <td className="p-1">{r.age_minutes}m</td>
                              <td className="p-1">{r.next_attempt_at ? new Date(r.next_attempt_at).toLocaleTimeString() : "—"}</td>
                              <td className="p-1 max-w-[16rem] truncate" title={r.last_error ?? ""}>{r.last_error ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>

            {(Object.keys(data.skipped_reasons || {}).length > 0 || Object.keys(data.failed_reasons || {}).length > 0) && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">Reason-Aggregation</summary>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                  <pre className="bg-muted p-2 rounded">skipped: {JSON.stringify(data.skipped_reasons, null, 2)}</pre>
                  <pre className="bg-muted p-2 rounded">failed: {JSON.stringify(data.failed_reasons, null, 2)}</pre>
                </div>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function ConfigEditor({
  row, saving, onSave,
}: { row: ConfigRow; saving: boolean; onSave: (patch: Partial<ConfigRow>) => void }) {
  const [threshold, setThreshold] = useState<string>(String(row.threshold));
  const [enabled, setEnabled] = useState<boolean>(row.enabled);
  useEffect(() => { setThreshold(String(row.threshold)); setEnabled(row.enabled); }, [row.threshold, row.enabled]);

  const dirty = Number(threshold) !== Number(row.threshold) || enabled !== row.enabled;
  return (
    <div className="flex items-center gap-2 text-xs">
      <code className="flex-1 truncate">{row.alert_key}</code>
      <Input
        type="number"
        step="0.5"
        value={threshold}
        onChange={(e) => setThreshold(e.target.value)}
        className="h-7 w-20"
        aria-label={`Threshold for ${row.alert_key}`}
      />
      <Switch checked={enabled} onCheckedChange={setEnabled} aria-label={`Enable ${row.alert_key}`} />
      <Button
        size="sm"
        variant={dirty ? "default" : "outline"}
        disabled={!dirty || saving}
        onClick={() => onSave({ threshold: Number(threshold), enabled })}
      >
        {saving ? "…" : "Speichern"}
      </Button>
    </div>
  );
}
