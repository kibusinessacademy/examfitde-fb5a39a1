import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { 
  ArrowLeft, 
  RefreshCw, 
  Loader2,
  XCircle,
  AlertTriangle,
  Clock,
  Activity,
  CheckCircle2,
  Ban
} from 'lucide-react';
import { toast } from 'sonner';
import type { Json } from '@/integrations/supabase/types';

interface Job {
  id: string;
  job_type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  priority: number;
  payload: Json;
  result: Json | null;
  last_error: string | null;
  locked_at: string | null;
  locked_by: string | null;
  run_after: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

const statusConfig: Record<string, { icon: React.ReactNode; color: string }> = {
  pending: { 
    icon: <Clock className="h-5 w-5" />, 
    color: 'bg-warning/10 text-warning border-warning/30' 
  },
  processing: { 
    icon: <Activity className="h-5 w-5" />, 
    color: 'bg-primary/10 text-primary border-primary/30' 
  },
  completed: { 
    icon: <CheckCircle2 className="h-5 w-5" />, 
    color: 'bg-success/10 text-success border-success/30' 
  },
  failed: { 
    icon: <XCircle className="h-5 w-5" />, 
    color: 'bg-destructive/10 text-destructive border-destructive/30' 
  },
  cancelled: { 
    icon: <Ban className="h-5 w-5" />, 
    color: 'bg-muted text-muted-foreground border-muted' 
  },
};

export default function JobDetail() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  const fetchJob = async () => {
    if (!jobId) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('job_queue')
        .select('*')
        .eq('id', jobId)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        toast.error('Job nicht gefunden');
        navigate('/admin-v2/jobs');
        return;
      }
      setJob(data);
    } catch (error) {
      console.error('Error fetching job:', error);
      toast.error('Fehler beim Laden des Jobs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJob();
  }, [jobId]);

  const handleCancel = async () => {
    if (!job) return;
    
    setCancelling(true);
    try {
      const { error } = await supabase
        .from('job_queue')
        .update({ 
          status: 'cancelled',
          locked_at: null,
          locked_by: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id);

      if (error) throw error;
      toast.success('Job wurde abgebrochen');
      fetchJob();
    } catch (error) {
      console.error('Cancel error:', error);
      toast.error('Fehler beim Abbrechen');
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!job) {
    return null;
  }

  const statusInfo = statusConfig[job.status] || statusConfig.pending;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Job Details</h1>
            <p className="text-muted-foreground font-mono text-sm">{job.id}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={fetchJob} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Aktualisieren
          </Button>
          {(job.status === 'pending' || job.status === 'processing' || job.status === 'failed') && (
            <Button 
              onClick={handleCancel} 
              variant="destructive" 
              size="sm"
              disabled={cancelling}
            >
              {cancelling ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Ban className="h-4 w-4 mr-2" />
              )}
              Abbrechen
            </Button>
          )}
        </div>
      </div>

      {/* Status Banner */}
      <Card className={`border ${job.status === 'failed' ? 'border-destructive/50 bg-destructive/5' : 'border-border/50'}`}>
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-xl ${statusInfo.color}`}>
              {statusInfo.icon}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={statusInfo.color}>
                  {job.status.toUpperCase()}
                </Badge>
                <Badge variant="outline">{job.job_type}</Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Versuche: {job.attempts} / {job.max_attempts} | Priorität: {job.priority}
              </p>
            </div>
          </div>
          {job.locked_by && (
            <div className="text-right">
              <p className="text-sm font-medium">Gesperrt von</p>
              <p className="text-sm text-muted-foreground">{job.locked_by}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Error Banner */}
      {job.last_error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
              <div>
                <p className="font-semibold text-destructive">Letzter Fehler</p>
                <p className="text-sm text-destructive/80 mt-1">{job.last_error}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs defaultValue="meta" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="meta">Meta</TabsTrigger>
          <TabsTrigger value="payload">Payload</TabsTrigger>
          <TabsTrigger value="result">Result</TabsTrigger>
        </TabsList>

        <TabsContent value="meta" className="mt-4">
          <Card className="glass-card border-border/50">
            <CardHeader>
              <CardTitle>Metadaten</CardTitle>
              <CardDescription>Zeitstempel und Ausführungsinformationen</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Erstellt</p>
                  <p className="font-medium">{new Date(job.created_at).toLocaleString('de-DE')}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Aktualisiert</p>
                  <p className="font-medium">{new Date(job.updated_at).toLocaleString('de-DE')}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Gestartet</p>
                  <p className="font-medium">
                    {job.started_at ? new Date(job.started_at).toLocaleString('de-DE') : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Abgeschlossen</p>
                  <p className="font-medium">
                    {job.completed_at ? new Date(job.completed_at).toLocaleString('de-DE') : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Ausführen nach</p>
                  <p className="font-medium">{new Date(job.run_after).toLocaleString('de-DE')}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Gesperrt bis</p>
                  <p className="font-medium">
                    {job.locked_at ? new Date(job.locked_at).toLocaleString('de-DE') : '-'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payload" className="mt-4">
          <Card className="glass-card border-border/50">
            <CardHeader>
              <CardTitle>Payload</CardTitle>
              <CardDescription>Job-Eingabedaten (JSONB)</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px] w-full rounded-lg border p-4 bg-muted/30">
                <pre className="text-sm font-mono">
                  {JSON.stringify(job.payload, null, 2)}
                </pre>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="result" className="mt-4">
          <Card className="glass-card border-border/50">
            <CardHeader>
              <CardTitle>Result</CardTitle>
              <CardDescription>Job-Ausgabedaten (JSONB)</CardDescription>
            </CardHeader>
            <CardContent>
              {job.result ? (
                <ScrollArea className="h-[400px] w-full rounded-lg border p-4 bg-muted/30">
                  <pre className="text-sm font-mono">
                    {JSON.stringify(job.result, null, 2)}
                  </pre>
                </ScrollArea>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  Kein Ergebnis vorhanden
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
