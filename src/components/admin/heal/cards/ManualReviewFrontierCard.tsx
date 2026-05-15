/**
 * ManualReviewFrontierCard — Fix C (Operator-Entscheid)
 * ──────────────────────────────────────────────────────
 * Listet chronische Pakete aus v_manual_review_frontier_candidates.
 * Aktionen: Frontier setzen (Reason Pflicht), Frontier entfernen, Paket öffnen.
 *
 * SSOT:
 *  - admin_get_manual_review_frontier_candidates()
 *  - admin_set_manual_review_frontier(p_package_id, p_reason, p_evidence)
 *  - admin_clear_manual_review_frontier(p_package_id, p_reason)
 *  - auto_heal_log (action_type IN manual_review_frontier_set|_cleared|_enqueue_blocked)
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, RefreshCw, Lock, Unlock, ExternalLink, History } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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

interface FrontierRow {
  package_id: string;
  status: string | null;
  package_key: string | null;
  park_skips_24h: number;
  tail_fails_24h: number;
  bronze_locked: boolean;
  severity: "critical" | "high" | "medium" | string;
}

interface AuditRow {
  id: string;
  created_at: string;
  action_type: string;
  target_id: string | null;
  result_status: string | null;
  metadata: Record<string, unknown> | null;
}

type ConfirmAction =
  | { kind: "set"; row: FrontierRow }
  | { kind: "clear"; row: FrontierRow }
  | null;

const SEVERITY_VARIANT: Record<string, "default" | "destructive" | "secondary" | "outline"> = {
  critical: "destructive",
  high: "default",
  medium: "secondary",
};

export function ManualReviewFrontierCard() {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<ConfirmAction>(null);
  const [reason, setReason] = useState("");
  const [showAudit, setShowAudit] = useState(false);

  const candidatesQ = useQuery({
    queryKey: ["manual-review-frontier-candidates"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_manual_review_frontier_candidates" as never,
      );
      if (error) throw error;
      return (data ?? []) as FrontierRow[];
    },
    refetchInterval: 60_000,
  });

  const auditQ = useQuery({
    queryKey: ["manual-review-frontier-audit"],
    enabled: showAudit,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("auto_heal_log")
        .select("id, created_at, action_type, target_id, result_status, metadata")
        .in("action_type", [
          "manual_review_frontier_set",
          "manual_review_frontier_cleared",
          "manual_review_frontier_enqueue_blocked",
        ])
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
    refetchInterval: 60_000,
  });

  const setMut = useMutation({
    mutationFn: async ({ row, reason }: { row: FrontierRow; reason: string }) => {
      const evidence = {
        park_skips_24h: row.park_skips_24h,
        tail_fails_24h: row.tail_fails_24h,
        severity: row.severity,
        bronze_locked: row.bronze_locked,
        captured_at: new Date().toISOString(),
        source: "admin_ui_manual_review_frontier_card",
      };
      const { data, error } = await supabase.rpc(
        "admin_set_manual_review_frontier" as never,
        {
          p_package_id: row.package_id,
          p_reason: reason,
          p_evidence: evidence,
        } as never,
      );
      if (error) throw error;
      return data as { ok: boolean; reason?: string };
    },
    onSuccess: (res) => {
      if ((res as { ok?: boolean })?.ok) {
        toast.success("Manual Frontier gesetzt", {
          description: "Paket terminal markiert. Tail-Enqueues werden geblockt.",
        });
      } else {
        toast.error(`Set abgelehnt: ${(res as { reason?: string })?.reason ?? "unknown"}`);
      }
      qc.invalidateQueries({ queryKey: ["manual-review-frontier-candidates"] });
      qc.invalidateQueries({ queryKey: ["manual-review-frontier-audit"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clearMut = useMutation({
    mutationFn: async ({ row, reason }: { row: FrontierRow; reason: string }) => {
      const { data, error } = await supabase.rpc(
        "admin_clear_manual_review_frontier" as never,
        { p_package_id: row.package_id, p_reason: reason } as never,
      );
      if (error) throw error;
      return data as { ok: boolean; reason?: string };
    },
    onSuccess: (res) => {
      if ((res as { ok?: boolean })?.ok) {
        toast.success("Frontier entfernt (manual_bypass=true)");
      } else {
        toast.error(`Clear abgelehnt: ${(res as { reason?: string })?.reason ?? "unknown"}`);
      }
      qc.invalidateQueries({ queryKey: ["manual-review-frontier-candidates"] });
      qc.invalidateQueries({ queryKey: ["manual-review-frontier-audit"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = candidatesQ.data ?? [];
  const counts = useMemo(
    () => ({
      total: rows.length,
      critical: rows.filter((r) => r.severity === "critical").length,
      high: rows.filter((r) => r.severity === "high").length,
      medium: rows.filter((r) => r.severity === "medium").length,
    }),
    [rows],
  );

  const reasonValid = reason.trim().length >= 10;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShieldAlert className="h-5 w-5 text-destructive" />
                Manual Review Frontier (Fix C)
                <Badge variant="outline" className="ml-1">
                  {counts.total}
                </Badge>
              </CardTitle>
              <CardDescription>
                Chronisch failende Pakete (≥5 Park-Skips ODER ≥5 Tail-Fails / 24h). Operator-Entscheid:
                Frontier blockiert <code>integrity / council / auto_publish</code> auf job_queue. Kein Auto-Mark.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAudit((v) => !v)}
              >
                <History className="h-4 w-4 mr-1.5" />
                Audit
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => candidatesQ.refetch()}
                disabled={candidatesQ.isRefetching}
              >
                <RefreshCw
                  className={`h-4 w-4 mr-1.5 ${candidatesQ.isRefetching ? "animate-spin" : ""}`}
                />
                Aktualisieren
              </Button>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap pt-2 text-xs">
            <Badge variant="destructive">Critical: {counts.critical}</Badge>
            <Badge variant="default">High: {counts.high}</Badge>
            <Badge variant="secondary">Medium: {counts.medium}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {candidatesQ.isLoading ? (
            <p className="text-sm text-text-secondary">Lade…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-text-secondary">Keine Frontier-Kandidaten.</p>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Paket</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead className="text-right">Tail-Fails / 24h</TableHead>
                    <TableHead className="text-right">Park-Skips / 24h</TableHead>
                    <TableHead>Bronze</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.package_id}>
                      <TableCell className="max-w-[260px]">
                        <div className="font-medium truncate">
                          {r.package_key ?? r.package_id.slice(0, 8)}
                        </div>
                        <div className="text-xs text-text-secondary font-mono truncate">
                          {r.package_id}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={SEVERITY_VARIANT[r.severity] ?? "outline"} className="capitalize">
                          {r.severity}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {r.tail_fails_24h}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {r.park_skips_24h}
                      </TableCell>
                      <TableCell>
                        {r.bronze_locked ? (
                          <Badge variant="secondary" className="text-xs">
                            locked
                          </Badge>
                        ) : (
                          <span className="text-xs text-text-tertiary">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{r.status ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1.5 flex-wrap">
                          <Button asChild size="sm" variant="ghost" title="Paket öffnen">
                            <Link to={`/admin/studio/${r.package_id}`}>
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setReason("");
                              setConfirm({ kind: "clear", row: r });
                            }}
                            title="manual_bypass=true setzen"
                          >
                            <Unlock className="h-3.5 w-3.5 mr-1" />
                            Clear
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              setReason("");
                              setConfirm({ kind: "set", row: r });
                            }}
                            title="Manual Frontier setzen"
                          >
                            <Lock className="h-3.5 w-3.5 mr-1" />
                            Frontier setzen
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {showAudit && (
            <div className="mt-6 border-t pt-4">
              <div className="text-sm font-medium mb-2 flex items-center gap-2">
                <History className="h-4 w-4" />
                Audit-Log (letzte 30, action_type=manual_review_frontier_*)
              </div>
              {auditQ.isLoading ? (
                <p className="text-xs text-text-secondary">Lade…</p>
              ) : (auditQ.data?.length ?? 0) === 0 ? (
                <p className="text-xs text-text-secondary">Keine Einträge.</p>
              ) : (
                <div className="overflow-auto max-h-80">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[160px]">Zeit</TableHead>
                        <TableHead>Aktion</TableHead>
                        <TableHead>Target</TableHead>
                        <TableHead>Result</TableHead>
                        <TableHead>Reason / Meta</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(auditQ.data ?? []).map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="text-xs whitespace-nowrap">
                            {new Date(a.created_at).toLocaleString("de-DE")}
                          </TableCell>
                          <TableCell className="text-xs font-mono">{a.action_type}</TableCell>
                          <TableCell className="text-xs font-mono truncate max-w-[160px]">
                            {a.target_id?.slice(0, 8) ?? "—"}
                          </TableCell>
                          <TableCell className="text-xs">{a.result_status ?? "—"}</TableCell>
                          <TableCell className="text-xs text-text-secondary truncate max-w-[300px]">
                            {(a.metadata as { reason?: string } | null)?.reason ??
                              JSON.stringify(a.metadata ?? {}).slice(0, 120)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {confirm?.kind === "set" ? (
                <>
                  <Lock className="h-5 w-5 text-destructive" />
                  Manual Frontier setzen?
                </>
              ) : (
                <>
                  <Unlock className="h-5 w-5 text-emerald-600" />
                  Frontier entfernen?
                </>
              )}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                {confirm?.kind === "set" ? (
                  <p>
                    Paket{" "}
                    <strong className="font-mono">
                      {confirm.row.package_key ?? confirm.row.package_id.slice(0, 8)}
                    </strong>{" "}
                    wird terminal als <code>manual_review_frontier</code> markiert. Alle{" "}
                    <code>integrity / council / auto_publish</code> Enqueues werden geblockt + auditiert.
                  </p>
                ) : (
                  <p>
                    Paket{" "}
                    <strong className="font-mono">
                      {confirm?.row.package_key ?? confirm?.row.package_id.slice(0, 8)}
                    </strong>{" "}
                    wird auf <code>manual_bypass=true</code> gesetzt. Frontier-Guard greift nicht mehr.
                  </p>
                )}
                {confirm?.kind === "set" && (
                  <div className="rounded-md border border-border-subtle bg-surface-sunken p-2 text-xs">
                    <div className="font-medium mb-1">Evidence (auto-captured)</div>
                    <ul className="space-y-0.5 font-mono text-text-secondary">
                      <li>severity: {confirm.row.severity}</li>
                      <li>tail_fails_24h: {confirm.row.tail_fails_24h}</li>
                      <li>park_skips_24h: {confirm.row.park_skips_24h}</li>
                      <li>bronze_locked: {String(confirm.row.bronze_locked)}</li>
                    </ul>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="frontier-reason">
                    Reason (Pflicht, min. 10 Zeichen)
                  </Label>
                  <Textarea
                    id="frontier-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={
                      confirm?.kind === "set"
                        ? "z.B. Chronische integrity-Fails seit 72h, Tail-Heal blockiert, Operator-Decision zur Quarantäne"
                        : "z.B. Manuelle Korrektur abgeschlossen, Bypass freigeschaltet"
                    }
                    rows={3}
                  />
                  {!reasonValid && reason.length > 0 && (
                    <p className="text-xs text-destructive">
                      Mindestens 10 Zeichen erforderlich ({reason.trim().length}/10).
                    </p>
                  )}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={!reasonValid || setMut.isPending || clearMut.isPending}
              onClick={() => {
                if (!confirm || !reasonValid) return;
                const trimmed = reason.trim();
                if (confirm.kind === "set") setMut.mutate({ row: confirm.row, reason: trimmed });
                if (confirm.kind === "clear") clearMut.mutate({ row: confirm.row, reason: trimmed });
                setConfirm(null);
                setReason("");
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
