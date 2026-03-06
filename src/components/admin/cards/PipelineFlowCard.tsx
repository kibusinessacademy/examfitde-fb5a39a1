import type { PipelineStepStat } from "@/components/admin/lib/admin-types";

export function PipelineFlowCard({ items }: { items: PipelineStepStat[] }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-4 text-sm font-semibold text-foreground">Pipeline Flow Map</div>
      <div className="space-y-3">
        {items.length === 0 ? (
          <div className="text-sm text-muted-foreground">Keine Pipeline-Daten verfügbar.</div>
        ) : (
          items.map((item) => {
            const total = item.queued + item.running + item.blocked + item.done + item.failed;
            const donePct = total > 0 ? (item.done / total) * 100 : 0;
            return (
              <div key={item.step_key} className="rounded-xl border border-border bg-muted/30 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">{item.step_key}</span>
                  <span className="text-xs text-muted-foreground">{donePct.toFixed(0)}%</span>
                </div>
                {/* Progress bar */}
                <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${donePct}%` }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                  <div className="rounded-lg bg-muted px-2 py-1.5 text-muted-foreground">Q: {item.queued}</div>
                  <div className="rounded-lg bg-muted px-2 py-1.5 text-blue-400">R: {item.running}</div>
                  <div className="rounded-lg bg-muted px-2 py-1.5 text-amber-400">B: {item.blocked}</div>
                  <div className="rounded-lg bg-muted px-2 py-1.5 text-emerald-400">D: {item.done}</div>
                  <div className="rounded-lg bg-muted px-2 py-1.5 text-rose-400">F: {item.failed}</div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
