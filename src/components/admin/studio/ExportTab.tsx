import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

export default function ExportTab({ pkg, packageId }: { pkg: any; packageId: string }) {
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [jsxExportUrl, setJsxExportUrl] = useState<string | null>(null);
  const [jsxExporting, setJsxExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke('export-course-package', {
        body: { packageId, courseId: pkg.course_id },
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (res.error) throw res.error;
      const resData = res.data as Record<string, unknown>;
      if (resData?.downloadUrl) { setExportUrl(resData.downloadUrl as string); toast.success('ZIP-Export erstellt'); }
    } catch (e: any) { toast.error(`Export-Fehler: ${e?.message || 'Unbekannt'}`); }
    finally { setExporting(false); }
  };

  const handleJsxExport = async () => {
    setJsxExporting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke('export-jsx-package', {
        body: { packageId, courseId: pkg.course_id },
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (res.error) throw res.error;
      const resData = res.data as Record<string, unknown>;
      if (resData?.downloadUrl) {
        setJsxExportUrl(resData.downloadUrl as string);
        const a = document.createElement('a'); a.href = resData.downloadUrl as string; a.target = '_blank'; a.rel = 'noopener noreferrer';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        toast.success('JSX Export erstellt – Download geöffnet');
      }
    } catch (e: any) { toast.error(`JSX Export-Fehler: ${e?.message || 'Unbekannt'}`); }
    finally { setJsxExporting(false); }
  };

  const exports = [
    { key: 'zip', label: 'ZIP Package Export', desc: 'Komplett: Lernkurs + Fragen + Oral + Tutor + Handbuch', icon: '📦', action: handleExport, actionLabel: 'Exportieren', loading: exporting },
    { key: 'jsx', label: 'JSX Export', desc: 'React/Content Pack (Module + Lessons + Handbuch)', icon: '⚛️', action: handleJsxExport, actionLabel: 'JSX Exportieren', loading: jsxExporting },
    { key: 'json', label: 'JSON SSOT Snapshot', desc: 'Curriculum + Plan + Blueprints + Coverage', icon: '🗂' },
    { key: 'csv', label: 'Questions CSV/QTI', desc: 'Fragenpool als CSV oder QTI-Format', icon: '📊' },
    { key: 'handbook', label: 'Handbuch PDF/MD', desc: 'Handbuch als PDF oder Markdown', icon: '📖' },
  ];

  return (
    <div className="space-y-4">
      {exportUrl && (
        <Card className="border-success/30 bg-success/5">
          <CardContent className="p-4 flex flex-col sm:flex-row items-center gap-3">
            <Download className="h-5 w-5 text-success shrink-0" />
            <div className="flex-1 min-w-0"><p className="text-sm font-medium">ZIP-Export bereit</p><p className="text-xs text-muted-foreground">Link gültig für 1 Stunde</p></div>
            <Button size="sm" asChild><a href={exportUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3 w-3 mr-1" /> Herunterladen</a></Button>
          </CardContent>
        </Card>
      )}
      {jsxExportUrl && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 flex flex-col sm:flex-row items-center gap-3">
            <Download className="h-5 w-5 text-primary shrink-0" />
            <div className="flex-1 min-w-0"><p className="text-sm font-medium">JSX Export bereit</p><p className="text-xs text-muted-foreground">Link gültig für 1 Stunde</p></div>
            <Button size="sm" asChild><a href={jsxExportUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3 w-3 mr-1" /> Herunterladen</a></Button>
          </CardContent>
        </Card>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {exports.map(exp => (
          <Card key={exp.key} className="hover:border-primary/30 transition-colors">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <span className="text-2xl">{exp.icon}</span>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold">{exp.label}</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">{exp.desc}</p>
                  {exp.action ? (
                    <Button variant="outline" size="sm" className="mt-2" onClick={exp.action} disabled={exp.loading || pkg.status === 'planning'}>
                      {exp.loading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />} {exp.actionLabel}
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" className="mt-2" disabled={pkg.status !== 'published'}>
                      <Download className="h-3 w-3 mr-1" /> Exportieren
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
