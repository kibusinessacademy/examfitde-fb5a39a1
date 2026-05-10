import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Wrench, ShieldCheck, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Health = {
  generated_at: string;
  paid_orders_total: number;
  paid_without_grant_total: number;
  paid_without_grant_with_items: number;
  paid_without_grant_smoke: number;
  active_grants_total: number;
  grants_without_entitlement_total: number;
  grants_without_entitlement_real: number;
  tutor_blocked_due_to_access_drift: number;
  storage_blocked_due_to_access_drift: number;
  active_entitlements_total: number;
  products_without_curriculum_id: number;
  dangling_order_items: number;
  last_heal_run: string | null;
  last_heal_status: string | null;
  recommended_action: string;
};

export function AccessSsotHealthCard() {
  const [data, setData] = useState<Health | null>(null);
  const [loading, setLoading] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const { data: res, error } = await supabase.rpc("admin_get_access_ssot_health" as never);
    if (error) setErr(error.message);
    else setData(res as unknown as Health);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runRepair = async () => {
    setRepairing(true);
    const { error } = await supabase.rpc("admin_run_access_ssot_drift_heal" as never);
    setRepairing(false);
    if (error) toast.error(`Repair failed: ${error.message}`);
    else {
      toast.success("Access-SSOT Drift-Heal ausgeführt");
      void load();
    }
  };

  const realDrift =
    (data?.paid_without_grant_with_items ?? 0) - (data?.paid_without_grant_smoke ?? 0);
  const isHealthy =
    (data?.grants_without_entitlement_real ?? 0) === 0 &&
    realDrift <= 0 &&
    (data?.tutor_blocked_due_to_access_drift ?? 0) === 0 &&
    (data?.storage_blocked_due_to_access_drift ?? 0) === 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            {isHealthy ? (
              <ShieldCheck className="h-4 w-4 text-success" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-warning" />
            )}
            Access SSOT Health
            {data && (
              <Badge variant={isHealthy ? "secondary" : "destructive"}>
                {isHealthy ? "healthy" : "drift"}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Kauf → Grant → Entitlement → Tutor/Storage. Single Choke-Point seit 2026-05-10.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
            Reload
          </Button>
          <Button size="sm" onClick={() => void runRepair()} disabled={repairing}>
            <Wrench className="h-3.5 w-3.5 mr-1" />
            {repairing ? "Repair…" : "Repair Now"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {err && <div className="text-sm text-destructive mb-2">{err}</div>}
        {!data ? (
          <div className="text-sm text-muted-foreground">Lade…</div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Metric label="Paid Orders" value={data.paid_orders_total} />
              <Metric
                label="Paid o. Grant (real items)"
                value={data.paid_without_grant_with_items}
                tone={data.paid_without_grant_with_items > data.paid_without_grant_smoke ? "warn" : "ok"}
                hint={`smoke: ${data.paid_without_grant_smoke}`}
              />
              <Metric label="Active Grants" value={data.active_grants_total} />
              <Metric
                label="Grants o. Entitlement (real)"
                value={data.grants_without_entitlement_real}
                tone={data.grants_without_entitlement_real > 0 ? "warn" : "ok"}
              />
              <Metric
                label="Tutor blocked by drift"
                value={data.tutor_blocked_due_to_access_drift}
                tone={data.tutor_blocked_due_to_access_drift > 0 ? "warn" : "ok"}
              />
              <Metric
                label="Storage blocked by drift"
                value={data.storage_blocked_due_to_access_drift}
                tone={data.storage_blocked_due_to_access_drift > 0 ? "warn" : "ok"}
              />
              <Metric label="Active Entitlements" value={data.active_entitlements_total} />
              <Metric
                label="Products o. Curriculum"
                value={data.products_without_curriculum_id}
                tone={data.products_without_curriculum_id > 0 ? "warn" : "ok"}
              />
            </div>

            <div className="text-xs text-muted-foreground border-t pt-2 flex flex-wrap gap-x-4 gap-y-1">
              <span>
                Last Heal:{" "}
                {data.last_heal_run
                  ? `${new Date(data.last_heal_run).toLocaleString()} (${data.last_heal_status})`
                  : "—"}
              </span>
              <span>Recommendation: {data.recommended_action}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn";
  hint?: string;
}) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-lg font-semibold ${
          tone === "warn" ? "text-warning" : tone === "ok" ? "text-foreground" : ""
        }`}
      >
        {value}
      </div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
