/**
 * InternalLinkMaterializationCard — E3c
 * SSOT: v_internal_link_materialization_candidates via admin RPCs.
 * Materialize via admin_materialize_internal_links(p_limit, p_dry_run, p_reason).
 *
 * Pflicht-Anatomie (Leitstelle):
 *  - Status-Badge (OK/WARN/CRIT) anhand READY-Count
 *  - Decision Summary mit Counts pro Decision
 *  - Dry-Run Button (sicher, Default)
 *  - Live-Apply mit Pflicht-Reason (>=5 chars)
 *  - letzte 10 Audit-Runs
 *  - keine direkten Table-Reads, nur RPCs
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Link2, Wrench, AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

type DecisionRow = { decision: string; count: number };
type RecentRow = {
  id: string;
  action_type: string;
  result_status: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const DECISION_ORDER = [
  "READY_TO_MATERIALIZE",
  "ALREADY_ACTIVE",
  "DUPLICATE_LINK",
  "SOURCE_NOT_PUBLISHED",
  "TARGET_NOT_PUBLISHED",
  "ANCHOR_MISSING",
  "UNSAFE_CONTENT_STATE",
  "NO_ACTION",
];

function decisionTone(d: string): "success" | "warning" | "info" | "ghost" {
  if (d === "READY_TO_MATERIALIZE") return "success";
  if (d === "ALREADY_ACTIVE") return "info";
  if (d === "DUPLICATE_LINK" || d === "UNSAFE_CONTENT_STATE") return "warning";
  return "ghost";
}

export function InternalLinkMaterializationCard() {
  const qc = useQueryClient();
  const [liveOpen, setLiveOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [limit, setLimit] = useState(25);

  const summary = useQuery({
    queryKey: ["e3c-internal-link-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_internal_link_materialization_summary" as any,
      );
      if (error) throw error;
      return (data ?? []) as DecisionRow[];
    },
    refetchInterval: 60_000,
  });

  const recent = useQuery({
    queryKey: ["e3c-internal-link-recent"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_internal_link_materialization_recent" as any,
        { p_limit: 10 },
      );
      if (error) throw error;
      return (data ?? []) as RecentRow[];
    },
    refetchInterval: 60_000,
  });

  const dryRun = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_materialize_internal_links" as any,
        { p_limit: limit, p_dry_run: true },
      );
      if (error) throw error;
      return data as { applied: number; detected: { ready: number } };
    },
    onSuccess: (d) => {
      toast.success(`Dry-Run: ${d.applied} würden materialisiert (READY: ${d.detected?.ready ?? "?"})`);
      qc.invalidateQueries({ queryKey: ["e3c-internal-link-recent"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Dry-Run fehlgeschlagen"),
  });

  const liveRun = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_materialize_internal_links" as any,
        { p_limit: limit, p_dry_run: false, p_reason: reason },
      );
      if (error) throw error;
      return data as { applied: number; skipped: number };
    },
    onSuccess: (d) => {
      toast.success(`Live: ${d.applied} materialisiert (${d.skipped} skipped)`);
      setLiveOpen(false);
      setReason("");
      qc.invalidateQueries({ queryKey: ["e3c-internal-link-summary"] });
      qc.invalidateQueries({ queryKey: ["e3c-internal-link-recent"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Apply fehlgeschlagen"),
  });

  const counts = new Map<string, number>();
  (summary.data ?? []).forEach((r) => counts.set(r.decision, Number(r.count)));
  const ready = counts.get("READY_TO_MATERIALIZE") ?? 0;
  const active = counts.get("ALREADY_ACTIVE") ?? 0;
  const blockers = Array.from(counts.entries())
    .filter(([d]) => !["READY_TO_MATERIALIZE", "ALREADY_ACTIVE"].includes(d))
    .reduce((s, [, c]) => s + c, 0);

  const status =
    ready > 0 ? "READY" : blockers > 0 ? "BLOCKED" : "OK";
  const statusBadge =
    status === "READY"
      ? { variant: "default" as const, label: `${ready} ready` }
      : status === "BLOCKED"
        ? { variant: "outline" as const, label: `${blockers} blocked` }
        : { variant: "secondary" as const, label: "idle" };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Link2 className="h-4 w-4" /> Internal Link Materialization (E3c)
          <Badge variant={statusBadge.variant} className="text-[10px]">
            {statusBadge.label}
          </Badge>
          <Badge variant="secondary" className="text-[10px]">
            {active} active
          </Badge>
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            type="number"
            min={1}
            max={100}
            value={limit}
            onChange={(e) =>
              setLimit(Math.min(100, Math.max(1, Number(e.target.value) || 1)))
            }
            className="h-8 w-20 text-xs"
            aria-label="Limit (max 100)"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={dryRun.isPending}
            onClick={() => dryRun.mutate()}
          >
            Dry-Run
          </Button>
          <Dialog open={liveOpen} onOpenChange={setLiveOpen}>
            <DialogTrigger asChild>
              <Button size="sm" disabled={ready === 0}>
                <Wrench className="h-3.5 w-3.5 mr-1.5" /> Live Apply
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-warning" />
                  Live-Apply bestätigen
                </DialogTitle>
                <DialogDescription>
                  Materialisiert bis zu <strong>{limit}</strong>{" "}
                  READY_TO_MATERIALIZE Suggestions (Status → <code>active</code>).
                  Idempotent, kein Re-Apply auf bereits aktive Links.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <label className="text-xs font-medium">Reason (≥5 Zeichen, Pflicht)</label>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="z. B. E3c initial materialization wave"
                />
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setLiveOpen(false)}>
                  Abbrechen
                </Button>
                <Button
                  disabled={reason.trim().length < 5 || liveRun.isPending}
                  onClick={() => liveRun.mutate()}
                >
                  Apply
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {summary.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : summary.isError ? (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          {(summary.error as Error)?.message ?? "Summary load failed"}
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          {DECISION_ORDER.map((d) => {
            const c = counts.get(d) ?? 0;
            return (
              <div
                key={d}
                className="border rounded-md px-2 py-1.5 text-[11px] flex flex-col"
              >
                <span className="text-text-tertiary truncate" title={d}>
                  {d.replace(/_/g, " ").toLowerCase()}
                </span>
                <span className="tabular-nums font-semibold">
                  <Badge
                    variant={decisionTone(d) === "success" ? "default" : "outline"}
                    className="text-[10px]"
                  >
                    {c}
                  </Badge>
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="border-t pt-2">
        <p className="text-[11px] font-medium text-text-secondary mb-1 flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" /> Letzte Audit-Runs
        </p>
        {recent.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (recent.data?.length ?? 0) === 0 ? (
          <p className="text-[11px] text-muted-foreground">Keine Runs.</p>
        ) : (
          <ul className="text-[11px] space-y-0.5 max-h-48 overflow-auto">
            {recent.data!.map((r) => {
              const m = (r.metadata ?? {}) as Record<string, any>;
              const tag = r.action_type.replace("internal_link_materialization_", "");
              return (
                <li
                  key={r.id}
                  className="flex justify-between gap-2 border-b last:border-0 py-0.5"
                >
                  <span className="truncate">
                    <Badge variant="outline" className="text-[10px] mr-1">
                      {tag}
                    </Badge>
                    {m.reason ?? m.decision ?? ""}
                  </span>
                  <span className="text-text-tertiary tabular-nums">
                    {new Date(r.created_at).toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground mt-2">
        SSOT: <code>v_internal_link_materialization_candidates</code> ·{" "}
        <code>admin_materialize_internal_links</code> · Audit:{" "}
        <code>internal_link_materialization_*</code>
      </p>
    </Card>
  );
}
