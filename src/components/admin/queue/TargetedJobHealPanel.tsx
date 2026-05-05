/**
 * TargetedJobHealPanel
 * ────────────────────
 * Listet die zuletzt betroffenen package_run_integrity_check Jobs für ein Paket
 * und erlaubt einen gezielten, Backend-validierten Batch-Heal.
 *
 * v1.2:
 *  - "What will change" Diff-Preview vor Trigger (blockt empty diff)
 *  - Backend-Validation (admin_heal_jobs_targeted) → strukturierte failure_codes
 *  - Audit-Export CSV/JSON für letzte Heal/Requeue-Aktionen
 *  - i18n (de/en)
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2, Eye, FileDown, Loader2, RefreshCcw, Wrench, XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  computeHealDiff,
  downloadBlob,
  exportAuditAsCsv,
  healJobsTargetedBackend,
  listRecentIntegrityJobs,
  type AuditExportRow,
  type JobHealDiff,
  type TargetedHealResult,
} from "@/lib/admin/queue/zombieHealApi";
import { useLocale } from "@/lib/admin/queue/i18n";

interface Props {
  packageId: string;
}

export function TargetedJobHealPanel({ packageId }: Props) {
  const { t } = useLocale();
  const recent = useQuery({
    queryKey: ["targeted-heal-recent", packageId],
    queryFn: () => listRecentIntegrityJobs(packageId, 5),
    enabled: !!packageId,
    staleTime: 10_000,
  });

  const rows = recent.data ?? [];
  const healable = useMemo(
    () => rows.filter((r) => r.status === "processing" || r.status === "running"),
    [rows],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<TargetedHealResult[]>([]);
  const [running, setRunning] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [auditLog, setAuditLog] = useState<AuditExportRow[]>([]);

  const toggle = (id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const selectAllHealable = () => setSelected(new Set(healable.map((r) => r.id)));
  const clearSelection = () => setSelected(new Set());

  // Diff Preview ─────────────────────────────────────────────────────────────
  const diffs: JobHealDiff[] = useMemo(() => {
    return Array.from(selected)
      .map((id) => {
        const job = rows.find((r) => r.id === id);
        if (!job) return null;
        return computeHealDiff(job);
      })
      .filter((d): d is JobHealDiff => d !== null);
  }, [selected, rows]);

  const effectiveDiffs = diffs.filter((d) => d.has_effective_change);
  const blockedDiffs = diffs.filter((d) => !d.has_effective_change);
  const canRun = effectiveDiffs.length > 0 && !running;

  const runHeal = async () => {
    if (!canRun) {
      toast.warning(t("targeted.previewBlocked"));
      return;
    }
    setRunning(true);
    setResults([]);
    try {
      const ids = effectiveDiffs.map((d) => d.job_id);
      const res = await healJobsTargetedBackend(ids, "runbook_targeted_batch");
      setResults(res.results);

      // Append to audit log
      const ts = new Date().toISOString();
      const rowsForLog: AuditExportRow[] = res.results.map((r) => {
        const diff = effectiveDiffs.find((d) => d.job_id === r.job_id);
        return {
          ts,
          job_id: r.job_id,
          action: "targeted_heal",
          ok: r.ok,
          prev_job_status: diff?.current_status,
          new_job_status: r.ok ? "cancelled" : diff?.current_status,
          prev_step_state: diff?.step_will_reset ? "processing" : undefined,
          new_step_state: r.ok && diff?.step_will_reset ? "queued" : undefined,
          reason: "runbook_targeted_batch",
          failure_code: r.failure_code,
        };
      });
      setAuditLog((log) => [...log, ...rowsForLog]);

      if (res.fail_count === 0) {
        toast.success(`${res.ok_count} ✓`);
      } else if (res.ok_count === 0) {
        toast.error(`${res.fail_count} fail`);
      } else {
        toast.warning(`${res.ok_count} ok · ${res.fail_count} fail`);
      }
      void recent.refetch();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const exportAudit = (format: "csv" | "json") => {
    if (auditLog.length === 0) {
      toast.info("Audit-Log noch leer.");
      return;
    }
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    if (format === "csv") {
      downloadBlob(`heal-audit-${ts}.csv`, exportAuditAsCsv(auditLog), "text/csv");
    } else {
      downloadBlob(`heal-audit-${ts}.json`, JSON.stringify(auditLog, null, 2), "application/json");
    }
  };

  const resultFor = (id: string) => results.find((r) => r.job_id === id);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <Wrench className="h-4 w-4 text-primary" />
          {t("targeted.title")}
          <Badge variant="outline" className="text-[10px]">{rows.length}</Badge>
          {healable.length > 0 && (
            <Badge variant="destructive" className="text-[10px]">
              {healable.length} {t("targeted.healable")}
            </Badge>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-6 px-2 text-[11px]"
            onClick={() => void recent.refetch()}
          >
            <RefreshCcw className="mr-1 h-3 w-3" /> Reload
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            onClick={() => exportAudit("csv")}
            disabled={auditLog.length === 0}
            title="Export CSV"
          >
            <FileDown className="mr-1 h-3 w-3" /> CSV
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            onClick={() => exportAudit("json")}
            disabled={auditLog.length === 0}
            title="Export JSON"
          >
            <FileDown className="mr-1 h-3 w-3" /> JSON
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {recent.isLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Lade…
          </div>
        )}
        {!recent.isLoading && rows.length === 0 && (
          <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
            {t("targeted.empty")}
          </p>
        )}

        {rows.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2 text-[11px]">
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2"
                onClick={selectAllHealable}
                disabled={healable.length === 0 || running}
              >
                {t("targeted.selectAll")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2"
                onClick={clearSelection}
                disabled={selected.size === 0 || running}
              >
                {t("targeted.clear")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2"
                onClick={() => setPreviewOpen((v) => !v)}
                disabled={selected.size === 0}
              >
                <Eye className="mr-1 h-3 w-3" /> {t("targeted.preview")} ({diffs.length})
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="ml-auto h-6 px-2"
                onClick={runHeal}
                disabled={!canRun}
                title={canRun ? "" : t("targeted.previewBlocked")}
              >
                {running ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Wrench className="mr-1 h-3 w-3" />
                )}
                {t("targeted.run")} {effectiveDiffs.length > 0 ? `(${effectiveDiffs.length})` : ""}
              </Button>
            </div>

            {previewOpen && diffs.length > 0 && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-2">
                <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-primary">
                  <Eye className="h-3 w-3" /> {t("runbook.diffPreview")}
                </div>
                <table className="w-full text-[10px]">
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-1 py-1 text-left">job_id</th>
                      <th className="px-1 py-1 text-left">{t("diff.colCurrent")}</th>
                      <th className="px-1 py-1 text-left">{t("diff.colNext")}</th>
                      <th className="px-1 py-1 text-left">step</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diffs.map((d) => (
                      <tr
                        key={d.job_id}
                        className={d.has_effective_change ? "" : "opacity-50"}
                      >
                        <td className="px-1 py-1 font-mono">{d.job_id.slice(0, 8)}…</td>
                        <td className="px-1 py-1">{d.current_status}</td>
                        <td className="px-1 py-1">
                          {d.has_effective_change ? (
                            <span className="text-emerald-700">{d.next_status}</span>
                          ) : (
                            <span className="italic">{t("diff.noChange")} ({d.reason})</span>
                          )}
                        </td>
                        <td className="px-1 py-1">
                          {d.step_will_reset ? "✓ reset" : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {effectiveDiffs.length === 0 && (
                  <p className="mt-2 text-[11px] text-destructive">{t("runbook.diffEmpty")}</p>
                )}
                {blockedDiffs.length > 0 && effectiveDiffs.length > 0 && (
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    {blockedDiffs.length} ohne Effekt — werden übersprungen.
                  </p>
                )}
              </div>
            )}

            <ul className="space-y-1">
              {rows.map((j) => {
                const isHealable = j.status === "processing" || j.status === "running";
                const r = resultFor(j.id);
                return (
                  <li
                    key={j.id}
                    className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${
                      r?.ok
                        ? "border-emerald-500/40 bg-emerald-500/5"
                        : r && !r.ok
                        ? "border-destructive/50 bg-destructive-bg-subtle"
                        : isHealable
                        ? "border-amber-500/40 bg-amber-500/5"
                        : "border-border bg-card"
                    }`}
                  >
                    <Checkbox
                      checked={selected.has(j.id)}
                      onCheckedChange={() => toggle(j.id)}
                      disabled={!isHealable || running}
                      aria-label={`Job ${j.id} auswählen`}
                    />
                    <span className="font-mono text-[11px] text-primary">{j.id.slice(0, 8)}…</span>
                    <Badge variant="outline" className="text-[10px] uppercase">{j.status}</Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {t("targeted.attempts")}: {j.attempts}
                    </span>
                    {j.locked_by && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {j.locked_by.slice(0, 16)}
                      </span>
                    )}
                    {j.last_error && (
                      <span
                        className="max-w-[260px] truncate text-[10px] text-muted-foreground"
                        title={j.last_error}
                      >
                        {j.last_error}
                      </span>
                    )}
                    <div className="ml-auto">
                      {r?.ok && (
                        <Badge className="bg-emerald-500/20 text-emerald-700 text-[10px]">
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          ok{r.step_reset ? " · step reset" : ""}
                        </Badge>
                      )}
                      {r && !r.ok && (
                        <Badge variant="destructive" className="text-[10px]" title={r.failure_code}>
                          <XCircle className="mr-1 h-3 w-3" />
                          {r.failure_code ?? r.error?.slice(0, 32) ?? "fail"}
                        </Badge>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
