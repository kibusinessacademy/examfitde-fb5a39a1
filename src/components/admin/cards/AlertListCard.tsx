import type { CriticalAlertItem } from "@/components/admin/lib/admin-types";

const severityClasses: Record<CriticalAlertItem["severity"], string> = {
  critical: "border-destructive/30 bg-destructive-bg-subtle",
  high: "border-orange-500/30 bg-orange-500/10",
  medium: "border-amber-500/30 bg-amber-500/10",
  low: "border-border bg-card",
};

export function AlertListCard({ alerts }: { alerts: CriticalAlertItem[] }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-4 text-sm font-semibold text-foreground">Kritische Alerts</div>
      <div className="space-y-3">
        {alerts.length === 0 ? (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
            Keine kritischen Alerts.
          </div>
        ) : (
          alerts.map((alert) => (
            <div key={alert.id} className={`rounded-xl border p-4 ${severityClasses[alert.severity]}`}>
              <div className="mb-1 text-sm font-semibold text-foreground">{alert.title}</div>
              <div className="text-sm text-muted-foreground">{alert.detail}</div>
              {alert.action_label && (
                <button className="mt-3 rounded-xl border border-border bg-muted/50 px-3 py-2 text-sm text-foreground hover:bg-muted">
                  {alert.action_label}
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
