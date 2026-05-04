/**
 * BronzeReviewCard — Phase 3 UI für Bronze (Council 75-84) Review-Workflow
 * ────────────────────────────────────────────────────────────────────────
 * Listet alle Pakete mit feature_flags.bronze.requires_review=true.
 * Aktionen: Targeted Repair (max 1× pro Paket) und Manual Approve & Publish.
 *
 * SSOT:
 *  - admin_get_bronze_review_packages()
 *  - admin_bronze_targeted_repair_dispatch(p_package_id)
 *  - admin_bronze_manual_approve_for_publish(p_package_id, p_reason)
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, CheckCircle2, RefreshCw, Wrench, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

interface BronzeReviewRow {
  package_id: string;
  package_key: string | null;
  title: string | null;
  course_title: string | null;
  status: string | null;
  score: number | null;
  badge: string | null;
  verdict: string | null;
  failed_rules: unknown;
  repair_attempts: number;
  repair_active: boolean;
  final_state: string | null;
  requires_review: boolean;
  bronze_started_at: string | null;
  manual_approved_at: string | null;
  last_council_at: string | null;
  integrity_passed: boolean;
  pricing_ready: boolean;
  has_active_publish_job: boolean;
}

type ConfirmAction =
  | { kind: "repair"; row: BronzeReviewRow }
  | { kind: "approve"; row: BronzeReviewRow }
  | null;

function formatRules(rules: unknown): string {
  if (!rules) return "—";
  if (Array.isArray(rules)) {
    if (rules.length === 0) return "—";
    return rules
      .map((r) => (typeof r === "string" ? r : (r as { rule?: string; code?: string })?.rule ?? (r as { code?: string })?.code ?? JSON.stringify(r)))
      .slice(0, 3)
      .join(", ") + (rules.length > 3 ? ` (+${rules.length - 3})` : "");
  }
  return JSON.stringify(rules).slice(0, 60);
}

export function BronzeReviewCard() {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<ConfirmAction>(null);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["bronze-review-packages"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_bronze_review_packages" as never);
      if (error) throw error;
      return (data ?? []) as BronzeReviewRow[];
    },
    refetchInterval: 60_000,
  });

  const repairMut = useMutation({
    mutationFn: async (packageId: string) => {
      const { data, error } = await supabase.rpc(
        "admin_bronze_targeted_repair_dispatch" as never,
        { p_package_id: packageId } as never,
      );
      if (error) throw error;
      return data as { ok: boolean; reason?: string; vector?: string };
    },
    onSuccess: (res, packageId) => {
      if (res?.ok) {
        toast.success(`Targeted Repair gestartet`, {
          description: `Vector: ${res.vector ?? "auto"}`,
        });
      } else {
        toast.warning(`Repair abgelehnt: ${res?.reason ?? "unknown"}`);
      }
      qc.invalidateQueries({ queryKey: ["bronze-review-packages"] });
      qc.invalidateQueries({ queryKey: ["heal-cockpit"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveMut = useMutation({
    mutationFn: async (packageId: string) => {
      const { data, error } = await supabase.rpc(
        "admin_bronze_manual_approve_for_publish" as never,
        { p_package_id: packageId, p_reason: "admin_manual_review" } as never,
      );
      if (error) throw error;
      return data as { ok: boolean; reason?: string; job_id?: string };
    },
    onSuccess: (res) => {
      if (res?.ok) {
        toast.success("Bronze manuell freigegeben", {
          description: `Auto-Publish enqueued (${res.job_id?.slice(0, 8)}…)`,
        });
      } else {
        toast.error(`Freigabe blockiert: ${res?.reason ?? "unknown"}`);
      }
      qc.invalidateQueries({ queryKey: ["bronze-review-packages"] });
      qc.invalidateQueries({ queryKey: ["heal-cockpit"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = data ?? [];
  const counts = useMemo(() => {
    return {
      total: rows.length,
      repairActive: rows.filter((r) => r.repair_active).length,
      manualApproved: rows.filter((r) => r.final_state === "manual_approved").length,
      readyToApprove: rows.filter(
        (r) =>
          (r.score ?? 0) >= 75 &&
          (r.score ?? 0) < 85 &&
          r.integrity_passed &&
          r.pricing_ready &&
          !r.has_active_publish_job &&
          r.final_state !== "manual_approved",
      ).length,
    };
  }, [rows]);

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Award className="h-5 w-5 text-amber-600" />
                Bronze Review (Council 75–84)
                <Badge variant="outline" className="ml-1">
                  {counts.total}
                </Badge>
              </CardTitle>
              <CardDescription>
                Pakete mit Bronze-Outcome — kein Auto-Loop, kein Auto-Publish. Targeted Repair max 1× pro Paket, dann manuelle Entscheidung.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isRefetching}
            >
              <RefreshCw className={`h-4 w-4 mr-1.5 ${isRefetching ? "animate-spin" : ""}`} />
              Aktualisieren
            </Button>
          </div>
          <div className="flex gap-2 flex-wrap pt-2 text-xs">
            <Badge variant="secondary">In Review: {counts.total}</Badge>
            <Badge variant="secondary">Repair aktiv: {counts.repairActive}</Badge>
            <Badge variant="secondary">Bereit für Approve: {counts.readyToApprove}</Badge>
            <Badge variant="secondary">Manuell freigegeben: {counts.manualApproved}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-text-secondary">Lade…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-text-secondary">Keine Bronze-Review-Pakete.</p>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Paket</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead>Badge</TableHead>
                    <TableHead>Failed Rules</TableHead>
                    <TableHead className="text-right">Repairs</TableHead>
                    <TableHead>Final State</TableHead>
                    <TableHead>Gates</TableHead>
                    <TableHead className="text-right">Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const repairExhausted = r.repair_attempts >= 1 || r.repair_active;
                    const approveBlocked =
                      !r.integrity_passed ||
                      !r.pricing_ready ||
                      r.has_active_publish_job ||
                      (r.score ?? 0) < 75 ||
                      (r.score ?? 0) >= 85 ||
                      r.final_state === "manual_approved";

                    return (
                      <TableRow key={r.package_id}>
                        <TableCell className="max-w-[260px]">
                          <div className="font-medium truncate">{r.title ?? r.package_key ?? r.package_id.slice(0, 8)}</div>
                          <div className="text-xs text-text-secondary truncate">
                            {r.course_title ?? "—"} · {r.status ?? "?"}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {r.score?.toFixed(1) ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {r.badge ?? "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[200px] text-xs text-text-secondary truncate">
                          {formatRules(r.failed_rules)}
                        </TableCell>
                        <TableCell className="text-right">
                          {r.repair_attempts}
                          {r.repair_active && (
                            <Badge variant="secondary" className="ml-1 text-xs">
                              aktiv
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={r.final_state === "manual_approved" ? "default" : "outline"}
                            className="text-xs"
                          >
                            {r.final_state ?? "—"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5 text-xs">
                            <span className={r.integrity_passed ? "text-emerald-700" : "text-rose-700"}>
                              {r.integrity_passed ? "✓" : "✗"} integrity
                            </span>
                            <span className={r.pricing_ready ? "text-emerald-700" : "text-rose-700"}>
                              {r.pricing_ready ? "✓" : "✗"} pricing
                            </span>
                            {r.has_active_publish_job && (
                              <span className="text-amber-700">⏳ publish-job</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1.5 flex-wrap">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={repairExhausted || repairMut.isPending}
                              onClick={() => setConfirm({ kind: "repair", row: r })}
                              title={
                                repairExhausted
                                  ? "Targeted Repair bereits ausgeführt"
                                  : "Einmalige gezielte Reparatur starten"
                              }
                            >
                              <Wrench className="h-3.5 w-3.5 mr-1" />
                              Repair
                            </Button>
                            <Button
                              size="sm"
                              disabled={approveBlocked || approveMut.isPending}
                              onClick={() => setConfirm({ kind: "approve", row: r })}
                              title={
                                approveBlocked
                                  ? "Gates nicht erfüllt (siehe Spalte)"
                                  : "Manuell freigeben & Auto-Publish enqueuen"
                              }
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                              Approve & Publish
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

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {confirm?.kind === "approve" ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  Bronze manuell freigeben?
                </>
              ) : (
                <>
                  <AlertCircle className="h-5 w-5 text-amber-600" />
                  Targeted Repair starten?
                </>
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "approve" ? (
                <>
                  Paket <strong>{confirm.row.title ?? confirm.row.package_id.slice(0, 8)}</strong> wird
                  als <code>manual_approved</code> markiert und ein <code>package_auto_publish</code>{" "}
                  Job mit <code>bronze_lock_override=true</code> enqueued. Score:{" "}
                  <strong>{confirm.row.score?.toFixed(1)}</strong>.
                </>
              ) : confirm?.kind === "repair" ? (
                <>
                  Einmalige gezielte Reparatur für{" "}
                  <strong>{confirm.row.title ?? confirm.row.package_id.slice(0, 8)}</strong>. Bei
                  fehlendem Score-Anstieg wird das Paket terminal in <code>requires_review</code>{" "}
                  belassen — kein zweiter Versuch.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirm) return;
                if (confirm.kind === "approve") approveMut.mutate(confirm.row.package_id);
                if (confirm.kind === "repair") repairMut.mutate(confirm.row.package_id);
                setConfirm(null);
              }}
            >
              Bestätigen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
