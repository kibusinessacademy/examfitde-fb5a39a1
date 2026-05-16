import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ShieldAlert, RefreshCw, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Health = {
  active_subscriptions: number;
  last_delivery_at: string | null;
  last_attempt_at: string | null;
  pending: number; pending_stale: number;
  failed_1h: number; delivered_1h: number; delivered_24h: number;
  invalid_token_1h: number; suppression_pct_1h: number | null;
  cron_last_seen_at: string | null;
  signal_no_subscriptions: boolean;
  signal_cron_stale: boolean;
  signal_delivery_drop: boolean;
  signal_invalid_token_spike: boolean;
  signal_suppression_spike: boolean;
  signal_pending_stale: boolean;
};

type SQ = {
  jobs_total: number; jobs_suppressed: number; jobs_delivered: number;
  suppression_pct: number | null;
  fatigue: number; quiet_hours: number; channel_optout: number;
  same_kind_cooldown: number; daily_cap: number;
  exam_window_overrides: number;
  by_reason: Record<string, number>;
  signal_over_suppression: boolean;
  signal_under_send: boolean;
  signal_fatigue_dominant: boolean;
};

export default function NotificationHealthCard() {
  const [vapid, setVapid] = useState<"ok" | "missing" | "unknown">("unknown");
  const [h, setH] = useState<Health | null>(null);
  const [sq, setSq] = useState<SQ | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      // Dispatcher returns {status:'skipped',reason:'no_vapid'} when env missing.
      const { data: disp } = await supabase.functions.invoke("send-learner-push", { body: { ping: true } });
      const reason = (disp as any)?.reason;
      setVapid(reason === "no_vapid" ? "missing" : "ok");
    } catch { setVapid("unknown"); }
    const [{ data: hd }, { data: qd }] = await Promise.all([
      (supabase as any).rpc("admin_get_notification_health"),
      (supabase as any).rpc("admin_get_suppression_quality", { p_window_hours: 168 }),
    ]);
    setH(hd as Health | null);
    setSq(qd as SQ | null);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const alerts: { label: string; tone: "warn" | "error" }[] = [];
  if (vapid === "missing") alerts.push({ label: "VAPID-Keys fehlen — Dispatcher idle", tone: "error" });
  if (h?.signal_no_subscriptions) alerts.push({ label: "Keine aktiven Push-Subscriptions", tone: "warn" });
  if (h?.signal_cron_stale) alerts.push({ label: "Dispatcher-Cron seit >10min still", tone: "error" });
  if (h?.signal_delivery_drop) alerts.push({ label: "Delivery-Drop: 24h>5, letzte 1h=0", tone: "error" });
  if (h?.signal_invalid_token_spike) alerts.push({ label: `Invalid-Token-Spike (${h.invalid_token_1h}/1h)`, tone: "warn" });
  if (h?.signal_suppression_spike) alerts.push({ label: "Suppression-Spike (>80% in 1h)", tone: "warn" });
  if (h?.signal_pending_stale) alerts.push({ label: `${h.pending_stale} pending Jobs >10min alt`, tone: "warn" });
  if (sq?.signal_over_suppression) alerts.push({ label: "Over-Suppression: >70% suppressed", tone: "warn" });
  if (sq?.signal_under_send) alerts.push({ label: "Under-Send: <5 Jobs/24h", tone: "warn" });
  if (sq?.signal_fatigue_dominant) alerts.push({ label: "Fatigue dominiert Suppressions", tone: "warn" });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <ShieldAlert className="h-4 w-4" /> Notification Health & Suppression
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {alerts.length === 0 ? (
          <Badge variant="outline" className="text-emerald-700">Alle Signale grün</Badge>
        ) : (
          alerts.map((a, i) => (
            <Alert key={i} variant={a.tone === "error" ? "destructive" : "default"} className="py-2">
              <AlertTriangle className="h-3 w-3" />
              <AlertDescription className="text-xs">{a.label}</AlertDescription>
            </Alert>
          ))
        )}

        {h && (
          <div className="grid grid-cols-2 gap-2 pt-2 border-t">
            <Kv k="Aktive Subs" v={h.active_subscriptions} />
            <Kv k="Delivered 1h/24h" v={`${h.delivered_1h}/${h.delivered_24h}`} />
            <Kv k="Failed 1h" v={h.failed_1h} />
            <Kv k="Invalid-Token 1h" v={h.invalid_token_1h} />
            <Kv k="Pending / stale" v={`${h.pending}/${h.pending_stale}`} />
            <Kv k="Suppression 1h" v={`${h.suppression_pct_1h ?? "—"}%`} />
            <Kv k="VAPID" v={vapid === "missing" ? "MISSING" : vapid === "ok" ? "OK" : "?"} />
            <Kv k="Letzte Zustellung" v={h.last_delivery_at ? new Date(h.last_delivery_at).toLocaleString("de-DE") : "—"} />
          </div>
        )}

        {sq && (
          <div className="pt-2 border-t">
            <p className="text-muted-foreground mb-1">Suppression-Mix (7d)</p>
            <div className="flex flex-wrap gap-1">
              {Object.entries(sq.by_reason).map(([k, c]) => (
                <Badge key={k} variant="secondary" className="text-[10px]">{k}: {c}</Badge>
              ))}
            </div>
            <p className="text-muted-foreground mt-2">
              Exam-Window-Overrides: {sq.exam_window_overrides}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Kv({ k, v }: { k: string; v: any }) {
  return (
    <div className="rounded-md border p-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</p>
      <p className="font-medium">{String(v)}</p>
    </div>
  );
}
