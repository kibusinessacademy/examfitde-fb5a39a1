import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, TrendingUp, AlertTriangle, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Row = {
  intent_key: string; label: string; channel: string; persona: string;
  sent: number; opened: number; cta_clicked: number; resolved: number; suppressed: number;
  open_rate: number; cta_rate: number; resolved_rate: number;
  ignored_rate: number; suppression_rate: number;
  dead_reminder: boolean;
  recovery_inapp: number; recovery_email: number; recovery_escalation: number;
  recovery_resolved: number; recovery_lift_pct: number;
  anomaly_flags: string[] | null; recommendation: string;
};

const WINDOWS = [
  { label: "24h", v: 24 }, { label: "7d", v: 168 }, { label: "30d", v: 720 },
];

const FLAG_LABEL: Record<string, string> = {
  low_open_rate: "Open <15%",
  high_ignored_rate: "Ignored >85%",
  low_resolved_rate: "Resolved <5%",
  high_recovery_escalation: "≥3 Escalations",
  over_suppression: "Suppression >70%",
  dead_reminder: "Dead Reminder",
};

export default function NotificationEffectivenessCard() {
  const [windowHours, setWindowHours] = useState(168);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await (supabase as any).rpc("admin_get_notification_effectiveness", { p_window_hours: windowHours });
    setRows((data as Row[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [windowHours]);

  const summary = useMemo(() => {
    const totalSent = rows.reduce((s, r) => s + r.sent, 0);
    const totalResolved = rows.reduce((s, r) => s + r.resolved, 0);
    const dead = rows.filter((r) => r.dead_reminder).length;
    const avgLift = rows.length
      ? Math.round(rows.reduce((s, r) => s + Number(r.recovery_lift_pct || 0), 0) / rows.length * 10) / 10
      : 0;
    const resolvedRate = totalSent ? Math.round((totalResolved / totalSent) * 1000) / 10 : 0;
    return { totalSent, totalResolved, dead, avgLift, resolvedRate };
  }, [rows]);

  const sorted = [...rows].sort((a, b) => Number(b.resolved_rate) - Number(a.resolved_rate));
  const best = sorted.filter((r) => r.sent >= 5).slice(0, 3);
  const worst = [...sorted].reverse().filter((r) => r.sent >= 5).slice(0, 3);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> Notification Effectiveness · Diagnose
        </CardTitle>
        <div className="flex gap-1 items-center">
          <Select value={String(windowHours)} onValueChange={(v) => setWindowHours(Number(v))}>
            <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {WINDOWS.map((w) => <SelectItem key={w.v} value={String(w.v)}>{w.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <div className="grid grid-cols-4 gap-2">
          <Kv label="Sent" value={summary.totalSent} />
          <Kv label="Resolved %" value={`${summary.resolvedRate}%`} />
          <Kv label="Dead Intents" value={summary.dead} tone={summary.dead > 0 ? "warn" : "ok"} />
          <Kv label="⌀ Recovery Lift" value={`${summary.avgLift}%`} />
        </div>

        {rows.length === 0 ? (
          <p className="text-muted-foreground pt-2 border-t">Kein Volumen im Fenster.</p>
        ) : (
          <>
            <Section icon={<TrendingUp className="h-3 w-3" />} title="Best Performing">
              {best.map((r, i) => <RowLine key={i} r={r} tone="ok" />)}
              {best.length === 0 && <p className="text-muted-foreground">—</p>}
            </Section>
            <Section icon={<AlertTriangle className="h-3 w-3" />} title="Worst / Anomalien">
              {worst.map((r, i) => <RowLine key={i} r={r} tone="warn" />)}
              {worst.length === 0 && <p className="text-muted-foreground">—</p>}
            </Section>

            <details className="pt-2 border-t">
              <summary className="cursor-pointer text-muted-foreground">Alle Intents ({rows.length})</summary>
              <div className="mt-2 max-h-64 overflow-auto space-y-1">
                {rows.map((r, i) => <RowLine key={`all-${i}`} r={r} />)}
              </div>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Kv({ label, value, tone }: { label: string; value: any; tone?: "ok" | "warn" }) {
  return (
    <div className="rounded-md border p-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-base font-semibold ${tone === "warn" ? "text-destructive" : ""}`}>{String(value)}</p>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="pt-2 border-t">
      <p className="font-medium flex items-center gap-1 mb-1">{icon}{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function RowLine({ r, tone }: { r: Row; tone?: "ok" | "warn" }) {
  return (
    <div className="rounded border p-2 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate">
          <span className="font-medium">{r.label}</span>
          <span className="text-muted-foreground"> · {r.channel} · {r.persona}</span>
        </span>
        <span className="text-[10px] text-muted-foreground shrink-0">
          n={r.sent} · open {r.open_rate}% · cta {r.cta_rate}% · resolved {r.resolved_rate}%
        </span>
      </div>
      {(r.anomaly_flags?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1">
          {r.anomaly_flags!.map((f) => (
            <Badge key={f} variant={tone === "ok" ? "outline" : "destructive"} className="text-[10px]">
              {FLAG_LABEL[f] ?? f}
            </Badge>
          ))}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">
        Recovery: inapp {r.recovery_inapp} · email {r.recovery_email} · esc {r.recovery_escalation} · lift {r.recovery_lift_pct}%
      </p>
      <p className="text-[10px]">{r.recommendation}</p>
    </div>
  );
}
