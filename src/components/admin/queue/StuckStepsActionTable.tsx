/**
 * StuckStepsActionTable
 * ─────────────────────
 * Tabelle aller pending_enqueue Steps mit:
 *   - Alter, Package-ID, Step-Name, Fix-Prognose
 *   - Force-Reschedule (bypass min_age)  → eligible_now + manual_review_required
 *   - Cancel → blocked (für hoffnungslose Cases)
 *
 * Strikt getrennt: queued/blocked Pakete werden NICHT angefasst, nur über die
 * Course-Workspace „Entblockieren & Starten"-Aktion.
 */
import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Zap, Ban, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import {
  fetchStuckSteps, forceRescheduleStep, cancelPendingEnqueueStep,
  type StuckStepRow, type FixPrognosis,
} from "@/lib/admin/queue/pendingEnqueueApi";
import { toast } from "@/hooks/use-toast";

const PROGNOSIS_VARIANT: Record<FixPrognosis, "default" | "secondary" | "destructive" | "outline"> = {
  eligible_now: "default",
  awaiting_min_age: "secondary",
  blocked_by_active_job: "outline",
  blocked_by_package_status: "outline",
  manual_review_required: "destructive",
};

const PROGNOSIS_LABEL: Record<FixPrognosis, string> = {
  eligible_now: "Eligible jetzt",
  awaiting_min_age: "Wartet auf min_age",
  blocked_by_active_job: "Aktiver Job",
  blocked_by_package_status: "Pkg ≠ building",
  manual_review_required: "Manual Review",
};

function fmtAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

interface PendingAction {
  type: "force" | "cancel";
  row: StuckStepRow;
}

export function StuckStepsActionTable() {
  const [rows, setRows] = useState<StuckStepRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchStuckSteps());
    } catch (e) {
      toast({ title: "Fehler", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const runAction = async () => {
    if (!pending) return;
    const key = `${pending.row.package_id}:${pending.row.step_key}`;
    setBusyKey(key);
    try {
      const res = pending.type === "force"
        ? await forceRescheduleStep(pending.row.package_id, pending.row.step_key)
        : await cancelPendingEnqueueStep(pending.row.package_id, pending.row.step_key,
            cancelReason || "admin_cancel");
      if (res.ok) {
        toast({
          title: pending.type === "force" ? "Step reschedult" : "Step abgebrochen",
          description: `${pending.row.step_key}`,
        });
      } else {
        toast({ title: "Aktion fehlgeschlagen", description: res.error ?? "unbekannt", variant: "destructive" });
      }
      setPending(null); setCancelReason("");
      load();
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Stuck Pending-Enqueue Steps</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {rows.length} Steps · Alter, Fix-Prognose, alternativer Heal-Pfad pro Step
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4">✅ Keine stuck Steps.</p>
          ) : (
            <div className="overflow-auto max-h-[600px]">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead>Step</TableHead>
                    <TableHead>Paket</TableHead>
                    <TableHead className="w-24">Alter</TableHead>
                    <TableHead className="w-44">Fix-Prognose</TableHead>
                    <TableHead className="w-56 text-right">Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const key = `${r.package_id}:${r.step_key}`;
                    const isBusy = busyKey === key;
                    const canForce = r.fix_prognosis === "eligible_now"
                                  || r.fix_prognosis === "manual_review_required";
                    return (
                      <TableRow key={key}>
                        <TableCell>
                          <code className="text-xs font-medium">{r.step_key}</code>
                          {r.manual_review_failure_count !== null && (
                            <div className="text-xs text-destructive mt-0.5">
                              {r.manual_review_failure_count}× failed
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="max-w-xs">
                          <div className="text-sm truncate">{r.package_title ?? "—"}</div>
                          <code className="text-xs text-muted-foreground truncate block">
                            {r.package_id.slice(0, 8)}…
                          </code>
                          {r.package_status && (
                            <Badge variant="outline" className="mt-0.5 text-xs">
                              pkg: {r.package_status}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={r.age_seconds > 1800 ? "destructive" : "secondary"}>
                            {fmtAge(r.age_seconds)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={PROGNOSIS_VARIANT[r.fix_prognosis]}>
                            {PROGNOSIS_LABEL[r.fix_prognosis]}
                          </Badge>
                          {r.manual_review_last_error && (
                            <div className="text-xs text-muted-foreground mt-1 truncate max-w-xs"
                                 title={r.manual_review_last_error}>
                              {r.manual_review_last_error}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            <Button
                              size="sm" variant="outline"
                              disabled={!canForce || isBusy}
                              onClick={() => setPending({ type: "force", row: r })}
                              title={canForce ? "Sofort-Reschedule" : "Nicht eligible"}
                            >
                              {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                              <span className="ml-1">Force</span>
                            </Button>
                            <Button
                              size="sm" variant="ghost"
                              disabled={isBusy}
                              onClick={() => setPending({ type: "cancel", row: r })}
                              title="Step → blocked"
                            >
                              <Ban className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.type === "force" ? "Force-Reschedule ausführen?" : "Step abbrechen?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Step <code className="font-mono">{pending?.row.step_key}</code><br/>
                  Paket: {pending?.row.package_title ?? pending?.row.package_id}
                </p>
                {pending?.type === "force" ? (
                  <p className="text-sm">
                    Setzt Status auf <code>queued</code>, bypasst min_age. Wird durch
                    existence-guard auf job_queue weiter geschützt.
                  </p>
                ) : (
                  <>
                    <p className="text-sm">
                      Setzt Status auf <code>blocked</code>. Offene Manual-Review-Einträge
                      werden als <code>wont_fix</code> geschlossen.
                    </p>
                    <Input
                      placeholder="Grund (z. B. cascade_trigger_conflict_unrecoverable)"
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                    />
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={runAction}>Ausführen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
