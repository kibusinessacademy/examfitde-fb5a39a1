import type { ProviderHealthItem } from "@/components/admin/lib/admin-types";
import { formatDateTime, formatPercent } from "@/components/admin/lib/admin-utils";

const statusColor: Record<ProviderHealthItem["status"], string> = {
  healthy: "text-emerald-400",
  degraded: "text-amber-400",
  cooldown: "text-orange-400",
  down: "text-rose-400",
};

export function ProviderRadarCard({ items }: { items: ProviderHealthItem[] }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-4 text-sm font-semibold text-foreground">Provider Health Radar</div>
      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground">Keine Provider-Daten verfügbar.</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <div key={`${item.provider}-${item.model}`} className="rounded-xl border border-border bg-muted/30 p-4">
              <div className="mb-1 text-sm font-semibold text-foreground">
                {item.provider} · {item.model}
              </div>
              <div className={`mb-3 text-xs font-medium uppercase tracking-[0.18em] ${statusColor[item.status]}`}>
                {item.status}
              </div>
              <div className="space-y-1 text-sm text-muted-foreground">
                <div>Success 1h: {formatPercent(item.success_rate_1h)}</div>
                <div>Latency 1h: {item.avg_latency_ms_1h ?? "–"} ms</div>
                <div>Requests 1h: {item.requests_1h}</div>
                <div>Failures 1h: {item.failures_1h}</div>
                <div>Cooldown bis: {formatDateTime(item.cooldown_until)}</div>
                <div>Top Fehler: {item.top_reason ?? "–"}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
