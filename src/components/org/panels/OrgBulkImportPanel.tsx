import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload, FileText, CheckCircle2, AlertTriangle } from 'lucide-react';
import { EmptyState } from '@/components/admin/enterprise/shared/EmptyState';

interface Props {
  orgId: string;
}

export default function OrgBulkImportPanel({ orgId }: Props) {
  const [file, setFile] = useState<File | null>(null);

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        {/* Upload */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Upload className="h-4 w-4" /> CSV Upload
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
              <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-xs text-muted-foreground mb-3">
                CSV-Datei hier ablegen oder klicken
              </p>
              <input
                type="file"
                accept=".csv"
                className="hidden"
                id="bulk-csv"
                onChange={e => setFile(e.target.files?.[0] || null)}
              />
              <Button variant="outline" size="sm" className="text-xs" onClick={() => document.getElementById('bulk-csv')?.click()}>
                Datei auswählen
              </Button>
              {file && (
                <p className="text-xs text-foreground mt-2 flex items-center justify-center gap-1">
                  <FileText className="h-3 w-3" /> {file.name}
                </p>
              )}
            </div>
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
              email, first_name, last_name, role, external_id
            </code>
            <p className="text-xs text-muted-foreground mt-2">
              Rolle: learner, manager, trainer
            </p>
            <Button variant="link" size="sm" className="text-xs p-0 h-auto">
              Vorlage herunterladen
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Import History */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Import-Historie</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={<FileText className="h-5 w-5" />}
            title="Keine Importe"
            description="Es wurden noch keine Bulk-Importe für diese Organisation durchgeführt."
          />
        </CardContent>
      </Card>
    </div>
  );
}
