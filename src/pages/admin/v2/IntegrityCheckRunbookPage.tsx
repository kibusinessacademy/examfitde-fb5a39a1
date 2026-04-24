/**
 * IntegrityCheckRunbookPage
 * ─────────────────────────
 * Per-package runbook for `package_run_integrity_check`:
 *   - Detected likely root causes (ghost-finalization, stale lock, orphan
 *     reconciler, REQUEUE-loop) with severity badges
 *   - One-click "Heal ausführen" buttons that call the matching guarded RPC
 *     (admin_heal_zombie_locked_job, admin_safe_requeue_integrity_check,
 *     admin_mark_requeue_loop_terminal)
 *
 * URL: /admin/v2/runbook/integrity-check?package_id=<uuid>
 */
import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Ghost,
  Loader2,
  RefreshCcw,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getIntegrityRunbook,
  healZombieLockedJob,
  markRequeueLoopTerminal,
  safeRequeueIntegrityCheck,
  type IntegrityRunbook,
} from "@/lib/admin/queue/zombieHealApi";
import { TargetedJobHealPanel } from "@/components/admin/queue/TargetedJobHealPanel";

const ICONS: Record<string, React.ReactNode> = {
  stale_lock: <Ghost className="h-4 w-4" />,
  ghost_finalization: <Ghost className="h-4 w-4" />,
  orphan_no_job: <RefreshCcw className="h-4 w-4" />,
  requeue_loop: <ShieldAlert className="h-4 w-4" />,
};

export default function IntegrityCheckRunbookPage() {
  const [params, setParams] = useSearchParams();
  const [pkgInput, setPkgInput] = useState(params.get("package_id") ?? "");
  const packageId = params.get("package_id") ?? "";
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const runbook = useQuery({
    queryKey: ["integrity-runbook", packageId],
    queryFn: () => getIntegrityRunbook(packageId),
    enabled: !!packageId,
    staleTime: 15_000,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["integrity-runbook", packageId] });

  const healMutation = useMutation({
    mutationFn: async ({ action, target }: { action: string; target: string }) => {
      if (action === "heal_zombie_locked_job") return healZombieLockedJob(target, "runbook_heal");
      if (action === "safe_requeue_integrity_check")
        return safeRequeueIntegrityCheck(target, "runbook_requeue");
      if (action === "mark_requeue_loop_terminal")
        return markRequeueLoopTerminal(target, "runbook_loop_terminal");
      throw new Error(`Unknown heal action: ${action}`);
    },
    onSuccess: (res: any, vars) => {
      if (res?.ok) {
        toast.success(`Heal-Aktion erfolgreich: ${vars.action}`);
        refresh();
      } else {
        toast.error(`Heal blockiert: ${res?.error ?? "unknown"}`);
      }
    },
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => setBusy(null),
  });

  const data: IntegrityRunbook | undefined = runbook.data;
  const causes = data?.causes ?? [];
  const flags = data?.flags;

  return (
    <div className="container mx-auto max-w-4xl space-y-4 p-4">
      <Helmet>
        <title>Runbook · package_run_integrity_check · Admin</title>
        <meta
          name="description"
          content="Per-Paket-Runbook für package_run_integrity_check mit Heal-Aktionen für Ghost-Finalization, Stale Locks und Orphan-Reconciler."
        />
      </Helmet>

      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Runbook · package_run_integrity_check</h1>
        <p className="text-xs text-muted-foreground">
          Erkennt typische Ursachen (Ghost-Finalization, stale Lock, Orphan, REQUEUE-Loop) und
          bietet je einen geguardeten Heal-Button.
        </p>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Paket auswählen</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const next = new URLSearchParams(params);
              if (pkgInput) next.set("package_id", pkgInput);
              else next.delete("package_id");
              setParams(next, { replace: true });
            }}
          >
            <Input
              value={pkgInput}
              onChange={(e) => setPkgInput(e.target.value)}
              placeholder="package_id (UUID)"
              className="font-mono text-xs"
            />
            <Button type="submit" size="sm">
              Analysieren
            </Button>
            {packageId && (
              <Button type="button" size="sm" variant="ghost" onClick={refresh}>
                <RefreshCcw className="mr-1 h-3 w-3" /> Refresh
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      {!packageId && (
        <Card>
          <CardContent className="p-4 text-xs text-muted-foreground">
            Gib eine package_id ein, um die Runbook-Analyse zu starten.
          </CardContent>
        </Card>
      )}

      {packageId && runbook.isLoading && (
        <Card>
          <CardContent className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Analysiere…
          </CardContent>
        </Card>
      )}

      {data?.ok && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Status-Flags</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <Flag label="Stale Lock" on={flags?.stale_lock} />
              <Flag label="Ghost-Final." on={flags?.ghost_finalization} />
              <Flag label="Orphan" on={flags?.orphan_no_job} />
              <Flag label="REQUEUE-Loop" on={flags?.requeue_loop} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Wrench className="h-4 w-4 text-primary" />
                Erkannte Ursachen ({causes.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {causes.length === 0 && (
                <p className="rounded-md bg-emerald-500/10 p-2 text-xs text-emerald-700 dark:text-emerald-400">
                  Keine bekannten Failure-Patterns für dieses Paket erkannt.
                </p>
              )}
              {causes.map((c, i) => (
                <div
                  key={`${c.kind}-${i}`}
                  className={`rounded-md border p-3 ${
                    c.severity === "high"
                      ? "border-destructive/50 bg-destructive/5"
                      : "border-amber-500/40 bg-amber-500/5"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {ICONS[c.kind] ?? <AlertTriangle className="h-4 w-4" />}
                    <strong className="text-sm">{c.title}</strong>
                    <Badge variant="outline" className="ml-1 text-[10px] uppercase">
                      {c.severity}
                    </Badge>
                    <Button
                      size="sm"
                      variant={c.severity === "high" ? "destructive" : "outline"}
                      className="ml-auto h-7 text-[11px]"
                      disabled={busy === c.kind || healMutation.isPending}
                      onClick={() => {
                        setBusy(c.kind);
                        healMutation.mutate({ action: c.heal_action, target: c.heal_target });
                      }}
                    >
                      {busy === c.kind ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>
                          <CheckCircle2 className="mr-1 h-3 w-3" /> Heal ausführen
                        </>
                      )}
                    </Button>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{c.detail}</p>
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                    action={c.heal_action} · target={c.heal_target?.slice(0, 12)}…
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <TargetedJobHealPanel packageId={packageId} />

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Letzter Job + Step</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-64 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[10px]">
                {JSON.stringify({ step: data.step, last_job: data.last_job }, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Flag({ label, on }: { label: string; on?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between rounded-md p-2 ${
        on ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
      }`}
    >
      <span>{label}</span>
      <strong className="tabular-nums">{on ? "JA" : "nein"}</strong>
    </div>
  );
}
