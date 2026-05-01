/**
 * CouncilDeferredCard — Heal-Cockpit Karte für Pakete, die durch
 * fn_auto_defer_stale_council in council_defer_log geparkt wurden.
 *
 * Drei Aktionen pro Paket:
 *   • Retry Council    — neuer QC-Job + clear defer-log
 *   • Force Pass       — admin-override step → done (mit Audit + Reason)
 *   • Mark Content Gap — package → archived + blocked_reason
 *
 * Backend: admin_get_council_deferred_overview() / admin_resolve_council_deferred()
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ShieldAlert, RotateCw, CheckCircle2, Archive } from "lucide-react";

interface OverviewRow {
  package_id: string;
  package_title: string | null;
  defer_reason: string;
  error_codes: string[] | null;
  fail_count: number;
  deferred_at: string;
  age_seconds: number;
  step_status: string | null;
  exam_questions_total: number;
  exam_questions_approved: number;
}

type ResolveAction = "retry_council" | "force_pass" | "mark_content_gap";

const ACTION_LABEL: Record<ResolveAction, string> = {
  retry_council: "Retry Council",
  force_pass: "Force Pass (Override)",
  mark_content_gap: "Als Content-Gap archivieren",
};

const ACTION_ICON: Record<ResolveAction, typeof RotateCw> = {
  retry_council: RotateCw,
  force_pass: CheckCircle2,
  mark_content_gap: Archive,
};

function fmtAge(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

export function CouncilDeferredCard() {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<{
    pkg: OverviewRow;
    action: ResolveAction;
  } | null>(null);
  const [reason, setReason] = useState("");

  const overview = useQuery({
    queryKey: ["admin-council-deferred-overview"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_council_deferred_overview" as any,
      );
      if (error) throw error;
      return (data ?? []) as OverviewRow[];
    },
    refetchInterval: 60_000,
  });

  const resolve = useMutation({
    mutationFn: async (vars: {
      package_id: string;
      action: ResolveAction;
      reason: string;
    }) => {
      const { data, error } = await supabase.rpc(
        "admin_resolve_council_deferred" as any,
        {
          p_package_id: vars.package_id,
          p_action: vars.action,
          p_reason: vars.reason || null,
        },
      );
      if (error) throw error;
      return data as { ok: boolean; reason?: string; action?: string };
    },
    onSuccess: (data, vars) => {
      if (!data?.ok) {
        toast.error(`Resolve fehlgeschlagen: ${data?.reason ?? "unknown"}`);
        return;
      }
      toast.success(`${ACTION_LABEL[vars.action]} ausgeführt`);
      setConfirm(null);
      setReason("");
      qc.invalidateQueries({ queryKey: ["admin-council-deferred-overview"] });
      qc.invalidateQueries({ queryKey: ["admin-heal-status"] });
      qc.invalidateQueries({ queryKey: ["admin-blocked-packages"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Resolve-Fehler"),
  });

  const rows = overview.data ?? [];

  return (
    <Card className="p-4 border-warning/30">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-warning" />
          Council-Deferred (Manual Review)
        </h3>
        <div className="flex gap-2 items-center">
          <Badge variant="outline" className="text-[10px]">
            live · 60s
          </Badge>
          <Badge
            variant={rows.length > 0 ? "destructive" : "secondary"}
            className="text-[10px]"
          >
            {rows.length} offen
          </Badge>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-3">
        Pakete, deren <code className="font-mono">quality_council</code> 3× in
        Folge mit Stale-Worker-Pattern gefehlt hat. Auto-Publish ist gesperrt
        bis ein Admin handelt.
      </p>

      {overview.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">
          Keine Pakete im Council-Defer-Pool ✓
        </p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div
              key={r.package_id}
              className="rounded border border-border/60 p-2 text-xs space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold truncate">
                  {r.package_title ?? r.package_id.slice(0, 8)}
                </span>
                <span className="text-muted-foreground tabular-nums shrink-0">
                  {fmtAge(r.age_seconds)} · {r.fail_count}× fail
                </span>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                <span>{r.defer_reason}</span>
                <span>·</span>
                <span>
                  Q: {r.exam_questions_approved}/{r.exam_questions_total}{" "}
                  approved
                </span>
                <span>·</span>
                <span>step: {r.step_status ?? "—"}</span>
              </div>
              <div className="flex gap-1 flex-wrap">
                {(
                  ["retry_council", "force_pass", "mark_content_gap"] as const
                ).map((action) => {
                  const Icon = ACTION_ICON[action];
                  return (
                    <Button
                      key={action}
                      size="sm"
                      variant={
                        action === "force_pass" ? "default" : "outline"
                      }
                      className="h-6 text-[10px] px-2"
                      onClick={() => setConfirm({ pkg: r, action })}
                      disabled={resolve.isPending}
                    >
                      <Icon className="h-3 w-3 mr-1" />
                      {ACTION_LABEL[action]}
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={!!confirm}
        onOpenChange={(o) => {
          if (!o) {
            setConfirm(null);
            setReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm ? ACTION_LABEL[confirm.action] : ""} bestätigen
            </DialogTitle>
            <DialogDescription>
              <span className="font-semibold">
                {confirm?.pkg.package_title}
              </span>{" "}
              · {confirm?.pkg.exam_questions_approved}/
              {confirm?.pkg.exam_questions_total} approved Fragen
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 text-xs">
            {confirm?.action === "retry_council" && (
              <p>
                Setzt den Step auf <code>queued</code> und enqueued einen
                neuen <code>package_quality_council</code>-Job. Defer-Log wird
                gecleart.
              </p>
            )}
            {confirm?.action === "force_pass" && (
              <p className="text-warning">
                ⚠️ Override: Setzt den Step direkt auf <code>done</code> ohne
                erneuten Quality-Council-Run. Anschließend kann auto_publish
                laufen. Bitte Begründung dokumentieren.
              </p>
            )}
            {confirm?.action === "mark_content_gap" && (
              <p>
                Markiert das Paket als <code>archived</code> mit
                <code> blocked_reason='COUNCIL_DEFERRED_MANUAL_REVIEW'</code>.
                Kann später re-aktiviert werden.
              </p>
            )}

            <Textarea
              placeholder="Begründung (optional, aber empfohlen)…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setConfirm(null);
                setReason("");
              }}
            >
              Abbrechen
            </Button>
            <Button
              size="sm"
              variant={confirm?.action === "force_pass" ? "default" : "default"}
              disabled={resolve.isPending || !confirm}
              onClick={() => {
                if (!confirm) return;
                resolve.mutate({
                  package_id: confirm.pkg.package_id,
                  action: confirm.action,
                  reason,
                });
              }}
            >
              {resolve.isPending ? "Wird ausgeführt…" : "Bestätigen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
