import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Intent = {
  intent_key: string; label: string; description: string;
  recovery_action: string; max_per_day: number;
  respects_quiet_hours: boolean; respects_fatigue: boolean;
};

type Audit = {
  job_id: string; intent_key: string;
  suppression_reason: string | null; scheduled_for: string;
};

export default function NotificationSuppressionGovernanceCard() {
  const [intents, setIntents] = useState<Intent[]>([]);
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({});
  const [audit, setAudit] = useState<Audit[]>([]);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: reg }, { data: au }] = await Promise.all([
      (supabase as any).rpc("learner_get_intent_registry"),
      (supabase as any).rpc("admin_get_suppression_audit", { p_window_hours: 168, p_limit: 50 }),
    ]);
    const list = (reg as Intent[]) ?? [];
    setIntents(list);
    const m: Record<string, boolean> = {};
    list.forEach((i) => { m[i.intent_key] = true; });
    setEnabledMap(m);
    setAudit((au as Audit[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const toggle = async (key: string, next: boolean) => {
    if (!reason.trim()) {
      toast.error("Bitte Begründung angeben (Audit-Pflicht).");
      return;
    }
    setPendingKey(key);
    const { error } = await (supabase as any).rpc("admin_set_intent_enabled", {
      p_intent_key: key, p_enabled: next, p_reason: reason.trim(),
    });
    setPendingKey(null);
    if (error) { toast.error(error.message); return; }
    setEnabledMap((m) => ({ ...m, [key]: next }));
    toast.success(`${key} ${next ? "aktiviert" : "pausiert"}`);
  };

  const byReason: Record<string, number> = {};
  audit.forEach((a) => {
    const k = a.suppression_reason ?? "unknown";
    byReason[k] = (byReason[k] ?? 0) + 1;
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> Suppression Governance
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <div className="flex flex-wrap gap-1">
          {Object.entries(byReason).length === 0
            ? <span className="text-muted-foreground">Keine Suppressions im 7-Tage-Fenster.</span>
            : Object.entries(byReason).map(([k, v]) => (
                <Badge key={k} variant="secondary" className="text-[10px]">{k}: {v}</Badge>
              ))}
        </div>

        <div className="pt-2 border-t space-y-2">
          <Input
            placeholder="Audit-Begründung (Pflicht für Toggle)…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="h-8 text-xs"
          />
          <div className="space-y-1">
            {intents.map((i) => (
              <div key={i.intent_key} className="flex items-center justify-between rounded border p-2">
                <div className="min-w-0">
                  <p className="font-medium truncate">{i.label}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {i.intent_key} · max {i.max_per_day}/Tag · recovery: {i.recovery_action}
                  </p>
                </div>
                <Switch
                  checked={enabledMap[i.intent_key] ?? true}
                  disabled={pendingKey === i.intent_key}
                  onCheckedChange={(v) => toggle(i.intent_key, v)}
                />
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
