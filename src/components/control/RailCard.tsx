import { cn } from "@/lib/utils";

interface RailCardProps {
  title: string;
  items: any[];
  renderMeta?: (item: any) => string;
  maxItems?: number;
}

function severityDot(severity?: string) {
  if (severity === "critical") return "bg-destructive";
  if (severity === "warn" || severity === "warning") return "bg-amber-500";
  return "bg-muted-foreground/40";
}

export default function RailCard({ title, items, renderMeta, maxItems = 10 }: RailCardProps) {
  const visible = items.slice(0, maxItems);
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-semibold text-sm">{title}</span>
        {items.length > 0 && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{items.length}</span>
        )}
      </div>
      <div className="space-y-2">
        {visible.length === 0 && (
          <div className="text-sm text-muted-foreground">Keine Einträge</div>
        )}
        {visible.map((item, idx) => (
          <div key={item.id || item.source_id || idx} className="rounded-xl border border-border p-3">
            <div className="flex items-center gap-2">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", severityDot(item.severity))} />
              <span className="font-medium text-sm truncate">
                {item.title || item.probe_key || item.cron_key || item.violation_type || item.action_type || "–"}
              </span>
            </div>
            {item.message && (
              <div className="mt-1 text-xs text-muted-foreground line-clamp-2">{item.message}</div>
            )}
            {renderMeta && (
              <div className="mt-1 text-xs text-muted-foreground">{renderMeta(item)}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
