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
import { useEffect, useMemo, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ShieldAlert,
  ArrowRight,
  AlertTriangle,
  History,
  CheckCircle2,
  PowerOff,
  Activity,
  Filter as FilterIcon,
} from "lucide-react";
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

  // Filter state (debounced 300ms for text/number inputs)
  const [filterMinScore, setFilterMinScore] = useState<string>("");
  const [filterErrorCode, setFilterErrorCode] = useState<string>("");
  const [filterPackageId, setFilterPackageId] = useState<string>("");
  const [filterHardFailOnly, setFilterHardFailOnly] = useState(false);
  const [debouncedFilters, setDebouncedFilters] = useState({
    minScore: "",
    errorCode: "",
    packageId: "",
  });
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedFilters({
        minScore: filterMinScore.trim(),
        errorCode: filterErrorCode.trim(),
        packageId: filterPackageId.trim(),
      });
    }, 300);
    return () => clearTimeout(t);
  }, [filterMinScore, filterErrorCode, filterPackageId]);

  const filterParams = useMemo(() => {
    const params: Record<string, unknown> = { p_limit: 10, p_window_minutes: 60 };
    const ms = debouncedFilters.minScore ? Number(debouncedFilters.minScore) : NaN;
    if (Number.isFinite(ms)) params.p_min_score = ms;
    if (debouncedFilters.errorCode) params.p_error_code = debouncedFilters.errorCode;
    // basic uuid sanity (36 chars w/ dashes); skip otherwise to avoid 22P02
    if (/^[0-9a-f-]{36}$/i.test(debouncedFilters.packageId)) {
      params.p_package_id = debouncedFilters.packageId;
    }
    if (filterHardFailOnly) params.p_hard_fail_only = true;
    return params;
  }, [debouncedFilters, filterHardFailOnly]);

  const filtersActive =
    !!debouncedFilters.minScore ||
    !!debouncedFilters.errorCode ||
    /^[0-9a-f-]{36}$/i.test(debouncedFilters.packageId) ||
    filterHardFailOnly;

  const failuresQ = useQuery({
    enabled: open,
    queryKey: ["heal-cockpit", "integrity-gate-failures", filterParams],
    queryFn: async (): Promise<GateFailureRow[]> => {
      const { data, error } = await supabase.rpc(
        "admin_get_recent_integrity_gate_failures" as never,
        filterParams as never,
      );
      if (error) throw error;
      return (data as unknown as GateFailureRow[]) ?? [];
    },
    staleTime: 30_000,
  });

  const telemetryQ = useQuery({
    enabled: open,
    queryKey: ["heal-cockpit", "seo-toggle-telemetry", flagKey],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_seo_toggle_telemetry" as never,
        { p_flag_key: flagKey } as never,
      );
      if (error) throw error;
      return (data as Array<{
        flag_key: string;
        toggles_24h: number;
        toggles_7d: number;
        enable_count_7d: number;
        disable_count_7d: number;
        last_toggle_at: string | null;
        last_toggle_actor: string | null;
        last_toggle_direction: string | null;
        rollback_frequency_score: number | null;
      }>)?.[0] ?? null;
    },
    staleTime: 15_000,
  });

  const auditQ = useQuery({
    enabled: open,
    queryKey: ["heal-cockpit", "seo-flag-toggle-log", flagKey],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_seo_feature_flag_toggle_log" as never,
        { p_flag_key: flagKey, p_limit: 5 } as never,
      );
      if (error) throw error;
      return (data as Array<{
        log_id: string;
        flag_key: string;
        previous_enabled: boolean | null;
        new_enabled: boolean | null;
        reason: string | null;
        actor_uid: string | null;
        created_at: string;
      }>) ?? [];
    },
    staleTime: 15_000,
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
      qc.invalidateQueries({ queryKey: ["heal-cockpit", "seo-flag-toggle-log", flagKey] });
      qc.invalidateQueries({ queryKey: ["heal-cockpit", "seo-toggle-telemetry", flagKey] });
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
              {target ? (
                <CheckCircle2 className="h-4 w-4 text-success" />
              ) : (
                <PowerOff className="h-4 w-4 text-destructive" />
              )}
              SEO Feature-Flag {target ? "Aktivieren" : "Deaktivieren"}
            </DialogTitle>
            <DialogDescription>
              {target ? (
                <>
                  Aktiviert <code className="font-mono">{flagKey}</code> wieder.
                  Producer beginnt sofort mit dem Enqueuen neuer Jobs.
                </>
              ) : (
                <>
                  <strong className="text-warning">Achtung:</strong>{" "}
                  Deaktiviert <code className="font-mono">{flagKey}</code>.
                  Restjobs drainen normal, aber{" "}
                  <strong>keine neuen Jobs</strong> werden enqueued, bis du
                  reaktivierst.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {/* State diff */}
          <div
            className={`grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-md border p-3 ${
              target
                ? "border-success/30 bg-success-bg-subtle"
                : "border-warning/30 bg-warning-bg-subtle"
            }`}
          >
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

          {/* Audit-Log: last toggles */}
          <section className="space-y-1.5">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
              <History className="h-3.5 w-3.5" />
              Letzte Toggles für diesen Flag
            </h3>
            {auditQ.isLoading ? (
              <Skeleton className="h-12 w-full" />
            ) : auditQ.isError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive-bg-subtle px-3 py-2 text-xs text-destructive">
                Fehler: {(auditQ.error as Error).message}
              </div>
            ) : (auditQ.data ?? []).length === 0 ? (
              <div className="rounded-md border border-border-subtle bg-muted/30 px-3 py-2 text-xs text-text-secondary">
                Noch keine Toggles in <code className="font-mono">auto_heal_log</code>.
              </div>
            ) : (
              <ul className="space-y-1">
                {(auditQ.data ?? []).map((a) => (
                  <li
                    key={a.log_id}
                    className="rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-1.5 text-[11px]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-text-primary">
                        {String(a.previous_enabled)} → {String(a.new_enabled)}
                      </span>
                      <span className="text-text-secondary">
                        {new Date(a.created_at).toLocaleString("de-DE", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </span>
                    </div>
                    {a.reason && (
                      <div className="mt-0.5 truncate text-text-secondary" title={a.reason}>
                        <em>„{a.reason}"</em>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={toggleM.isPending}
            >
              Abbrechen
            </Button>
            <Button
              variant={target ? "default" : "destructive"}
              disabled={!reasonValid || toggleM.isPending}
              onClick={() => setConfirmOpen(true)}
              title={!reasonValid ? "Grund mit ≥ 5 Zeichen angeben" : undefined}
            >
              {target ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Aktivieren
                </>
              ) : (
                <>
                  <PowerOff className="h-3.5 w-3.5" />
                  Deaktivieren
                </>
              )}
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
              className={
                target
                  ? undefined
                  : "bg-destructive text-destructive-foreground hover:bg-destructive/90"
              }
              onClick={(e) => {
                e.preventDefault();
                toggleM.mutate();
              }}
            >
              {toggleM.isPending
                ? "Speichere…"
                : target
                  ? "Ja, aktivieren"
                  : "Ja, deaktivieren"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
