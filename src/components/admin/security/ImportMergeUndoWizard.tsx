/**
 * ImportMergeUndoWizard
 * ─────────────────────
 * Wiederholbare Test-Szenarien für den Findings-Import:
 *   1. Import → Precheck → Merge → Undo
 *   2. Import → Replace → Undo (optional precheck-bypassed)
 *   3. Import → Discard ✕
 *
 * Pro Run sichtbar: fileName, Pre-Merge-Status (grün/rot/—), Diff (+~=⊘),
 * Mode (merge/replace/-), Discard-Marker und Endzeit.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, Circle, History, RotateCcw, ShieldAlert, ShieldCheck, ShieldX, Trash2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  buildScenarios,
  clearImportLog,
  getImportLog,
  type ScenarioRow,
} from "@/lib/admin/security/findingsImportLog";

export function ImportMergeUndoWizard({ refreshTick }: { refreshTick?: number }) {
  const [rows, setRows] = useState<ScenarioRow[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setRows(buildScenarios(getImportLog()));
  }, [tick, refreshTick]);

  function refresh() {
    setTick((t) => t + 1);
  }

  function reset() {
    clearImportLog();
    refresh();
  }

  const tested = {
    mergeUndo: rows.filter((r) => r.applied && r.mode === "merge" && r.undone).length,
    replaceUndo: rows.filter((r) => r.applied && r.mode === "replace" && r.undone).length,
    discarded: rows.filter((r) => !r.applied && r.discarded).length,
    bypassed: rows.filter((r) => r.precheckBypassed).length,
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <History className="h-4 w-4" />
          Import → Merge → Undo Wizard
          <Badge variant="outline" className="ml-2 text-[10px]">
            {rows.length} runs
          </Badge>
          <div className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={refresh}>
              <RotateCcw className="mr-1 h-3 w-3" /> Aktualisieren
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={reset}>
              <Trash2 className="mr-1 h-3 w-3" /> Log leeren
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-4 gap-2 text-center text-xs">
          <ScenarioBadge label="Merge → Undo" count={tested.mergeUndo} />
          <ScenarioBadge label="Replace → Undo" count={tested.replaceUndo} />
          <ScenarioBadge label="Discard ✕" count={tested.discarded} />
          <ScenarioBadge label="Precheck-Bypass" count={tested.bypassed} tone={tested.bypassed > 0 ? "warn" : "default"} />
        </div>

        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Noch keine Test-Runs. Lade eine JSON-Datei hoch, nutze Pre-Check → Merge/Replace → Undo
            oder schließe den Dialog ohne Apply (Discard), um Szenarien zu protokollieren.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {rows.slice(0, 12).map((r) => (
              <li
                key={r.id}
                className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${
                  r.precheckBypassed
                    ? "border-destructive/40 bg-destructive-bg-subtle"
                    : r.discarded && !r.applied
                    ? "border-amber-500/30 bg-amber-500/5"
                    : "border-border bg-muted/10"
                }`}
              >
                <span className="font-mono text-[10px] text-muted-foreground">
                  {new Date(r.startedAt).toLocaleTimeString()}
                </span>
                <span className="font-medium" title={r.fileName ?? ""}>
                  {r.fileName ?? "(textarea)"}
                </span>
                <PrecheckBadge ok={r.precheckOk} bypassed={r.precheckBypassed} />
                <Step ok label="import" />
                <Step
                  ok={r.applied}
                  label={r.mode === "replace" ? "replace" : r.mode === "merge" ? "merge" : "—"}
                />
                <Step ok={r.undone} label="undo" />
                {r.discarded && !r.applied && (
                  <Badge variant="outline" className="h-4 border-amber-500/40 px-1 text-[10px] text-amber-700 dark:text-amber-400">
                    <XCircle className="mr-0.5 h-3 w-3" /> discard ✕ {r.endedAt ? new Date(r.endedAt).toLocaleTimeString() : ""}
                  </Badge>
                )}
                {r.diff ? (
                  <Badge variant="outline" className="ml-auto h-4 px-1 font-mono text-[10px]">
                    +{r.diff.added} ~{r.diff.changed} ={r.diff.unchanged} ⊘{r.diff.ignored}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="ml-auto h-4 px-1 text-[10px] text-muted-foreground">
                    no diff
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function PrecheckBadge({ ok, bypassed }: { ok?: boolean; bypassed: boolean }) {
  if (bypassed) {
    return (
      <Badge variant="outline" className="h-4 border-destructive/40 px-1 text-[10px] text-destructive">
        <ShieldX className="mr-0.5 h-3 w-3" /> precheck bypassed
      </Badge>
    );
  }
  if (ok === true) {
    return (
      <Badge variant="outline" className="h-4 border-emerald-500/40 px-1 text-[10px] text-emerald-700 dark:text-emerald-400">
        <ShieldCheck className="mr-0.5 h-3 w-3" /> precheck ok
      </Badge>
    );
  }
  if (ok === false) {
    return (
      <Badge variant="outline" className="h-4 border-destructive/40 px-1 text-[10px] text-destructive">
        <ShieldX className="mr-0.5 h-3 w-3" /> precheck fail
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="h-4 px-1 text-[10px] text-muted-foreground">
      <ShieldAlert className="mr-0.5 h-3 w-3" /> precheck —
    </Badge>
  );
}

function Step({ ok, fail, label }: { ok?: boolean; fail?: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] ${
        ok
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
          : fail
          ? "bg-destructive-bg-subtle text-destructive"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : fail ? <XCircle className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
      {label}
    </span>
  );
}

function ScenarioBadge({ label, count, tone = "default" }: { label: string; count: number; tone?: "default" | "warn" }) {
  const cls =
    tone === "warn" && count > 0
      ? "bg-destructive-bg-subtle text-destructive"
      : count > 0
      ? "bg-emerald-500/10"
      : "bg-muted/30";
  return (
    <div className={`rounded-md p-2 ${cls}`}>
      <div className="text-base font-semibold tabular-nums">{count}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
