import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, XCircle, FileCheck, Database, FileSearch, AlertTriangle } from "lucide-react";
import { buildRuntimeDiff, summarizeRuntimeDiff } from "@/lib/runtime/diff/runtimeDiff";

interface Props { actionId: string }

interface EvidenceChain {
  action_id: string;
  action_key: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  evidence: Array<{ id: string; kind: string; ref_table: string; ref_id: string; summary: string; created_at: string }>;
  audit_trail: Array<{ id: string; action_type: string; target_id: string; result_status: string; created_at: string; duration_ms: number | null; error_message: string | null }>;
  before_snapshot: unknown;
  after_snapshot: unknown;
  outcome: Record<string, unknown> | null;
  error?: string;
}

const STATUS_ICON: Record<string, JSX.Element> = {
  completed: <CheckCircle2 className="h-4 w-4 text-status-fg-success" />,
  failed: <XCircle className="h-4 w-4 text-status-fg-danger" />,
  running: <Clock className="h-4 w-4 text-status-fg-info animate-pulse" />,
  pending: <Clock className="h-4 w-4 text-muted-foreground" />,
  rolled_back: <AlertTriangle className="h-4 w-4 text-status-fg-warning" />,
};

export default function RuntimeEvidenceDrawer({ actionId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["runtime-evidence-chain", actionId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_runtime_evidence_chain" as never, { _action_id: actionId } as never);
      if (error) throw error;
      return data as unknown as EvidenceChain;
    },
    staleTime: 30_000,
  });

  if (isLoading) return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded bg-muted/30" />)}</div>;
  if (!data || data.error) return <p className="text-sm text-muted-foreground">Not found.</p>;

  const diff = buildRuntimeDiff(data.before_snapshot, data.after_snapshot);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between rounded-md border border-border bg-muted/20 p-3">
        <div className="flex items-center gap-2">
          {STATUS_ICON[data.status] ?? <Clock className="h-4 w-4" />}
          <div>
            <div className="font-mono text-sm">{data.action_key}</div>
            <div className="text-[11px] text-muted-foreground">
              {new Date(data.created_at).toLocaleString()}
              {data.completed_at ? ` → ${new Date(data.completed_at).toLocaleString()}` : ""}
            </div>
          </div>
        </div>
        <Badge variant="outline" className="text-[10px]">{data.status}</Badge>
      </div>

      {/* Timeline */}
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Clock className="h-3.5 w-3.5" /> Lifecycle Timeline
        </h3>
        <ol className="space-y-1.5">
          {[
            { label: "validate", icon: <FileCheck className="h-3.5 w-3.5" />, ok: true },
            { label: "snapshot_before", icon: <Database className="h-3.5 w-3.5" />, ok: !!data.before_snapshot },
            { label: "execute", icon: <Clock className="h-3.5 w-3.5" />, ok: data.status === "completed" || data.status === "rolled_back" },
            { label: "snapshot_after", icon: <Database className="h-3.5 w-3.5" />, ok: !!data.after_snapshot },
            { label: "audit", icon: <FileSearch className="h-3.5 w-3.5" />, ok: data.audit_trail.length > 0 },
          ].map((step) => (
            <li key={step.label} className="flex items-center gap-2 rounded border border-border/50 bg-background px-2 py-1 text-xs">
              <span className={step.ok ? "text-status-fg-success" : "text-muted-foreground/40"}>{step.icon}</span>
              <span className="font-mono">{step.label}</span>
              {step.ok ? <CheckCircle2 className="ml-auto h-3 w-3 text-status-fg-success" /> : <span className="ml-auto text-[10px] text-muted-foreground/60">—</span>}
            </li>
          ))}
        </ol>
      </section>

      {/* Diff inspector */}
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Database className="h-3.5 w-3.5" /> Diff Inspector
          <Badge variant="outline" className="ml-2 text-[10px]">{summarizeRuntimeDiff(diff)}</Badge>
        </h3>
        {diff.entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">No mutations captured between snapshots.</p>
        ) : (
          <div className="space-y-1">
            {diff.entries.slice(0, 30).map((e, i) => (
              <div key={i} className={`flex flex-wrap items-center gap-2 rounded border px-2 py-1 text-xs ${e.critical ? "border-status-border-danger bg-status-bg-subtle-danger" : "border-border bg-background"}`}>
                <Badge variant="outline" className="text-[10px]">{e.kind}</Badge>
                <span className="font-mono text-[11px]">{e.path}</span>
                <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                  <span className="line-through opacity-60">{JSON.stringify(e.before)}</span>
                  <span className="mx-1">→</span>
                  <span className="text-foreground">{JSON.stringify(e.after)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Evidence + Audit */}
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <FileSearch className="h-3.5 w-3.5" /> Evidence Chain ({data.evidence.length})
        </h3>
        {data.evidence.length === 0 ? (
          <p className="text-xs text-muted-foreground">No structured evidence rows.</p>
        ) : (
          <ul className="space-y-1">
            {data.evidence.map((e) => (
              <li key={e.id} className="rounded border border-border/50 bg-background px-2 py-1 text-xs">
                <span className="font-mono">{e.kind}</span> · <span className="text-muted-foreground">{e.ref_table}</span> · {e.summary}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <FileSearch className="h-3.5 w-3.5" /> Audit Trail ({data.audit_trail.length})
        </h3>
        {data.audit_trail.length === 0 ? (
          <p className="text-xs text-muted-foreground">No related auto_heal_log entries.</p>
        ) : (
          <ul className="space-y-1 max-h-64 overflow-y-auto">
            {data.audit_trail.map((a) => (
              <li key={a.id} className="flex items-center gap-2 rounded border border-border/50 bg-background px-2 py-1 text-xs">
                <Badge variant="outline" className="text-[10px]">{a.result_status}</Badge>
                <span className="font-mono">{a.action_type}</span>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                  {new Date(a.created_at).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
