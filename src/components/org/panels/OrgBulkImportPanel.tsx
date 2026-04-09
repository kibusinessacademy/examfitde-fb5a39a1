import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Upload, FileText, CheckCircle2, AlertTriangle, Play, Eye, Loader2 } from 'lucide-react';
import { EmptyState } from '@/components/admin/enterprise/shared/EmptyState';
import { useOrgImportJobs, useRunBulkImport, type ImportRow, type ImportResult } from '@/hooks/useOrgEnterprise';
import { toast } from 'sonner';

interface Props {
  orgId: string;
}

function parseCSV(text: string): ImportRow[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/"/g, ''));
    const row: any = {};
    headers.forEach((h, i) => { row[h] = vals[i] || ''; });
    return row as ImportRow;
  });
}

export default function OrgBulkImportPanel({ orgId }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ImportRow[]>([]);
  const [dryRunResult, setDryRunResult] = useState<ImportResult | null>(null);
  const [executeResult, setExecuteResult] = useState<ImportResult | null>(null);

  const { data: jobs, isLoading: jobsLoading } = useOrgImportJobs(orgId);
  const importMutation = useRunBulkImport();

  const handleFileChange = useCallback(async (f: File | null) => {
    setFile(f);
    setDryRunResult(null);
    setExecuteResult(null);
    if (!f) { setParsedRows([]); return; }
    const text = await f.text();
    const rows = parseCSV(text);
    setParsedRows(rows);
    if (rows.length === 0) toast.error('Keine gültigen Zeilen gefunden');
  }, []);

  const runDryRun = useCallback(async () => {
    if (!parsedRows.length) return;
    try {
      const res = await importMutation.mutateAsync({
        org_id: orgId,
        rows: parsedRows,
        dry_run: true,
        file_name: file?.name,
      });
      setDryRunResult(res);
      toast.success(`Dry Run: ${res.valid_count} gültig, ${res.error_count} Fehler`);
    } catch (err: any) {
      toast.error(err.message);
    }
  }, [parsedRows, orgId, file]);

  const runExecute = useCallback(async () => {
    if (!parsedRows.length) return;
    try {
      const res = await importMutation.mutateAsync({
        org_id: orgId,
        rows: parsedRows,
        dry_run: false,
        file_name: file?.name,
      });
      setExecuteResult(res);
      toast.success(`Import: ${res.created_count} erstellt, ${res.updated_count} aktualisiert`);
    } catch (err: any) {
      toast.error(err.message);
    }
  }, [parsedRows, orgId, file]);

  return (
    <div className="space-y-4">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-3 text-center">
          <p className="text-[10px] text-muted-foreground">Letzte Importe</p>
          <p className="text-lg font-bold">{jobs?.length ?? 0}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <p className="text-[10px] text-muted-foreground">Erfolgreiche</p>
          <p className="text-lg font-bold text-green-600">{jobs?.filter(j => (j as any).status === 'completed').length ?? 0}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <p className="text-[10px] text-muted-foreground">Geladene Zeilen</p>
          <p className="text-lg font-bold">{parsedRows.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <p className="text-[10px] text-muted-foreground">Letzter Dry Run</p>
          <p className="text-lg font-bold">{dryRunResult ? '✓' : '–'}</p>
        </CardContent></Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Upload */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Upload className="h-4 w-4" /> CSV Upload
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
              <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-xs text-muted-foreground mb-3">
                CSV-Datei hier ablegen oder klicken
              </p>
              <input
                type="file"
                accept=".csv"
                className="hidden"
                id="bulk-csv"
                onChange={e => handleFileChange(e.target.files?.[0] || null)}
              />
              <Button variant="outline" size="sm" className="text-xs" onClick={() => document.getElementById('bulk-csv')?.click()}>
                Datei auswählen
              </Button>
              {file && (
                <p className="text-xs text-foreground mt-2 flex items-center justify-center gap-1">
                  <FileText className="h-3 w-3" /> {file.name} ({parsedRows.length} Zeilen)
                </p>
              )}
            </div>

            {parsedRows.length > 0 && (
              <div className="flex gap-2 mt-3">
                <Button size="sm" variant="outline" className="text-xs flex-1" onClick={runDryRun} disabled={importMutation.isPending}>
                  {importMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Eye className="h-3 w-3 mr-1" />}
                  Dry Run
                </Button>
                <Button size="sm" className="text-xs flex-1" onClick={runExecute} disabled={importMutation.isPending || !dryRunResult}>
                  {importMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                  Import starten
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Format */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">CSV Format</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">Erwartete Spalten:</p>
            <code className="block text-[10px] bg-muted p-2 rounded">
              email, display_name, role, product_slug, assign_seat, external_id
            </code>
            <p className="text-xs text-muted-foreground mt-2">
              Rollen: LEARNER, MANAGER, TRAINER, IT_ADMIN, BILLING
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Dry Run Result */}
      {dryRunResult && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Eye className="h-4 w-4" /> Dry Run Ergebnis
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 mb-3">
              <Badge variant="outline" className="text-green-600">✓ {dryRunResult.valid_count} gültig</Badge>
              <Badge variant="outline" className="text-red-600">✗ {dryRunResult.error_count} Fehler</Badge>
            </div>
            {dryRunResult.error_rows.length > 0 && (
              <div className="max-h-40 overflow-y-auto text-xs space-y-1">
                {dryRunResult.error_rows.map((e, i) => (
                  <div key={i} className="flex gap-2 text-red-600">
                    <span className="font-mono">Z.{e.row}</span>
                    <span>{e.email}</span>
                    <span>{e.errors?.join(', ') || e.error}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Execute Result */}
      {executeResult && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" /> Import Ergebnis
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3 mb-3">
              <Badge variant="outline" className="text-green-600">{executeResult.created_count} erstellt</Badge>
              <Badge variant="outline" className="text-blue-600">{executeResult.updated_count} aktualisiert</Badge>
              {(executeResult.error_rows?.length ?? 0) > 0 && (
                <Badge variant="outline" className="text-red-600">{executeResult.error_rows.length} Fehler</Badge>
              )}
            </div>
            {executeResult.error_rows.length > 0 && (
              <div className="max-h-40 overflow-y-auto text-xs space-y-1">
                {executeResult.error_rows.map((e, i) => (
                  <div key={i} className="flex gap-2 text-red-600">
                    <span className="font-mono">Z.{e.row}</span>
                    <span>{e.email}</span>
                    <span>{e.error}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Import History */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Import-Historie</CardTitle>
        </CardHeader>
        <CardContent>
          {!jobs?.length ? (
            <EmptyState
              icon={<FileText className="h-5 w-5" />}
              title="Keine Importe"
              description="Es wurden noch keine Bulk-Importe durchgeführt."
            />
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {jobs.map((j: any) => (
                <div key={j.id} className="flex items-center justify-between text-xs border rounded p-2">
                  <div>
                    <span className="font-medium">{j.file_name || 'Import'}</span>
                    <span className="text-muted-foreground ml-2">{new Date(j.created_at).toLocaleDateString('de-DE')}</span>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant={j.status === 'completed' ? 'default' : 'secondary'} className="text-[10px]">
                      {j.status}
                    </Badge>
                    <span className="text-muted-foreground">
                      {j.created_count}↑ {j.updated_count}↻ {j.failed_rows}✗
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
