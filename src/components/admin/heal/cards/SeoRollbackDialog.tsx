/**
 * SeoRollbackDialog — Step 3 of the SEO Card.
 *
 * Admin-gated toggle for ops_feature_flags.seo_* keys (currently:
 * `seo_sitemap_refresh_producer_enabled`).
 *
 * UX contract:
 *  - Shows current state (Aktuell)
 *  - Shows target state (Nach Toggle)
 *  - Requires Reason (>= 5 chars)
 *  - Confirms in 2 steps via AlertDialog
 *  - Audit-Log via admin_set_seo_feature_flag (writes auto_heal_log)
 *  - Context section: last 10 integrity-gate failures
 *    (integrity_passed=false / QUALITY_THRESHOLD_NOT_MET)
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ShieldAlert, ArrowRight, AlertTriangle } from "lucide-react";
import { parseHealError } from "@/components/admin/queue/healErrorParser";

type GateFailureRow = {
  job_id: string;
  package_id: string | null;
  status: string;
  last_error_code: string | null;
  last_error: string | null;
  integrity_passed: boolean | null;
  score: number | null;
  hard_fail_count: number | null;
  created_at: string;
  age_seconds: number;
};

function fmtAge(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

function StateBadge({ enabled }: { enabled: boolean | null | undefined }) {
  if (enabled === true)
    return (
      <Badge className="bg-success text-success-foreground">enabled</Badge>
    );
  if (enabled === false)
    return <Badge variant="destructive">disabled</Badge>;
  return <Badge variant="outline">unknown</Badge>;
}

export function SeoRollbackDialog({
  open,
  onOpenChange,
  flagKey,
  currentEnabled,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  flagKey: string;
  currentEnabled: boolean | null | undefined;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const target = !currentEnabled;

  const failuresQ = useQuery({
    enabled: open,
    queryKey: ["heal-cockpit", "integrity-gate-failures"],
    queryFn: async (): Promise<GateFailureRow[]> => {
      const { data, error } = await supabase.rpc(
        "admin_get_recent_integrity_gate_failures" as never,
        { p_limit: 10, p_window_minutes: 60 } as never,
      );
      if (error) throw error;
      return (data as unknown as GateFailureRow[]) ?? [];
    },
    staleTime: 30_000,
  });

  const toggleM = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_set_seo_feature_flag" as never,
        { p_flag_key: flagKey, p_enabled: target, p_reason: reason } as never,
      );
      if (error) throw error;
      return data as { previous: boolean; new: boolean; changed: boolean };
    },
    onSuccess: (res) => {
      toast.success(
        res?.changed
          ? `Flag ${flagKey}: ${res.previous} → ${res.new}`
          : `Flag bereits auf ${target}`,
      );
      qc.invalidateQueries({ queryKey: ["heal-cockpit", "seo-feature-flags"] });
      qc.invalidateQueries({ queryKey: ["heal-cockpit", "seo-job-health"] });
      setReason("");
      setConfirmOpen(false);
      onOpenChange(false);
    },
    onError: (err) => {
      const p = parseHealError(err);
      toast.error(p.title, { description: p.description });
      setConfirmOpen(false);
    },
  });

  const reasonValid = reason.trim().length >= 5;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-warning" />
              SEO Feature-Flag Rollback
            </DialogTitle>
            <DialogDescription>
              Destruktive Aktion: deaktiviert/aktiviert{" "}
              <code className="font-mono">{flagKey}</code> in{" "}
              <code className="font-mono">ops_feature_flags</code>.
            </DialogDescription>
          </DialogHeader>

          {/* State diff */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-md border border-border-subtle bg-surface-sunken p-3">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-text-secondary">
                Aktuell
              </div>
              <div className="mt-1">
                <StateBadge enabled={currentEnabled} />
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-text-secondary" />
            <div>
              <div className="text-[10px] uppercase tracking-wide text-text-secondary">
                Nach Toggle
              </div>
              <div className="mt-1 flex items-center gap-2">
                <StateBadge enabled={target} />
                <Switch
                  checked={target}
                  onCheckedChange={() => {
                    /* read-only display */
                  }}
                  disabled
                  aria-label="Ziel-Zustand (read-only Vorschau)"
                />
              </div>
            </div>
          </div>

          {/* Reason */}
          <div className="space-y-1.5">
            <Label htmlFor="seo-rb-reason" className="text-xs">
              Grund (Pflicht, ≥ 5 Zeichen) — wird in{" "}
              <code className="font-mono">auto_heal_log</code> protokolliert
            </Label>
            <Textarea
              id="seo-rb-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="z. B. Sitemap-Producer wirft EMPTY_RESULT-Loop, pause bis Handler-Patch greift"
              rows={2}
            />
          </div>

          {/* Integrity-Gate context */}
          <section className="space-y-1.5">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
              <AlertTriangle className="h-3.5 w-3.5 text-warning" />
              Integrity-Gate-Failures (60-Min-Fenster)
            </h3>
            <p className="text-[11px] text-text-secondary">
              Kontext: Pakete, deren Integrity-Job mit{" "}
              <code className="font-mono">integrity_passed=false</code> oder{" "}
              <code className="font-mono">QUALITY_THRESHOLD_NOT_MET</code>{" "}
              endete. Hilft zu beurteilen, ob der Rollback orthogonal zum
              Pipeline-Stress ist.
            </p>
            <ScrollArea className="max-h-48 rounded-md border border-border-subtle">
              {failuresQ.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : failuresQ.isError ? (
                <div className="px-3 py-2 text-xs text-destructive">
                  Fehler: {(failuresQ.error as Error).message}
                </div>
              ) : (failuresQ.data ?? []).length === 0 ? (
                <div className="px-3 py-2 text-xs text-text-secondary">
                  Keine Integrity-Gate-Failures im Fenster — Pipeline grün.
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border-subtle text-left text-text-secondary">
                      <th className="px-2 py-1.5 font-medium">Status</th>
                      <th className="px-2 py-1.5 font-medium">passed</th>
                      <th className="px-2 py-1.5 font-medium">Code</th>
                      <th className="px-2 py-1.5 text-right font-medium">
                        Score
                      </th>
                      <th className="px-2 py-1.5 text-right font-medium">
                        Hard
                      </th>
                      <th className="px-2 py-1.5 text-right font-medium">
                        Alter
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(failuresQ.data ?? []).map((f) => (
                      <tr
                        key={f.job_id}
                        className="border-b border-border-subtle/60"
                      >
                        <td className="px-2 py-1.5">
                          <Badge
                            variant={
                              f.status === "failed" ? "destructive" : "outline"
                            }
                            className="font-mono text-[10px]"
                          >
                            {f.status}
                          </Badge>
                        </td>
                        <td className="px-2 py-1.5 font-mono">
                          {f.integrity_passed === null
                            ? "—"
                            : String(f.integrity_passed)}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-text-primary">
                          {f.last_error_code ?? f.last_error ?? "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {f.score ?? "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {f.hard_fail_count ?? "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-text-secondary">
                          {fmtAge(f.age_seconds)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </ScrollArea>
          </section>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button
              variant={target ? "default" : "destructive"}
              disabled={!reasonValid || toggleM.isPending}
              onClick={() => setConfirmOpen(true)}
            >
              {target ? "Aktivieren" : "Deaktivieren"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Toggle bestätigen</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <div>
                  <code className="font-mono">{flagKey}</code>:{" "}
                  <span className="font-mono">
                    {String(currentEnabled)} → {String(target)}
                  </span>
                </div>
                <div className="text-xs text-text-secondary">
                  Grund: <em>{reason}</em>
                </div>
                <div className="text-[11px] text-text-secondary">
                  Wird in <code className="font-mono">auto_heal_log</code>{" "}
                  protokolliert (action_type=
                  <code className="font-mono">seo_feature_flag_toggle</code>).
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={toggleM.isPending}>
              Abbrechen
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={toggleM.isPending}
              onClick={(e) => {
                e.preventDefault();
                toggleM.mutate();
              }}
            >
              {toggleM.isPending ? "Speichere…" : "Bestätigen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
