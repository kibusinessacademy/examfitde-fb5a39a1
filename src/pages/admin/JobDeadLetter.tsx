import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { 
  RefreshCw, 
  Loader2, 
  Eye,
  Trash2,
  RotateCcw,
  AlertTriangle,
  XCircle,
  HelpCircle
} from 'lucide-react';
import { toast } from 'sonner';
import type { Json } from '@/integrations/supabase/types';

interface DeadLetterJob {
  id: string;
  job_type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  payload: Json;
  created_at: string;
  updated_at: string;
}

type ErrorClass = 'logical' | 'technical' | 'unknown';

function classifyError(error: string | null): ErrorClass {
  if (!error) return 'unknown';
  
  const lowerError = error.toLowerCase();
  
  if (
    lowerError.includes('ssot') ||
    lowerError.includes('curriculum_id') ||
    lowerError.includes('slug') ||
    lowerError.includes('invalid payload')
  ) {
    return 'logical';
  }
  
  if (
    lowerError.includes('timeout') ||
    lowerError.includes('network') ||
    lowerError.includes('deadlock') ||
    lowerError.includes('connection') ||
    lowerError.includes('rate limit') ||
    lowerError.includes('503') ||
    lowerError.includes('502') ||
    lowerError.includes('504')
  ) {
    return 'technical';
  }
  
  return 'unknown';
}

function getErrorClassBadge(errorClass: ErrorClass) {
  switch (errorClass) {
    case 'logical':
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          Logisch
        </Badge>
      );
    case 'technical':
      return (
        <Badge variant="outline" className="gap-1 bg-warning/10 text-warning border-warning/30">
          <AlertTriangle className="h-3 w-3" />
          Technisch
        </Badge>
      );
    case 'unknown':
      return (
        <Badge variant="outline" className="gap-1">
          <HelpCircle className="h-3 w-3" />
          Unbekannt
        </Badge>
      );
  }
}

export default function JobDeadLetter() {
  const [jobs, setJobs] = useState<DeadLetterJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [requeuing, setRequeuing] = useState(false);
  const [selectedJob, setSelectedJob] = useState<DeadLetterJob | null>(null);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('job_deadletter')
        .select('*')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setJobs(data || []);
    } catch (error) {
      console.error('Error fetching dead letter jobs:', error);
      toast.error('Fehler beim Laden der Dead-Letter-Jobs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  const handleRequeueTechnical = async () => {
    setRequeuing(true);
    try {
      const { data, error } = await supabase.rpc('requeue_failed_jobs');
      if (error) throw error;
      toast.success(`${data} technische Fehler wurden erneut eingereiht`);
      fetchJobs();
    } catch (error) {
      console.error('Requeue error:', error);
      toast.error('Fehler beim Requeue');
    } finally {
      setRequeuing(false);
    }
  };

  const handleCancelJob = async (jobId: string) => {
    try {
      const { error } = await supabase
        .from('job_queue')
        .update({ 
          status: 'cancelled',
          locked_at: null,
          locked_by: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', jobId);

      if (error) throw error;
      toast.success('Job wurde abgebrochen');
      fetchJobs();
    } catch (error) {
      console.error('Cancel error:', error);
      toast.error('Fehler beim Abbrechen');
    }
  };

  const technicalCount = jobs.filter(j => classifyError(j.last_error) === 'technical').length;
  const logicalCount = jobs.filter(j => classifyError(j.last_error) === 'logical').length;
  const unknownCount = jobs.filter(j => classifyError(j.last_error) === 'unknown').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Dead-Letter Inbox</h1>
          <p className="text-muted-foreground mt-1">Fehlgeschlagene Jobs, die Aufmerksamkeit erfordern</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={fetchJobs} disabled={loading} variant="outline">
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Aktualisieren
          </Button>
          {technicalCount > 0 && (
            <Button 
              onClick={handleRequeueTechnical} 
              disabled={requeuing}
              variant="default"
            >
              {requeuing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4 mr-2" />
              )}
              Technische Retry ({technicalCount})
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4 flex items-center gap-4">
            <XCircle className="h-8 w-8 text-destructive" />
            <div>
              <p className="text-2xl font-bold">{logicalCount}</p>
              <p className="text-sm text-muted-foreground">Logische Fehler</p>
              <p className="text-xs text-destructive">Kein Retry möglich</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="p-4 flex items-center gap-4">
            <AlertTriangle className="h-8 w-8 text-warning" />
            <div>
              <p className="text-2xl font-bold">{technicalCount}</p>
              <p className="text-sm text-muted-foreground">Technische Fehler</p>
              <p className="text-xs text-warning">Retry möglich</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-muted/30">
          <CardContent className="p-4 flex items-center gap-4">
            <HelpCircle className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold">{unknownCount}</p>
              <p className="text-sm text-muted-foreground">Unbekannte Fehler</p>
              <p className="text-xs text-muted-foreground">Manuell prüfen</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Jobs Table */}
      <Card className="glass-card border-border/50">
        <CardHeader>
          <CardTitle>Fehlgeschlagene Jobs</CardTitle>
          <CardDescription>{jobs.length} Jobs im Dead-Letter-Postfach</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : jobs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              🎉 Keine fehlgeschlagenen Jobs - alles läuft!
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job-ID</TableHead>
                    <TableHead>Typ</TableHead>
                    <TableHead>Fehlerklasse</TableHead>
                    <TableHead>Versuche</TableHead>
                    <TableHead>Fehler</TableHead>
                    <TableHead>Aktualisiert</TableHead>
                    <TableHead className="text-right">Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => {
                    const errorClass = classifyError(job.last_error);
                    return (
                      <TableRow key={job.id}>
                        <TableCell className="font-mono text-xs">
                          {job.id.slice(0, 8)}...
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{job.job_type}</Badge>
                        </TableCell>
                        <TableCell>
                          {getErrorClassBadge(errorClass)}
                        </TableCell>
                        <TableCell>
                          {job.attempts} / {job.max_attempts}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-destructive text-sm">
                          {job.last_error || 'Kein Fehler'}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {new Date(job.updated_at).toLocaleString('de-DE')}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button 
                                  variant="ghost" 
                                  size="sm"
                                  onClick={() => setSelectedJob(job)}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-2xl">
                                <DialogHeader>
                                  <DialogTitle>Job Details</DialogTitle>
                                  <DialogDescription>
                                    {job.job_type} - {job.id}
                                  </DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4">
                                  <div>
                                    <h4 className="font-semibold mb-2">Fehler</h4>
                                    <div className="p-3 bg-destructive/10 rounded-lg text-destructive text-sm">
                                      {job.last_error || 'Kein Fehler'}
                                    </div>
                                  </div>
                                  <div>
                                    <h4 className="font-semibold mb-2">Payload</h4>
                                    <ScrollArea className="h-[200px] w-full rounded-lg border p-3">
                                      <pre className="text-xs">
                                        {JSON.stringify(job.payload, null, 2)}
                                      </pre>
                                    </ScrollArea>
                                  </div>
                                </div>
                              </DialogContent>
                            </Dialog>
                            
                            <Button 
                              variant="ghost" 
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => handleCancelJob(job.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
