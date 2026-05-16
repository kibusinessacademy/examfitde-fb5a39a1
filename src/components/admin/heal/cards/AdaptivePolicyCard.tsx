import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RefreshCw, ShieldCheck, Play, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Policy = {
  intent_key: string;
  safety_class: string;
  persona: string;
  channel: string;
  strategy: string;
  reasons: string[] | null;
  pending_strategy: string | null;
  pending_reasons: string[] | null;
  consecutive_proposals: number;
  sample_size: number;
  active_since: string;
  cooldown_until: string | null;
  last_evaluated_at: string;
};

type Decision = {
  id: string;
  intent_key: string;
  persona: string;
  channel: string;
  window_hours: number;
  sample_size: number;
  current_strategy: string;
  proposed_strategy: string;
  applied_strategy: string;
  reasons: string[] | null;
  metrics: Record<string, unknown> | null;
  guard_action: string;
  decided_at: string;
};

type RecomputeRow = {
  intent_key: string;
  persona: string;
  channel: string;
  current_strategy: string;
  proposed_strategy: string;
  applied_strategy: string;
  reasons: string[] | null;
  guard_action: string;
  sample_size: number;
};

const STRATEGY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  prefer: "default",
  neutral: "secondary",
  downrank: "outline",
  cooldown: "outline",
  suppress: "destructive",
};

const SAFETY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  critical: "destructive",
  sensitive: "outline",
  standard: "secondary",
};

export default function AdaptivePolicyCard() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [preview, setPreview] = useState<RecomputeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [windowHours, setWindowHours] = useState(168);

  const load = async () => {
    setLoading(true);
    const [{ data: pols }, { data: decs }] = await Promise.all([
      (supabase as any).rpc("admin_get_adaptive_policies"),
      (supabase as any).rpc("admin_get_policy_decisions", { p_limit: 50 }),
    ]);
    setPolicies((pols ?? []) as Policy[]);
    setDecisions((decs ?? []) as Decision[]);
    setLoading(false);
  };

  const recompute = async (dryRun: boolean) => {
    setRunning(true);
    const { data, error } = await (supabase as any).rpc("admin_recompute_adaptive_policies", {
      p_window_hours: windowHours,
      p_dry_run: dryRun,
    });
    setRunning(false);
    if (!error) {
      setPreview((data ?? []) as RecomputeRow[]);
      if (!dryRun) await load();
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Adaptive Notification Policies
          <Badge variant="outline" className="ml-2 text-xs">Track 2.4</Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Deterministischer Policy-Layer mit Safety-Floor, Hysteresis und Cooldown — kein autonomes Growth-Hacking.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {[{ l: "24h", v: 24 }, { l: "7d", v: 168 }, { l: "30d", v: 720 }].map((o) => (
              <Button key={o.v} size="sm" variant={windowHours === o.v ? "default" : "outline"} onClick={() => setWindowHours(o.v)}>{o.l}</Button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} /> Reload
          </Button>
          <Button size="sm" variant="outline" onClick={() => recompute(true)} disabled={running}>
            <Eye className="h-3 w-3 mr-1" /> Dry-Run
          </Button>
          <Button size="sm" onClick={() => recompute(false)} disabled={running}>
            <Play className="h-3 w-3 mr-1" /> Apply
          </Button>
        </div>

        <Tabs defaultValue="policies">
          <TabsList>
            <TabsTrigger value="policies">Active Policies ({policies.length})</TabsTrigger>
            <TabsTrigger value="preview">Preview ({preview.length})</TabsTrigger>
            <TabsTrigger value="history">History ({decisions.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="policies" className="space-y-2">
            {policies.length === 0 ? (
              <p className="text-sm text-muted-foreground">Noch keine Policies aktiv. Starte mit Dry-Run, dann Apply.</p>
            ) : policies.map((p) => (
              <div key={`${p.intent_key}-${p.persona}-${p.channel}`} className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-subtle p-2 text-sm">
                <Badge variant={SAFETY_VARIANT[p.safety_class] ?? "secondary"} className="text-xs">{p.safety_class}</Badge>
                <span className="font-medium text-foreground">{p.intent_key}</span>
                <Badge variant="outline" className="text-xs">{p.persona}</Badge>
                <Badge variant="outline" className="text-xs">{p.channel}</Badge>
                <Badge variant={STRATEGY_VARIANT[p.strategy] ?? "secondary"}>{p.strategy}</Badge>
                {p.pending_strategy && (
                  <Badge variant="outline" className="text-xs">
                    pending → {p.pending_strategy} ({p.consecutive_proposals}× / hysteresis)
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">n={p.sample_size}</span>
                {p.cooldown_until && new Date(p.cooldown_until) > new Date() && (
                  <Badge variant="outline" className="text-xs">cooldown</Badge>
                )}
                {(p.reasons ?? []).length > 0 && (
                  <span className="text-xs text-muted-foreground">· {(p.reasons ?? []).join(", ")}</span>
                )}
              </div>
            ))}
          </TabsContent>

          <TabsContent value="preview" className="space-y-2">
            {preview.length === 0 ? (
              <p className="text-sm text-muted-foreground">Noch kein Dry-Run ausgeführt.</p>
            ) : preview.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-sm">
                <span className="font-medium text-foreground">{r.intent_key}</span>
                <Badge variant="outline" className="text-xs">{r.persona}/{r.channel}</Badge>
                <Badge variant={STRATEGY_VARIANT[r.current_strategy] ?? "secondary"}>{r.current_strategy}</Badge>
                <span className="text-muted-foreground">→</span>
                <Badge variant={STRATEGY_VARIANT[r.proposed_strategy] ?? "secondary"}>{r.proposed_strategy}</Badge>
                <Badge variant="outline" className="text-xs">{r.guard_action}</Badge>
                <span className="text-xs text-muted-foreground">n={r.sample_size}</span>
                {(r.reasons ?? []).length > 0 && (
                  <span className="text-xs text-muted-foreground">· {(r.reasons ?? []).join(", ")}</span>
                )}
              </div>
            ))}
          </TabsContent>

          <TabsContent value="history" className="space-y-1 max-h-96 overflow-auto">
            {decisions.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-xs">
                <span className="text-muted-foreground">{new Date(d.decided_at).toLocaleString()}</span>
                <span className="font-medium text-foreground">{d.intent_key}</span>
                <Badge variant="outline">{d.persona}/{d.channel}</Badge>
                <Badge variant={STRATEGY_VARIANT[d.current_strategy] ?? "secondary"}>{d.current_strategy}</Badge>
                <span className="text-muted-foreground">→</span>
                <Badge variant={STRATEGY_VARIANT[d.applied_strategy] ?? "secondary"}>{d.applied_strategy}</Badge>
                <Badge variant="outline">{d.guard_action}</Badge>
                {(d.reasons ?? []).length > 0 && (
                  <span className="text-muted-foreground">· {(d.reasons ?? []).join(", ")}</span>
                )}
              </div>
            ))}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
