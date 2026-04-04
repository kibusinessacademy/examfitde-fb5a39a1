import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import type { LicenseEvent } from "@/hooks/useStandaloneLicenses";

interface Props {
  events: LicenseEvent[];
}

const typeLabels: Record<string, string> = {
  validated: "Validiert",
  revoked: "Widerrufen",
  suspended: "Suspendiert",
  reactivated: "Reaktiviert",
  expired: "Abgelaufen",
  device_registered: "Gerät registriert",
  device_removed: "Gerät entfernt",
  expiry_extended: "Verlängert",
  status_change: "Status geändert",
};

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ok: "secondary",
  warning: "outline",
  failed: "destructive",
};

export function StandaloneLicenseEventFeed({ events }: Props) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        Keine Events vorhanden.
      </p>
    );
  }

  return (
    <div className="space-y-2 max-h-[400px] overflow-y-auto">
      {events.map((evt) => (
        <div
          key={evt.id}
          className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {typeLabels[evt.event_type] ?? evt.event_type}
              </span>
              <Badge variant={statusVariant[evt.event_status] ?? "outline"} className="text-[10px]">
                {evt.event_status}
              </Badge>
            </div>
            {evt.detail && (
              <pre className="mt-1 text-[11px] text-muted-foreground font-mono whitespace-pre-wrap break-all">
                {JSON.stringify(evt.detail, null, 2)}
              </pre>
            )}
          </div>
          <span className="text-[11px] text-muted-foreground whitespace-nowrap">
            {format(new Date(evt.created_at), "dd.MM.yy HH:mm")}
          </span>
        </div>
      ))}
    </div>
  );
}
