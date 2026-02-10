import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { Download, Package, Loader2, CheckCircle, XCircle, Clock, FileText, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

interface Course {
  id: string;
  title: string;
  status: string;
}

interface ExportJob {
  id: string;
  course_id: string;
  status: string;
  output_path: string | null;
  file_size_bytes: number | null;
  error: string | null;
  created_at: string;
  formats: string[];
}

export default function CourseExportsPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<string>('');
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const [coursesRes, jobsRes] = await Promise.all([
      supabase.from('courses').select('id, title, status').order('title'),
      supabase.from('export_jobs').select('*').order('created_at', { ascending: false }).limit(20),
    ]);
    setCourses(coursesRes.data || []);
    setJobs((jobsRes.data || []) as ExportJob[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const startExport = async () => {
    if (!selectedCourse) {
      toast.error('Bitte wähle einen Kurs aus');
      return;
    }
    setExporting(true);
    try {
      const { data, error } = await supabase.functions.invoke('export-course-package', {
        body: { courseId: selectedCourse },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (data?.downloadUrl) {
        toast.success('Export fertig! Download startet...');
        window.open(data.downloadUrl, '_blank');
      } else {
        toast.success('Export-Job gestartet');
      }
      await fetchData();
    } catch (err: any) {
      toast.error(`Export fehlgeschlagen: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const downloadExport = async (job: ExportJob) => {
    if (!job.output_path) return;
    try {
      const { data, error } = await supabase.storage
        .from('exports')
        .createSignedUrl(job.output_path, 3600);
      if (error) throw error;
      if (data?.signedUrl) window.open(data.signedUrl, '_blank');
    } catch (err: any) {
      toast.error(`Download fehlgeschlagen: ${err.message}`);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'done':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><CheckCircle className="h-3 w-3 mr-1" /> Fertig</Badge>;
      case 'running':
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30"><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Läuft</Badge>;
      case 'failed':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><XCircle className="h-3 w-3 mr-1" /> Fehler</Badge>;
      default:
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30"><Clock className="h-3 w-3 mr-1" /> Wartend</Badge>;
    }
  };

  const formatBytes = (bytes: number | null) => {
    if (!bytes) return '–';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const courseTitleMap = Object.fromEntries(courses.map(c => [c.id, c.title]));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">Kurs-Exporte</h1>
        <p className="text-muted-foreground mt-1">1-Klick Export für Qualitätskontrolle (JSON + TSV + TSX + Markdown)</p>
      </div>

      {/* Export Action Card */}
      <Card className="glass-card border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Neuen Export erstellen
          </CardTitle>
          <CardDescription>
            Wähle einen Kurs und exportiere alle Inhalte als ZIP-Paket (JSON Snapshot, TSV Matrix, TSX Component, Markdown Review)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4">
            <Select value={selectedCourse} onValueChange={setSelectedCourse}>
              <SelectTrigger className="w-full sm:w-[400px]">
                <SelectValue placeholder="Kurs auswählen..." />
              </SelectTrigger>
              <SelectContent>
                {courses.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.title}
                    <span className="text-muted-foreground ml-2">({c.status})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={startExport}
              disabled={!selectedCourse || exporting}
              className="gradient-primary text-primary-foreground"
            >
              {exporting ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Exportiere...</>
              ) : (
                <><Download className="h-4 w-4 mr-2" /> Export starten</>
              )}
            </Button>
          </div>
          <div className="mt-4 text-sm text-muted-foreground space-y-1">
            <p>📦 <strong>course.json</strong> – Vollständiger SSOT-Snapshot (Modules, Lessons, Steps, MiniChecks, Audit)</p>
            <p>📊 <strong>course-matrix.tsv</strong> – QC-Matrix als Tab-separierte Datei (Excel-kompatibel)</p>
            <p>⚛️ <strong>course-export.tsx</strong> – TypeScript-Komponente für Dev/Review</p>
            <p>📝 <strong>course-review.md</strong> – Lesbares Markdown-Review-Dokument</p>
            <p>🔍 <strong>quality-report.json</strong> – Letzter IHK-Qualitäts-Audit (wenn vorhanden)</p>
          </div>
        </CardContent>
      </Card>

      {/* Export History */}
      <Card className="glass-card border-border/50">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Export-Verlauf</CardTitle>
            <CardDescription>Letzte 20 Exporte</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={fetchData}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : jobs.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">Noch keine Exporte vorhanden</p>
          ) : (
            <div className="space-y-3">
              {jobs.map(job => (
                <div key={job.id} className="flex items-center justify-between p-4 rounded-xl bg-muted/20 border border-border/30">
                  <div className="flex items-center gap-4 min-w-0">
                    <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">
                        {courseTitleMap[job.course_id] || job.course_id.substring(0, 8)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(job.created_at), 'dd. MMM yyyy, HH:mm', { locale: de })}
                        {job.file_size_bytes ? ` · ${formatBytes(job.file_size_bytes)}` : ''}
                      </p>
                      {job.error && <p className="text-xs text-destructive mt-1">{job.error}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {getStatusBadge(job.status)}
                    {job.status === 'done' && job.output_path && (
                      <Button variant="outline" size="sm" onClick={() => downloadExport(job)}>
                        <Download className="h-3.5 w-3.5 mr-1" /> Download
                      </Button>
                    )}
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
