import { useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrgAuditEvents } from "@/hooks/useOrgConsole";
import { ScrollText } from "lucide-react";

function fmt(d: string) {
  return new Date(d).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

export default function OrgActivityPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { data: events, isLoading } = useOrgAuditEvents(orgId);
  const list = (events ?? []) as any[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight">Aktivität</h1>
        <p className="text-sm text-text-secondary mt-1">
          Nachvollziehbare Historie aller Änderungen in deiner Organisation.
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : list.length === 0 ? (
        <Card className="p-12 text-center border-border shadow-elev-1">
          <ScrollText className="h-10 w-10 mx-auto mb-3 text-text-tertiary" />
          <p className="text-sm text-text-secondary">Noch keine Aktivität.</p>
        </Card>
      ) : (
        <Card className="shadow-elev-1 border-border divide-y divide-border overflow-hidden">
          {list.map((e: any, i: number) => (
            <div key={e.id ?? i} className="p-4 hover:bg-surface-1/50">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-sm text-text-primary">
                    {e.event_type ?? e.action_type ?? "Ereignis"}
                  </div>
                  {e.description && (
                    <div className="text-xs text-text-secondary mt-0.5">{e.description}</div>
                  )}
                  {e.details && (
                    <pre className="text-[11px] text-text-tertiary mt-1.5 max-w-full overflow-x-auto bg-surface-1 p-2 rounded">
                      {JSON.stringify(e.details, null, 2)}
                    </pre>
                  )}
                </div>
                <span className="text-xs text-text-tertiary tabular-nums shrink-0">
                  {fmt(e.created_at ?? e.occurred_at ?? new Date().toISOString())}
                </span>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
