import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Filter, Beaker } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Row = {
  intent_key: string;
  total: number;
  allowed: number;
  suppressed: number;
  delayed: number;
  channel_changed: number;
  suppression_rate: number;
  last_decided_at: string;
};

type Smoke = { check_name: string; passed: boolean; detail: Record<string, unknown> };

export default function PolicyImpactFunnelCard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [smoke, setSmoke] = useState<Smoke[]>([]);
  const [windowHours, setWindowHours] = useState(168);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await (supabase as any).rpc("admin_get_policy_impact_funnel", { p_window_hours: windowHours });
    setRows((data ?? []) as Row[]);
    setLoading(false);
  };

  const runSmoke = async () => {
    const { data } = await (supabase as any).rpc("admin_smoke_policy_enforcement");
    setSmoke((data ?? []) as Smoke[]);
  };

  useEffect(() => { load(); }, [windowHours]);

  const totals = rows.reduce(
    (a, r) => ({
      total: a.total + r.total,
      allowed: a.allowed + r.allowed,
      suppressed: a.suppressed + r.suppressed,
      delayed: a.delayed + r.delayed,
      channel_changed: a.channel_changed + r.channel_changed,
    }),
    { total: 0, allowed: 0, suppressed: 0, delayed: 0, channel_changed: 0 },
  );

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Filter className="h-4 w-4 text-primary" />
          Policy Impact Funnel
          <Badge variant="outline" className="ml-2 text-xs">Track 2.5</Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Was passiert beim Versand? allowed / suppressed / delayed / channel_changed pro Intent.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {[{ l: "24h", v: 24 }, { l: "7d", v: 168 }, { l: "30d", v: 720 }].map((o) => (
            <Button key={o.v} size="sm" variant={windowHours === o.v ? "default" : "outline"} onClick={() => setWindowHours(o.v)}>{o.l}</Button>
          ))}
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} /> Reload
          </Button>
          <Button size="sm" variant="outline" onClick={runSmoke}>
            <Beaker className="h-3 w-3 mr-1" /> Regression-Smoke
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
          <Kpi label="Total" value={totals.total} />
          <Kpi label="Allowed" value={totals.allowed} />
          <Kpi label="Suppressed" value={totals.suppressed} />
          <Kpi label="Delayed" value={totals.delayed} />
          <Kpi label="Channel Changed" value={totals.channel_changed} />
        </div>

        <div className="space-y-1 max-h-72 overflow-auto">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch keine Dispatch-Entscheidungen im Fenster.</p>
          ) : rows.map((r) => (
            <div key={r.intent_key} className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-subtle p-2 text-sm">
              <span className="font-medium text-foreground">{r.intent_key}</span>
              <Badge variant="secondary" className="text-xs">total {r.total}</Badge>
              <Badge variant="default" className="text-xs">allow {r.allowed}</Badge>
              <Badge variant="destructive" className="text-xs">supp {r.suppressed}</Badge>
              <Badge variant="outline" className="text-xs">delay {r.delayed}</Badge>
              <Badge variant="outline" className="text-xs">ch-Δ {r.channel_changed}</Badge>
              <span className="text-xs text-muted-foreground ml-auto">supp-rate {(r.suppression_rate * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>

        {smoke.length > 0 && (
          <div className="space-y-1 rounded-md border border-border p-2">
            <p className="text-xs font-medium text-foreground mb-1">Regression-Smoke ({smoke.filter(s => s.passed).length}/{smoke.length})</p>
            {smoke.map((s) => (
              <div key={s.check_name} className="flex items-center gap-2 text-xs">
                <Badge variant={s.passed ? "default" : "destructive"}>{s.passed ? "PASS" : "FAIL"}</Badge>
                <span className="text-foreground">{s.check_name}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-surface-subtle p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold text-foreground">{value.toLocaleString("de-DE")}</div>
    </div>
  );
}
