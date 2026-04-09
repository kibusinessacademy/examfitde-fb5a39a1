import { useCallback, useRef, useState } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Upload, FileText, CheckCircle2, XCircle, AlertTriangle,
  Play, Loader2, ArrowRight
} from 'lucide-react';
import {
  useCreateBulkImportJob,
  useValidateBulkImport,
  useDryRunBulkImport,
  useExecuteBulkImport,
} from '@/hooks/useBulkImport';
import type { ValidationResult, DryRunResult, ExecutionResult } from '@/types/enterprise';
import { toast } from 'sonner';

type Step = 'upload' | 'validating' | 'validated' | 'dry_run' | 'executing' | 'done';

export default function BulkImportPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [step, setStep] = useState<Step>('upload');
  const [jobId, setJobId] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [rowCount, setRowCount] = useState(0);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const createJob = useCreateBulkImportJob();
  const validate = useValidateBulkImport();
  const dryRunMut = useDryRunBulkImport();
  const execute = useExecuteBulkImport();

  const parseCSV = useCallback((text: string): Record<string, string>[] => {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    const sep = lines[0].includes(';') ? ';' : ',';
    const headers = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, ''));
    return lines.slice(1).map(line => {
      const vals = line.split(sep).map(v => v.trim().replace(/^"|"$/g, ''));
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
      return obj;
    });
  }, []);

  const handleFileUpload = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (rows.length === 0) {
        toast.error('Keine Daten in der CSV-Datei gefunden');
        return;
      }
      setFileName(file.name);
      setRowCount(rows.length);
      setStep('validating');

      const id = await createJob.mutateAsync({ fileName: file.name, rawData: rows });
      setJobId(id);

      const res = await validate.mutateAsync(id);
      setValidation(res);
      setStep('validated');
    } catch (err: any) {
      toast.error(err.message || 'Upload fehlgeschlagen');
      setStep('upload');
    }
  }, [createJob, validate, parseCSV]);

  const handleDryRun = useCallback(async () => {
    if (!jobId) return;
    try {
      setStep('dry_run');
      const res = await dryRunMut.mutateAsync(jobId);
      setDryRun(res);
    } catch (err: any) {
      toast.error(err.message || 'Dry Run fehlgeschlagen');
      setStep('validated');
    }
  }, [jobId, dryRunMut]);

  const handleExecute = useCallback(async () => {
    if (!jobId) return;
    try {
      setStep('executing');
      const res = await execute.mutateAsync(jobId);
      setResult(res);
      setStep('done');
      toast.success(`Import abgeschlossen: ${res.created} erstellt, ${res.updated} aktualisiert`);
    } catch (err: any) {
      toast.error(err.message || 'Import fehlgeschlagen');
      setStep('dry_run');
    }
  }, [jobId, execute]);

  const reset = useCallback(() => {
    setStep('upload');
    setJobId(null);
    setFileName('');
    setRowCount(0);
    setValidation(null);
    setDryRun(null);
    setResult(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.csv')) handleFileUpload(file);
    else toast.error('Bitte eine CSV-Datei verwenden');
  }, [handleFileUpload]);

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            Bulk Import
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {/* Progress */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {['Upload', 'Validierung', 'Dry Run', 'Import', 'Ergebnis'].map((label, i) => {
              const stepIdx = ['upload', 'validated', 'dry_run', 'executing', 'done'].indexOf(step);
              const isActive = i <= Math.max(0, stepIdx);
              return (
                <div key={label} className="flex items-center gap-1">
                  {i > 0 && <ArrowRight className="h-3 w-3" />}
                  <span className={isActive ? 'text-foreground font-medium' : ''}>{label}</span>
                </div>
              );
            })}
          </div>

          {/* Step: Upload */}
          {step === 'upload' && (
            <div
              className="rounded-xl border-2 border-dashed border-muted-foreground/30 p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
            >
              <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground">CSV-Datei hierher ziehen</p>
              <p className="text-xs text-muted-foreground mt-1">oder klicken zum Auswählen</p>
              <p className="text-[11px] text-muted-foreground mt-3">
                Pflichtfelder: <code>external_id</code>, <code>email</code><br />
                Optional: <code>first_name</code>, <code>last_name</code>, <code>org_id</code>, <code>role</code>
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) handleFileUpload(f);
                }}
              />
            </div>
          )}

          {/* Step: Validating */}
          {step === 'validating' && (
            <Card className="rounded-xl">
              <CardContent className="p-6 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
                <p className="text-sm font-medium">Validiere {rowCount} Zeilen...</p>
                <p className="text-xs text-muted-foreground">{fileName}</p>
              </CardContent>
            </Card>
          )}

          {/* Step: Validated */}
          {step === 'validated' && validation && (
            <div className="space-y-4">
              <Card className="rounded-xl">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{fileName}</span>
                    <Badge variant="outline">{validation.total_rows} Zeilen</Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-lg bg-success/5 border border-success/20 p-3 text-center">
                      <CheckCircle2 className="h-4 w-4 text-success mx-auto mb-1" />
                      <div className="text-lg font-bold text-foreground">{validation.valid_count}</div>
                      <div className="text-[10px] text-muted-foreground">Gültig</div>
                    </div>
                    <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-3 text-center">
                      <XCircle className="h-4 w-4 text-destructive mx-auto mb-1" />
                      <div className="text-lg font-bold text-foreground">{validation.error_count}</div>
                      <div className="text-[10px] text-muted-foreground">Fehler</div>
                    </div>
                    <div className="rounded-lg bg-warning/5 border border-warning/20 p-3 text-center">
                      <AlertTriangle className="h-4 w-4 text-warning mx-auto mb-1" />
                      <div className="text-lg font-bold text-foreground">{validation.warning_count}</div>
                      <div className="text-[10px] text-muted-foreground">Warnungen</div>
                    </div>
                  </div>

                  {validation.errors.length > 0 && (
                    <div className="rounded-lg border p-3 space-y-1 max-h-40 overflow-y-auto">
                      <div className="text-xs font-medium text-destructive">Fehler</div>
                      {validation.errors.slice(0, 20).map((e, i) => (
                        <div key={i} className="text-[11px] text-muted-foreground">
                          Zeile {e.row}: {e.field} – {e.message}
                        </div>
                      ))}
                    </div>
                  )}

                  {validation.warnings.length > 0 && (
                    <div className="rounded-lg border p-3 space-y-1 max-h-40 overflow-y-auto">
                      <div className="text-xs font-medium text-warning">Warnungen</div>
                      {validation.warnings.slice(0, 20).map((w, i) => (
                        <div key={i} className="text-[11px] text-muted-foreground">
                          Zeile {w.row}: {w.field} – {w.message}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="flex gap-3">
                <Button variant="outline" className="rounded-xl" onClick={reset}>
                  Abbrechen
                </Button>
                <Button
                  className="rounded-xl flex-1"
                  onClick={handleDryRun}
                  disabled={validation.valid_count === 0}
                >
                  <Play className="h-4 w-4 mr-2" />
                  Dry Run starten
                </Button>
              </div>
            </div>
          )}

          {/* Step: Dry Run Result */}
          {step === 'dry_run' && dryRun && (
            <div className="space-y-4">
              <Card className="rounded-xl">
                <CardContent className="p-4 space-y-3">
                  <div className="text-sm font-medium">Dry Run Ergebnis</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-success/5 border border-success/20 p-3 text-center">
                      <div className="text-lg font-bold">{dryRun.to_create}</div>
                      <div className="text-[10px] text-muted-foreground">Neu erstellen</div>
                    </div>
                    <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 text-center">
                      <div className="text-lg font-bold">{dryRun.to_update}</div>
                      <div className="text-[10px] text-muted-foreground">Aktualisieren</div>
                    </div>
                  </div>

                  {dryRun.preview.length > 0 && (
                    <div className="rounded-lg border max-h-48 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="p-2 text-left">E-Mail</th>
                            <th className="p-2 text-left">Aktion</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dryRun.preview.slice(0, 50).map((row, i) => (
                            <tr key={i} className="border-t">
                              <td className="p-2 text-muted-foreground">{row.email}</td>
                              <td className="p-2">
                                <Badge variant={row.action === 'create' ? 'default' : 'outline'} className="text-[10px]">
                                  {row.action === 'create' ? 'Neu' : 'Update'}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="flex gap-3">
                <Button variant="outline" className="rounded-xl" onClick={reset}>
                  Abbrechen
                </Button>
                <Button className="rounded-xl flex-1" onClick={handleExecute}>
                  <Play className="h-4 w-4 mr-2" />
                  Import durchführen
                </Button>
              </div>
            </div>
          )}

          {/* Step: Executing */}
          {step === 'executing' && (
            <Card className="rounded-xl">
              <CardContent className="p-6 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
                <p className="text-sm font-medium">Import wird durchgeführt...</p>
              </CardContent>
            </Card>
          )}

          {/* Step: Done */}
          {step === 'done' && result && (
            <div className="space-y-4">
              <Card className="rounded-xl">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-success" />
                    <span className="text-sm font-medium">Import abgeschlossen</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-lg bg-success/5 border border-success/20 p-3 text-center">
                      <div className="text-lg font-bold">{result.created}</div>
                      <div className="text-[10px] text-muted-foreground">Erstellt</div>
                    </div>
                    <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 text-center">
                      <div className="text-lg font-bold">{result.updated}</div>
                      <div className="text-[10px] text-muted-foreground">Aktualisiert</div>
                    </div>
                    <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-3 text-center">
                      <div className="text-lg font-bold">{result.failed}</div>
                      <div className="text-[10px] text-muted-foreground">Fehlgeschlagen</div>
                    </div>
                  </div>

                  {result.errors.length > 0 && (
                    <div className="rounded-lg border p-3 space-y-1 max-h-40 overflow-y-auto">
                      <div className="text-xs font-medium text-destructive">Fehler</div>
                      {result.errors.map((e, i) => (
                        <div key={i} className="text-[11px] text-muted-foreground">
                          {e.email}: {e.error}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Button className="rounded-xl w-full" onClick={reset}>
                Neuen Import starten
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
