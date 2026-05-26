import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, CheckCircle2, AlertCircle, MinusCircle } from "lucide-react";
import { useSetupRecommendations } from "@/hooks/useSetupRecommendations";
import type { RecSignals } from "@/lib/setup/recommendations";

type Status = "ok" | "warn" | "crit" | "unknown";

interface Row {
  area: string;
  label: string;
  detail: string;
  status: Status;
}

function classify(s: RecSignals): Row[] {
  const rows: Row[] = [];

  // AI Ops
  if (s.ai_observability) {
    rows.push({
      area: "AI",
      label: "Tutor-Evidenz",
      detail: `${s.ai_observability.tutor_no_evidence} Strict-RAG-Verstöße`,
      status: s.ai_observability.tutor_no_evidence === 0 ? "ok"
        : s.ai_observability.tutor_no_evidence > 20 ? "crit" : "warn",
    });
    rows.push({
      area: "AI",
      label: "Failures 24h",
      detail: `${s.ai_observability.failed_24h} fehlgeschlagene Calls`,
      status: s.ai_observability.failed_24h === 0 ? "ok"
        : s.ai_observability.failed_24h > 50 ? "crit" : "warn",
    });
  } else rows.push({ area: "AI", label: "AI Observability", detail: "Kein Zugriff", status: "unknown" });

  // Commerce
  if (s.commerce_gap) {
    rows.push({
      area: "Commerce",
      label: "Stripe & Preise",
      detail: `${s.commerce_gap.published_without_price} Pakete ohne Preis`,
      status: s.commerce_gap.published_without_price === 0 ? "ok" : "crit",
    });
    rows.push({
      area: "Commerce",
      label: "Landingpages",
      detail: `${s.commerce_gap.published_without_landing} Pakete ohne Landing`,
      status: s.commerce_gap.published_without_landing === 0 ? "ok"
        : s.commerce_gap.published_without_landing > 10 ? "warn" : "ok",
    });
  } else rows.push({ area: "Commerce", label: "Commerce-Gap", detail: "Kein Zugriff", status: "unknown" });

  // Content
  if (s.customer_safe) {
    rows.push({
      area: "Content",
      label: "Customer-Safe",
      detail: `${s.customer_safe.customer_safe}/${s.customer_safe.total} Pakete safe`,
      status: s.customer_safe.not_ready === 0 ? "ok"
        : s.customer_safe.not_ready > 50 ? "crit" : "warn",
    });
  } else rows.push({ area: "Content", label: "Customer-Safe", detail: "Kein Zugriff", status: "unknown" });

  if (s.empty_courses) {
    rows.push({
      area: "Content",
      label: "Veröffentlichte Inhalte",
      detail: `${s.empty_courses.count} leere Live-Kurse`,
      status: s.empty_courses.count === 0 ? "ok" : "crit",
    });
  }

  // Infrastructure
  if (s.lane_health) {
    rows.push({
      area: "Infrastructure",
      label: "Job Queue",
      detail: `${s.lane_health.stuck_processing} stuck · ${s.lane_health.pending} pending`,
      status: s.lane_health.stuck_processing > 20 ? "crit"
        : s.lane_health.stuck_processing > 0 ? "warn" : "ok",
    });
  } else rows.push({ area: "Infrastructure", label: "Lane Health", detail: "Kein Zugriff", status: "unknown" });

  if (s.heal_alerts) {
    rows.push({
      area: "Infrastructure",
      label: "Heal Alerts",
      detail: `${s.heal_alerts.open} offen · ${s.heal_alerts.critical} kritisch`,
      status: s.heal_alerts.critical > 0 ? "crit"
        : s.heal_alerts.open > 0 ? "warn" : "ok",
    });
  }

  // Activation
  if (s.wizards) {
    rows.push({
      area: "Activation",
      label: "Integrationen",
      detail: `${s.wizards.connected}/${s.wizards.total} verbunden · ${s.wizards.error} Fehler`,
      status: s.wizards.error > 0 ? "crit"
        : s.wizards.connected / Math.max(1, s.wizards.total) < 0.3 ? "warn" : "ok",
    });
  }

  return rows;
}

const STATUS: Record<Status, { icon: typeof CheckCircle2; cls: string; label: string }> = {
  ok: { icon: CheckCircle2, cls: "text-status-success-text", label: "OK" },
  warn: { icon: AlertCircle, cls: "text-status-warning-text", label: "WARN" },
  crit: { icon: AlertCircle, cls: "text-status-error-text", label: "CRIT" },
  unknown: { icon: MinusCircle, cls: "text-text-muted", label: "—" },
};

export function IntegrationHealthCenterCard({ orgId }: { orgId: string | null }) {
  const { data, isLoading } = useSetupRecommendations(orgId);
  const rows = data?.signals ? classify(data.signals) : [];
  const byArea = rows.reduce<Record<string, Row[]>>((m, r) => {
    (m[r.area] ??= []).push(r);
    return m;
  }, {});

  return (
    <Card className="shadow-elev-1">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-status-info-text" />
          Integration Health Center
        </CardTitle>
        <p className="text-sm text-text-secondary">Nicht „verbunden" — sondern „betriebsbereit?"</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </>
        ) : Object.entries(byArea).map(([area, items]) => (
          <div key={area}>
            <h4 className="text-xs uppercase tracking-wide text-text-muted mb-2">{area}</h4>
            <div className="grid gap-2 sm:grid-cols-2">
              {items.map((row) => {
                const s = STATUS[row.status];
                const Icon = s.icon;
                return (
                  <div key={row.label} className="flex items-start gap-3 rounded-md border border-border-subtle bg-surface-base p-3">
                    <Icon className={`h-4 w-4 mt-0.5 ${s.cls}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-text-primary">{row.label}</span>
                        <Badge variant="outline" className="text-xs">{s.label}</Badge>
                      </div>
                      <p className="text-xs text-text-secondary mt-0.5">{row.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
