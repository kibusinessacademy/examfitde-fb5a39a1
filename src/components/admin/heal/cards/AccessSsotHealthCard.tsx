import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import {
  RefreshCw,
  Wrench,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Info,
  Clock,
  Loader2,
} from "lucide-react";
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

function fmtAgo(ts: string | null): string {
  if (!ts) return "—";
  const diffMs = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return "gerade eben";
  if (m < 60) return `vor ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `vor ${h} h`;
  return `vor ${Math.floor(h / 24)} d`;
}

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
    if (error) {
      toast.error(`Repair fehlgeschlagen: ${error.message}`);
      return;
    }
    toast.success("Access-SSOT Drift-Heal ausgeführt — Lade neue Metriken…");
    await load();
  };

  const realPaidDrift = data
    ? Math.max(0, (data.paid_without_grant_with_items ?? 0) - (data.paid_without_grant_smoke ?? 0))
    : 0;
  const grantsDrift = data?.grants_without_entitlement_real ?? 0;
  const tutorBlocked = data?.tutor_blocked_due_to_access_drift ?? 0;
  const storageBlocked = data?.storage_blocked_due_to_access_drift ?? 0;
  const productsBroken = data?.products_without_curriculum_id ?? 0;

  const totalDrift = realPaidDrift + grantsDrift + tutorBlocked + storageBlocked;
  const isHealthy = totalDrift === 0;
  const severity: "ok" | "warn" | "critical" = isHealthy
    ? "ok"
    : tutorBlocked + storageBlocked > 0
      ? "critical"
      : "warn";

  const statusBadge =
    severity === "ok" ? (
      <Badge variant="secondary" className="bg-success-bg-subtle text-success">
        healthy
      </Badge>
    ) : severity === "critical" ? (
      <Badge variant="destructive">drift · users blocked</Badge>
    ) : (
      <Badge className="bg-warning-bg-subtle text-warning border border-warning/30">
        drift detected
      </Badge>
    );

  return (
    <TooltipProvider delayDuration={150}>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              {severity === "ok" ? (
                <ShieldCheck className="h-4 w-4 text-success" />
              ) : severity === "critical" ? (
                <ShieldAlert className="h-4 w-4 text-destructive" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-warning" />
              )}
              Access SSOT Health
              {data && statusBadge}
            </CardTitle>
            <CardDescription className="text-xs">
              Kauf → Grant → Entitlement → Tutor / Storage. Single Choke-Point seit 2026-05-10.
              Auto-Heal alle 15 min, manueller Repair-Button unten.
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void load()}
                disabled={loading || repairing}
                aria-label="Reload metrics"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                )}
                Reload
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    onClick={() => void runRepair()}
                    disabled={repairing || loading}
                    variant={severity === "ok" ? "secondary" : "default"}
                  >
                    {repairing ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <Wrench className="h-3.5 w-3.5 mr-1" />
                    )}
                    {repairing ? "Repair läuft…" : "Repair Now"}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[260px]">
                  Backfillt fehlende Grants aus paid orders + fehlende Entitlements aus aktiven
                  Grants. 9-min Cooldown — sicher mehrfach klickbar.
                </TooltipContent>
              </Tooltip>
            </div>
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Letzter Heal: {fmtAgo(data?.last_heal_run ?? null)}
              {data?.last_heal_status && ` · ${data.last_heal_status}`}
            </span>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {err && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Fehler beim Laden</AlertTitle>
              <AlertDescription className="text-xs">{err}</AlertDescription>
            </Alert>
          )}

          {!data ? (
            <div className="text-sm text-muted-foreground">Lade Health-Metriken…</div>
          ) : (
            <>
              {/* Drift Risk Banner */}
              {!isHealthy && (
                <Alert
                  variant={severity === "critical" ? "destructive" : "default"}
                  className={
                    severity === "critical"
                      ? ""
                      : "border-warning/40 bg-warning-bg-subtle text-warning-foreground"
                  }
                >
                  <ShieldAlert className="h-4 w-4" />
                  <AlertTitle className="text-sm">
                    {severity === "critical"
                      ? `${tutorBlocked + storageBlocked} Käufer aktiv blockiert`
                      : `Drift-Risiko: ${totalDrift} Datensatz(e) brauchen Heilung`}
                  </AlertTitle>
                  <AlertDescription className="text-xs space-y-1 mt-1">
                    <ul className="list-disc list-inside space-y-0.5">
                      {realPaidDrift > 0 && (
                        <li>
                          <strong>{realPaidDrift}</strong> bezahlte Bestellungen ohne Grant (echte
                          Käufer, ohne Smoke-Tests)
                        </li>
                      )}
                      {grantsDrift > 0 && (
                        <li>
                          <strong>{grantsDrift}</strong> aktive Grants ohne Entitlement-Bridge
                        </li>
                      )}
                      {tutorBlocked > 0 && (
                        <li className="font-medium">
                          <strong>{tutorBlocked}</strong> AI-Tutor-Zugriffe blockiert
                        </li>
                      )}
                      {storageBlocked > 0 && (
                        <li className="font-medium">
                          <strong>{storageBlocked}</strong> PDF/Storage-Zugriffe blockiert
                        </li>
                      )}
                    </ul>
                    <div className="pt-1 italic">
                      Empfehlung: <span className="not-italic font-medium">{data.recommended_action}</span>
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {isHealthy && (
                <Alert className="border-success/40 bg-success-bg-subtle">
                  <ShieldCheck className="h-4 w-4 text-success" />
                  <AlertTitle className="text-sm text-success">Alles synchron</AlertTitle>
                  <AlertDescription className="text-xs">
                    Keine echten Käufer im Drift, keine blockierten Tutor- oder Storage-Zugriffe.
                    {data.recommended_action && data.recommended_action !== "none" && (
                      <span className="block mt-1 italic">Hinweis: {data.recommended_action}</span>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                <Metric
                  label="Paid Orders"
                  value={data.paid_orders_total}
                  hint="Gesamtzahl bezahlter Bestellungen"
                />
                <Metric
                  label="Paid o. Grant (real)"
                  value={realPaidDrift}
                  tone={realPaidDrift > 0 ? "warn" : "ok"}
                  hint={`${data.paid_without_grant_with_items} mit items, davon ${data.paid_without_grant_smoke} Smoke`}
                />
                <Metric label="Active Grants" value={data.active_grants_total} />
                <Metric
                  label="Grants o. Entitlement"
                  value={grantsDrift}
                  tone={grantsDrift > 0 ? "warn" : "ok"}
                  hint="echte User (ohne Smoke-Accounts)"
                />
                <Metric
                  label="Tutor blocked"
                  value={tutorBlocked}
                  tone={tutorBlocked > 0 ? "critical" : "ok"}
                  hint="Käufer, die AI-Tutor nicht öffnen können"
                />
                <Metric
                  label="Storage blocked"
                  value={storageBlocked}
                  tone={storageBlocked > 0 ? "critical" : "ok"}
                  hint="Käufer ohne PDF/Handbuch-Zugriff"
                />
                <Metric label="Active Entitlements" value={data.active_entitlements_total} />
                <Metric
                  label="Products o. Curriculum"
                  value={productsBroken}
                  tone={productsBroken > 0 ? "warn" : "ok"}
                  hint="Produkte ohne curriculum_id — Access-Drift-Quelle"
                />
              </div>

              <div className="text-[10px] text-muted-foreground border-t pt-2 flex items-center gap-1">
                <Info className="h-3 w-3" />
                Snapshot generiert: {new Date(data.generated_at).toLocaleTimeString()} · Auto-Heal-Cron
                läuft im 15-min-Takt.
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
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
  tone?: "ok" | "warn" | "critical";
  hint?: string;
}) {
  const toneCls =
    tone === "critical"
      ? "text-destructive"
      : tone === "warn"
        ? "text-warning"
        : "text-foreground";
  const borderCls =
    tone === "critical"
      ? "border-destructive/30 bg-destructive-bg-subtle"
      : tone === "warn"
        ? "border-warning/30 bg-warning-bg-subtle"
        : "border-border";
  return (
    <div className={`rounded-md border p-2 ${borderCls}`}>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`text-lg font-semibold ${toneCls}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground leading-tight">{hint}</div>}
    </div>
  );
}
