import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { 
  Activity, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  RefreshCw,
  XCircle,
  ArrowRight,
  Loader2,
  Inbox
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

interface JobHealthKPI {
  job_type: string;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  cancelled: number;
  total: number;
  last_update: string;
}

type HealthStatus = 'ok' | 'warning' | 'critical';

function getHealthStatus(kpi: JobHealthKPI): HealthStatus {
  if (kpi.failed > 0) return 'critical';
  if (kpi.processing === 0 && kpi.pending > 0) return 'warning';
  return 'ok';
}

function getStatusColor(status: HealthStatus) {
  switch (status) {
    case 'ok': return 'bg-success text-success-foreground';
    case 'warning': return 'bg-warning text-warning-foreground';
    case 'critical': return 'bg-destructive text-destructive-foreground';
  }
}

function getStatusIcon(status: HealthStatus) {
  switch (status) {
    case 'ok': return <CheckCircle2 className="h-5 w-5" />;
    case 'warning': return <Clock className="h-5 w-5" />;
    case 'critical': return <AlertCircle className="h-5 w-5" />;
  }
}

export default function JobsDashboard() {
  const [kpis, setKpis] = useState<JobHealthKPI[]>([]);
  const [loading, setLoading] = useState(true);
  const [requeuing, setRequeuing] = useState(false);
  const [maintenanceRunning, setMaintenanceRunning] = useState(false);
  const [deadLetterCount, setDeadLetterCount] = useState(0);

  const fetchData = async () => {
    try {
      // Fetch Health KPIs
      const { data: kpiData, error: kpiError } = await supabase
        .from('job_health_kpis')
        .select('*');

      if (kpiError) throw kpiError;
      setKpis(kpiData || []);

      // Fetch Dead Letter Count
      const { count, error: dlError } = await supabase
        .from('job_deadletter')
        .select('*', { count: 'exact', head: true });

      if (dlError) throw dlError;
      setDeadLetterCount(count || 0);
    } catch (error) {
      console.error('Error fetching job data:', error);
      toast.error('Fehler beim Laden der Job-Daten');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRequeueTechnical = async () => {
    setRequeuing(true);
    try {
      const { data, error } = await supabase.rpc('requeue_failed_jobs');
      if (error) throw error;
      toast.success(`${data} Jobs wurden erneut eingereiht`);
      fetchData();
    } catch (error) {
      console.error('Requeue error:', error);
      toast.error('Fehler beim Requeue');
    } finally {
      setRequeuing(false);
    }
  };

  const handleMaintenance = async () => {
    setMaintenanceRunning(true);
    try {
      const { data, error } = await supabase.rpc('job_maintenance');
      if (error) throw error;
      const result = data as { stale_locks_cleaned: number; jobs_requeued: number };
      toast.success(
        `Wartung abgeschlossen: ${result.stale_locks_cleaned} Locks bereinigt, ${result.jobs_requeued} Jobs neu eingereiht`
      );
      fetchData();
    } catch (error) {
      console.error('Maintenance error:', error);
      toast.error('Fehler bei der Wartung');
    } finally {
      setMaintenanceRunning(false);
    }
  };

  const totalStats = kpis.reduce(
    (acc, kpi) => ({
      pending: acc.pending + Number(kpi.pending),
      processing: acc.processing + Number(kpi.processing),
      completed: acc.completed + Number(kpi.completed),
      failed: acc.failed + Number(kpi.failed),
    }),
    { pending: 0, processing: 0, completed: 0, failed: 0 }
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Job Control Center</h1>
          <p className="text-muted-foreground mt-1">Überwachung und Steuerung aller Hintergrund-Jobs</p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            onClick={fetchData}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Aktualisieren
          </Button>
          <Button 
            variant="outline"
            onClick={handleMaintenance}
            disabled={maintenanceRunning}
          >
            {maintenanceRunning ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Activity className="h-4 w-4 mr-2" />
            )}
            Wartung
          </Button>
        </div>
      </div>

      {/* Global Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="glass-card border-border/50">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-warning/20">
              <Clock className="h-5 w-5 text-warning" />
            </div>
            <div>
              <p className="text-2xl font-bold">{loading ? '...' : totalStats.pending}</p>
              <p className="text-sm text-muted-foreground">Pending</p>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-border/50">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-primary/20">
              <Activity className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{loading ? '...' : totalStats.processing}</p>
              <p className="text-sm text-muted-foreground">Processing</p>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-border/50">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-success/20">
              <CheckCircle2 className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-2xl font-bold">{loading ? '...' : totalStats.completed}</p>
              <p className="text-sm text-muted-foreground">Completed</p>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-border/50">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-destructive/20">
              <XCircle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="text-2xl font-bold">{loading ? '...' : totalStats.failed}</p>
              <p className="text-sm text-muted-foreground">Failed</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Dead Letter Inbox Alert */}
      {deadLetterCount > 0 && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-destructive/20">
                <Inbox className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="font-semibold text-destructive">
                  {deadLetterCount} Job(s) im Dead-Letter-Postfach
                </p>
                <p className="text-sm text-muted-foreground">
                  Fehlgeschlagene Jobs erfordern Aufmerksamkeit
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRequeueTechnical}
                disabled={requeuing}
              >
                {requeuing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Technische Retry
              </Button>
              <Link to="/admin-v2/jobs/deadletter">
                <Button size="sm" variant="destructive">
                  <Inbox className="h-4 w-4 mr-2" />
                  Anzeigen
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Job Types Health */}
      <Card className="glass-card border-border/50">
        <CardHeader>
          <CardTitle>Job-Typen Gesundheit</CardTitle>
          <CardDescription>Status pro Job-Typ mit Ampellogik</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : kpis.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Keine Jobs vorhanden
            </div>
          ) : (
            <div className="space-y-3">
              {kpis.map((kpi) => {
                const status = getHealthStatus(kpi);
                return (
                  <div
                    key={kpi.job_type}
                    className="flex items-center justify-between p-4 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-lg ${getStatusColor(status)}`}>
                        {getStatusIcon(status)}
                      </div>
                      <div>
                        <p className="font-medium">{kpi.job_type}</p>
                        <p className="text-sm text-muted-foreground">
                          Letztes Update: {kpi.last_update ? new Date(kpi.last_update).toLocaleString('de-DE') : 'N/A'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="flex gap-2">
                        <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">
                          {kpi.pending} pending
                        </Badge>
                        <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                          {kpi.processing} processing
                        </Badge>
                        <Badge variant="outline" className="bg-success/10 text-success border-success/30">
                          {kpi.completed} done
                        </Badge>
                        {Number(kpi.failed) > 0 && (
                          <Badge variant="destructive">
                            {kpi.failed} failed
                          </Badge>
                        )}
                      </div>
                      <Link to={`/admin-v2/jobs?type=${kpi.job_type}`}>
                        <Button variant="ghost" size="sm">
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Links */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link to="/admin-v2/jobs">
          <Card className="glass-card border-border/50 hover:border-primary/50 transition-colors cursor-pointer">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="p-3 rounded-xl gradient-primary">
                <Activity className="h-6 w-6 text-primary-foreground" />
              </div>
              <div>
                <p className="font-semibold">Alle Jobs</p>
                <p className="text-sm text-muted-foreground">Job-Liste mit Filtern</p>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link to="/admin-v2/jobs/deadletter">
          <Card className="glass-card border-border/50 hover:border-destructive/50 transition-colors cursor-pointer">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="p-3 rounded-xl bg-destructive">
                <Inbox className="h-6 w-6 text-destructive-foreground" />
              </div>
              <div>
                <p className="font-semibold">Dead-Letter Inbox</p>
                <p className="text-sm text-muted-foreground">{deadLetterCount} fehlgeschlagene Jobs</p>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link to="/admin-v2/jobs/analysis">
          <Card className="glass-card border-border/50 hover:border-accent/50 transition-colors cursor-pointer">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="p-3 rounded-xl gradient-accent">
                <AlertCircle className="h-6 w-6 text-accent-foreground" />
              </div>
              <div>
                <p className="font-semibold">Fehler-Analyse</p>
                <p className="text-sm text-muted-foreground">Gruppiert nach Ursache</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
