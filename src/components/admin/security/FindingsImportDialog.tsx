/**
 * FindingsImportDialog
 * ────────────────────
 * Drag-and-drop Upload-Zone + Schema-Validation + Field-level Validator +
 * Diff-Vorschau (added/changed/unchanged/ignored) gegen die aktuell geladenen
 * Findings. Operator entscheidet "merge" oder "replace".
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { CloudUpload, FileText, Plus, Pencil, ShieldCheck, X, ShieldX, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { parseFindingsJson, type RawFindingInput } from "@/lib/admin/security/findingSchema";
import { validateAllFindings, type FindingValidationResult } from "@/lib/admin/security/findingValidator";
import { mergeFindings, type MergeDiff } from "@/lib/admin/security/findingsMerge";
import { runPreMergeCheck, type PreMergeResult } from "@/lib/admin/security/preMergeCheck";
import { appendImportLog } from "@/lib/admin/security/findingsImportLog";
import type { RawFinding } from "@/lib/admin/security/findingClassifier";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing: RawFinding[];
  onApply: (merged: RawFinding[], mode: "merge" | "replace", meta: { fileName: string | null; addedCount: number; changedCount: number }) => void;
}

export function FindingsImportDialog({ open, onOpenChange, existing, onApply }: Props) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rawText, setRawText] = useState<string>("");
  const [parsed, setParsed] = useState<RawFindingInput[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [validation, setValidation] = useState<{
    results: FindingValidationResult[];
    errorCount: number;
    warnCount: number;
    cleanCount: number;
  } | null>(null);
  const [precheck, setPrecheck] = useState<PreMergeResult | null>(null);

  const diff: MergeDiff | null = useMemo(() => {
    if (parsed.length === 0) return null;
    return mergeFindings(existing, parsed as RawFinding[]);
  }, [existing, parsed]);

  function reset() {
    setFileName(null);
    setRawText("");
    setParsed([]);
    setErrors([]);
    setValidation(null);
    setPrecheck(null);
  }

  async function handleFile(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Datei zu groß (>5MB)", variant: "destructive" });
      return;
    }
    setFileName(file.name);
    try {
      const text = await file.text();
      setRawText(text);
      const result = parseFindingsJson(text);
      appendImportLog({
        step: "import",
        fileName: file.name,
        note: result.ok ? `parsed ${result.findings.length}` : `schema_errors=${result.errors.length}`,
      });
      if (!result.ok) {
        setErrors(result.errors);
        setParsed([]);
        setValidation(null);
        setPrecheck(null);
        return;
      }
      setErrors([]);
      setParsed(result.findings);
      setValidation(validateAllFindings(result.findings));
      setPrecheck(null); // user must explicitly run precheck
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)]);
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void handleFile(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function runPrecheck() {
    if (!rawText) return;
    const r = runPreMergeCheck(rawText);
    setPrecheck(r);
    appendImportLog({ step: "precheck", precheckOk: r.ok, fileName, note: `issues=${r.issues.length}` });
    if (!r.ok) {
      toast({
        title: "Pre-Merge-Check FAIL",
        description: `${r.stats.schemaErrors} schema · ${r.stats.validatorErrors} validator · ${r.stats.lintPatternHits} lint`,
        variant: "destructive",
      });
    } else {
      toast({ title: "Pre-Merge-Check OK", description: `${r.stats.parsed} findings · ${r.durationMs}ms` });
    }
  }

  function apply(mode: "merge" | "replace") {
    if (!diff) return;
    // Hard gate: bei Merge muss precheck explizit OK sein
    if (mode === "merge" && (!precheck || !precheck.ok)) {
      toast({
        title: "Merge blockiert",
        description: "Pre-Merge-Check (build/lint) muss zuerst grün sein.",
        variant: "destructive",
      });
      return;
    }
    const out = mode === "merge" ? diff.merged : (parsed as RawFinding[]);
    onApply(out, mode, {
      fileName,
      addedCount: diff.added.length,
      changedCount: diff.changed.length,
    });
    appendImportLog({
      step: "apply",
      mode,
      fileName,
      addedCount: diff.added.length,
      changedCount: diff.changed.length,
      unchangedCount: diff.unchanged.length,
      ignoredCount: diff.ignored.length,
    });
    reset();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Findings importieren (Drag & Drop)</DialogTitle>
        </DialogHeader>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
            dragOver
              ? "border-primary bg-primary/5"
              : "border-border bg-muted/20 hover:border-primary/50"
          }`}
        >
          <CloudUpload className={`h-8 w-8 ${dragOver ? "text-primary" : "text-muted-foreground"}`} />
          <div className="text-sm font-medium">JSON-Datei hier ablegen</div>
          <div className="text-xs text-muted-foreground">
            oder klicken zum Auswählen · max 5MB · Schema-validiert
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />
        </div>

        {fileName && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2 text-xs">
            <FileText className="h-3.5 w-3.5" />
            <span className="font-mono">{fileName}</span>
            <Button size="sm" variant="ghost" className="ml-auto h-6 px-2" onClick={reset}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}

        {errors.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2">
            <div className="text-xs font-medium text-destructive">Schema-Validierung fehlgeschlagen</div>
            <ul className="mt-1 space-y-0.5 text-[11px] text-destructive">
              {errors.slice(0, 5).map((e, i) => (
                <li key={i}>· {e}</li>
              ))}
            </ul>
          </div>
        )}

        {validation && (
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-md bg-emerald-500/10 p-2">
              <div className="text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                {validation.cleanCount}
              </div>
              <div className="text-[10px] text-muted-foreground">sauber</div>
            </div>
            <div className="rounded-md bg-amber-500/10 p-2">
              <div className="text-lg font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                {validation.warnCount}
              </div>
              <div className="text-[10px] text-muted-foreground">warnings</div>
            </div>
            <div className="rounded-md bg-destructive/10 p-2">
              <div className="text-lg font-semibold tabular-nums text-destructive">
                {validation.errorCount}
              </div>
              <div className="text-[10px] text-muted-foreground">fehler</div>
            </div>
          </div>
        )}

        {validation && validation.errorCount + validation.warnCount > 0 && (
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border bg-muted/20 p-2 text-[11px]">
            {validation.results
              .filter((r) => r.issues.length > 0)
              .slice(0, 12)
              .map((r) => (
                <div key={r.key} className="border-b border-border/50 pb-1 last:border-0">
                  <div className="font-mono text-muted-foreground">#{r.index} · {r.key}</div>
                  <ul className="ml-2 space-y-0.5">
                    {r.issues.map((iss, i) => (
                      <li
                        key={i}
                        className={
                          iss.severity === "error"
                            ? "text-destructive"
                            : iss.severity === "warn"
                            ? "text-amber-700 dark:text-amber-400"
                            : "text-muted-foreground"
                        }
                      >
                        · <strong>{iss.field}</strong>: {iss.message}
                        {iss.hint && <span className="block pl-3 text-muted-foreground">↳ {iss.hint}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        )}

        {diff && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium">
              <ShieldCheck className="h-3.5 w-3.5" /> Merge-Diff (gegen aktuelle Findings)
            </div>
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              <DiffStat label="hinzugefügt" count={diff.added.length} icon={Plus} tone="emerald" />
              <DiffStat label="geändert" count={diff.changed.length} icon={Pencil} tone="amber" />
              <DiffStat label="unverändert" count={diff.unchanged.length} tone="muted" />
              <DiffStat label="nur in alt" count={diff.ignored.length} tone="muted" />
            </div>
            {diff.changed.length > 0 && (
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-border bg-muted/10 p-2 text-[11px]">
                <div className="font-medium text-muted-foreground">Geänderte Felder:</div>
                {diff.changed.slice(0, 8).map((c) => (
                  <div key={c.key} className="flex flex-wrap gap-1">
                    <span className="font-mono text-muted-foreground">{c.key}</span>
                    {c.changedFields.map((f) => (
                      <Badge key={f} variant="outline" className="h-4 px-1 text-[10px]">
                        {f}
                      </Badge>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            variant="outline"
            disabled={!diff}
            onClick={() => apply("replace")}
          >
            Ersetzen
          </Button>
          <Button
            disabled={!diff || (validation?.errorCount ?? 0) > 0}
            onClick={() => apply("merge")}
          >
            Zusammenführen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DiffStat({
  label,
  count,
  icon: Icon,
  tone,
}: {
  label: string;
  count: number;
  icon?: typeof Plus;
  tone: "emerald" | "amber" | "muted";
}) {
  const toneCls =
    tone === "emerald"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : tone === "amber"
      ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
      : "bg-muted text-muted-foreground";
  return (
    <div className={`rounded-md p-2 ${toneCls}`}>
      <div className="flex items-center justify-center gap-1 text-lg font-semibold tabular-nums">
        {Icon && <Icon className="h-3 w-3" />} {count}
      </div>
      <div className="text-[10px]">{label}</div>
    </div>
  );
}
