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
        return <Badge className="bg-success/20 text-success border-success/30"><CheckCircle className="h-3 w-3 mr-1" /> Fertig</Badge>;
      case 'running':
        return <Badge className="bg-info/20 text-info border-info/30"><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Läuft</Badge>;
      case 'failed':
        return <Badge className="bg-destructive/20 text-destructive border-destructive/30"><XCircle className="h-3 w-3 mr-1" /> Fehler</Badge>;
      default:
        return <Badge className="bg-warning/20 text-warning border-warning/30"><Clock className="h-3 w-3 mr-1" /> Wartend</Badge>;
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
    <div className="space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground">Kurs-Exporte</h1>
        <p className="text-sm text-muted-foreground mt-1">1-Klick Export für QC (JSON + TSV + TSX + MD)</p>
      </div>

      {/* Export Action Card */}
      <Card className="glass-card border-border/50">
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Package className="h-5 w-5 text-primary" />
            Neuen Export erstellen
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Kurs als ZIP-Paket exportieren (JSON, TSV, TSX, Markdown)
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0 sm:pt-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
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
              className="gradient-primary text-primary-foreground w-full sm:w-auto"
            >
              {exporting ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Exportiere...</>
              ) : (
                <><Download className="h-4 w-4 mr-2" /> Export starten</>
              )}
            </Button>
          </div>
          <div className="mt-4 text-xs sm:text-sm text-muted-foreground space-y-1 hidden sm:block">
            <p>📦 <strong>course.json</strong> – SSOT-Snapshot</p>
            <p>📊 <strong>course-matrix.tsv</strong> – QC-Matrix (Excel)</p>
            <p>⚛️ <strong>course-export.tsx</strong> – TSX Component</p>
            <p>📝 <strong>course-review.md</strong> – Review-Dokument</p>
            <p>🔍 <strong>quality-report.json</strong> – Qualitäts-Audit</p>
          </div>
        </CardContent>
      </Card>

      {/* Export History */}
      <Card className="glass-card border-border/50">
        <CardHeader className="flex flex-row items-center justify-between p-4 sm:p-6">
          <div>
            <CardTitle className="text-base sm:text-lg">Export-Verlauf</CardTitle>
            <CardDescription className="text-xs sm:text-sm">Letzte 20 Exporte</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={fetchData}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0 sm:pt-0">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : jobs.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">Noch keine Exporte vorhanden</p>
          ) : (
            <div className="space-y-3">
              {jobs.map(job => (
                <div key={job.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 sm:p-4 rounded-xl bg-muted/20 border border-border/30">
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium text-xs sm:text-sm truncate">
                        {courseTitleMap[job.course_id] || job.course_id.substring(0, 8)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(job.created_at), 'dd. MMM yyyy, HH:mm', { locale: de })}
                        {job.file_size_bytes ? ` · ${formatBytes(job.file_size_bytes)}` : ''}
                      </p>
                      {job.error && <p className="text-xs text-destructive mt-1 line-clamp-1">{job.error}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-3 ml-7 sm:ml-0">
                    {getStatusBadge(job.status)}
                    {job.status === 'done' && job.output_path && (
                      <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => downloadExport(job)}>
                        <Download className="h-3 w-3 mr-1" /> Download
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
