/**
 * JobCancelAuditSummary
 * ─────────────────────
 * Compact audit-trail panel for a cancelled or terminal job:
 *   - Reason code, step name, started_at / last heartbeat
 *   - Linked admin_actions (cancellations, heals)
 *   - Linked orphan-reconciler actions
 */
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronRight, Clock, Loader2, Wrench } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getJobCancelAuditSummary } from "@/lib/admin/queue/zombieHealApi";
import { Link } from "react-router-dom";

function fmt(ts?: string | null) {
  if (!ts) return "–";
  return new Date(ts).toLocaleString();
}

export function JobCancelAuditSummary({ jobId }: { jobId: string }) {
  const q = useQuery({
    queryKey: ["job-cancel-audit", jobId],
    queryFn: () => getJobCancelAuditSummary(jobId),
    enabled: !!jobId,
    staleTime: 30_000,
  });

  if (q.isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border p-3 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Lade Audit-Trail…
      </div>
    );
  }
  if (q.error || !q.data?.ok) {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
        Audit-Trail nicht verfügbar: {(q.error as Error)?.message ?? "unknown"}
      </div>
    );
  }

  const d = q.data;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Wrench className="h-4 w-4 text-primary" />
          Audit-Zusammenfassung · {d.job_type}
          <Badge variant="outline" className="text-[10px]">{d.status}</Badge>
          {d.reason_code && (
            <Badge variant="destructive" className="text-[10px]">
              {d.reason_code}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <KV k="Step" v={d.step_key ?? "–"} />
          <KV k="Step-Status" v={d.step_status ?? "–"} />
          <KV k="Attempts" v={String(d.attempts ?? 0)} />
          <KV k="Locked by" v={d.locked_by ?? "–"} mono />
          <KV k="Started" v={fmt(d.started_at)} icon={<Clock className="h-3 w-3" />} />
          <KV k="Heartbeat" v={fmt(d.last_heartbeat_at)} icon={<Clock className="h-3 w-3" />} />
          <KV k="Locked at" v={fmt(d.locked_at)} icon={<Clock className="h-3 w-3" />} />
          <KV k="Completed" v={fmt(d.completed_at)} icon={<Clock className="h-3 w-3" />} />
        </div>
        {d.last_error && (
          <div className="rounded-md bg-muted/40 p-2 font-mono text-[10px] leading-snug text-muted-foreground">
            {d.last_error}
          </div>
        )}
        <Section title={`Admin-Aktionen (${d.admin_actions?.length ?? 0})`}>
          {(d.admin_actions ?? []).length === 0 ? (
            <p className="text-muted-foreground">Keine Einträge.</p>
          ) : (
            <ul className="space-y-1">
              {(d.admin_actions ?? []).slice(0, 8).map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-2 rounded-md border border-border px-2 py-1"
                >
                  <CheckCircle2 className="h-3 w-3 text-primary" />
                  <span className="font-medium">{a.action}</span>
                  {a.reason && (
                    <Badge variant="outline" className="text-[9px]">
                      {a.reason}
                    </Badge>
                  )}
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {fmt(a.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title={`Reconciler-Aktionen (${d.reconciler_actions?.length ?? 0})`}>
          {(d.reconciler_actions ?? []).length === 0 ? (
            <p className="text-muted-foreground">Keine verlinkten Reconciler-Aktionen.</p>
          ) : (
            <ul className="space-y-1">
              {(d.reconciler_actions ?? []).slice(0, 6).map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-2 rounded-md border border-border px-2 py-1"
                >
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  <span className="font-medium">{a.action}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {fmt(a.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        {d.package_id && (
          <Link
            to={`/admin/v2/runbook/integrity-check?package_id=${d.package_id}`}
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            Runbook für Paket öffnen <ChevronRight className="h-3 w-3" />
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

function KV({ k, v, mono, icon }: { k: string; v: string; mono?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1">
      {icon}
      <span className="text-muted-foreground">{k}:</span>
      <span className={mono ? "font-mono text-[10px]" : ""}>{v}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      {children}
    </div>
  );
}
