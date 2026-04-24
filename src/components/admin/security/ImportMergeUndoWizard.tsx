/**
 * ImportMergeUndoWizard
 * ─────────────────────
 * Wiederholbare Test-Szenarien für den Findings-Import:
 *   1. Import → Merge → Undo
 *   2. Import → Replace → Undo
 *   3. Import → Discard (✕)
 *
 * Liest das Append-Log aus sessionStorage und zeigt jede Run-Reihe als Status-Row
 * mit Schritt-Indikatoren (precheck/apply/undo). Reset löscht das Log.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, Circle, History, RotateCcw, Trash2, XCircle } from "lucide-react";
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
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <ScenarioBadge label="Merge → Undo" count={tested.mergeUndo} />
          <ScenarioBadge label="Replace → Undo" count={tested.replaceUndo} />
          <ScenarioBadge label="Discard ✕" count={tested.discarded} />
        </div>

        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Noch keine Test-Runs. Lade eine JSON-Datei hoch und nutze Pre-Check → Merge/Replace → Undo,
            um Szenarien zu protokollieren.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {rows.slice(0, 12).map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/10 px-2 py-1.5 text-xs"
              >
                <span className="font-mono text-[10px] text-muted-foreground">
                  {new Date(r.startedAt).toLocaleTimeString()}
                </span>
                <span className="font-medium">{r.fileName ?? "(textarea)"}</span>
                <Step ok label="import" />
                <Step
                  ok={r.precheckOk === true}
                  fail={r.precheckOk === false}
                  label="precheck"
                />
                <Step
                  ok={r.applied}
                  label={r.mode === "replace" ? "replace" : "merge"}
                />
                <Step ok={r.undone} label="undo" />
                {r.discarded && <Step ok label="✕ discard" />}
                {r.diff && (
                  <Badge variant="outline" className="ml-auto h-4 px-1 text-[10px]">
                    +{r.diff.added} ~{r.diff.changed} ={r.diff.unchanged} ⊘{r.diff.ignored}
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

function Step({ ok, fail, label }: { ok?: boolean; fail?: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] ${
        ok
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
          : fail
          ? "bg-destructive/15 text-destructive"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : fail ? <XCircle className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
      {label}
    </span>
  );
}

function ScenarioBadge({ label, count }: { label: string; count: number }) {
  return (
    <div className={`rounded-md p-2 ${count > 0 ? "bg-emerald-500/10" : "bg-muted/30"}`}>
      <div className="text-base font-semibold tabular-nums">{count}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
