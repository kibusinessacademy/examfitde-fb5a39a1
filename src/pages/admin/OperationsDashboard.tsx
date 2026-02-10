import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Activity, AlertTriangle, CheckCircle, XCircle, RefreshCw, Clock,
  PlayCircle, Pause, Zap, DollarSign, TrendingUp, RotateCcw
} from 'lucide-react';
import { toast } from 'sonner';
import { format, formatDistanceToNow } from 'date-fns';
import { de } from 'date-fns/locale';

interface JobRow {
  id: string;
  job_type: string;
  status: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  error: string | null;
  last_error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  locked_by: string | null;
  locked_at: string | null;
  priority: number;
}

interface CostRow {
  job_type: string;
  cost_eur: number;
  tokens_used: number;
  runs: number;
  errors: number;
  date: string;
}

export default function OperationsDashboard() {
  const queryClient = useQueryClient();
  const [isRecovering, setIsRecovering] = useState(false);

  // Job summary stats
  const { data: jobStats, isLoading: statsLoading } = useQuery({
    queryKey: ['ops-job-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_queue')
        .select('status, created_at, completed_at, started_at, job_type');
      if (error) throw error;

      const now = Date.now();
      const oneHour = 60 * 60 * 1000;
      const oneDay = 24 * oneHour;

      const stats = {
        pending: 0, processing: 0, completed: 0, failed: 0, cancelled: 0,
        lastHour: 0, last24h: 0, avgDurationSec: 0,
      };

      let totalDuration = 0;
      let durationCount = 0;

      for (const j of data || []) {
        stats[j.status as keyof typeof stats] = (stats[j.status as keyof typeof stats] as number || 0) + 1;
        const created = new Date(j.created_at).getTime();
        if (now - created < oneHour) stats.lastHour++;
        if (now - created < oneDay) stats.last24h++;
        if (j.completed_at && j.started_at) {
          totalDuration += new Date(j.completed_at).getTime() - new Date(j.started_at).getTime();
          durationCount++;
        }
      }
      stats.avgDurationSec = durationCount > 0 ? Math.round(totalDuration / durationCount / 1000) : 0;
      return stats;
    },
    refetchInterval: 15000,
  });

  // Active/stuck jobs
  const { data: activeJobs, isLoading: activeLoading } = useQuery({
    queryKey: ['ops-active-jobs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_queue')
        .select('*')
        .in('status', ['processing', 'pending'])
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as unknown as JobRow[];
    },
    refetchInterval: 10000,
  });

  // Recent failures
  const { data: failedJobs } = useQuery({
    queryKey: ['ops-failed-jobs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_queue')
        .select('*')
        .eq('status', 'failed')
        .order('completed_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as unknown as JobRow[];
    },
    refetchInterval: 30000,
  });

  // Cost data (last 7 days)
  const { data: costData } = useQuery({
    queryKey: ['ops-costs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_worker_usage_daily')
        .select('job_type, cost_eur, tokens_used, runs, errors, date')
        .gte('date', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
        .order('date', { ascending: false });
      if (error) throw error;
      return data as CostRow[];
    },
  });

  // Recovery action
  const runRecovery = async () => {
    setIsRecovering(true);
    try {
      const { data, error } = await supabase.rpc('job_recovery_worker');
      if (error) throw error;
      const result = data as { recovered?: number; abandoned?: number } | null;
      toast.success(`Recovery: ${result?.recovered || 0} wiederhergestellt, ${result?.abandoned || 0} aufgegeben`);
      queryClient.invalidateQueries({ queryKey: ['ops-active-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['ops-job-stats'] });
    } catch {
      toast.error('Recovery fehlgeschlagen');
    } finally {
      setIsRecovering(false);
    }
  };

  const totalCost7d = costData?.reduce((s, c) => s + (c.cost_eur || 0), 0) || 0;
  const totalTokens7d = costData?.reduce((s, c) => s + (c.tokens_used || 0), 0) || 0;

  const stuckJobs = activeJobs?.filter(j => {
    if (j.status !== 'processing' || !j.locked_at) return false;
    return Date.now() - new Date(j.locked_at).getTime() > 5 * 60 * 1000;
  }) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Operations Center</h1>
          <p className="text-muted-foreground">Was läuft? Was hängt? Was kostet?</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={runRecovery} disabled={isRecovering}>
            <RotateCcw className={`h-4 w-4 mr-2 ${isRecovering ? 'animate-spin' : ''}`} />
            Recovery Worker
          </Button>
          <Button variant="outline" onClick={() => queryClient.invalidateQueries()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Aktualisieren
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      {statsLoading ? <Skeleton className="h-32 w-full" /> : (
        <div className="grid gap-4 md:grid-cols-6">
          <Card className="border-yellow-500/30 bg-yellow-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                <Clock className="h-4 w-4" /> Wartend
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{jobStats?.pending || 0}</div>
            </CardContent>
          </Card>
          <Card className="border-blue-500/30 bg-blue-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                <PlayCircle className="h-4 w-4" /> Aktiv
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{jobStats?.processing || 0}</div>
            </CardContent>
          </Card>
          <Card className="border-green-500/30 bg-green-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                <CheckCircle className="h-4 w-4" /> Erledigt
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{jobStats?.completed || 0}</div>
            </CardContent>
          </Card>
          <Card className="border-red-500/30 bg-red-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                <XCircle className="h-4 w-4" /> Fehlgeschlagen
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{jobStats?.failed || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                <Zap className="h-4 w-4" /> Ø Dauer
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{jobStats?.avgDurationSec || 0}s</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                <DollarSign className="h-4 w-4" /> 7d Kosten
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalCost7d.toFixed(2)}€</div>
              <div className="text-xs text-muted-foreground">{(totalTokens7d / 1000).toFixed(0)}k Tokens</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Stuck Jobs Alert */}
      {stuckJobs.length > 0 && (
        <Card className="border-red-500 bg-red-500/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-red-500 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              {stuckJobs.length} hängende Jobs erkannt
            </CardTitle>
            <CardDescription>
              Diese Jobs sind seit über 5 Minuten gesperrt. Recovery Worker kann sie freigeben.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {stuckJobs.map(j => (
                <Badge key={j.id} variant="destructive">
                  {j.job_type} – seit {formatDistanceToNow(new Date(j.locked_at!), { locale: de })}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active Jobs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" /> Aktive & wartende Jobs
          </CardTitle>
          <CardDescription>Echtzeit-Übersicht aller laufenden Prozesse</CardDescription>
        </CardHeader>
        <CardContent>
          {activeLoading ? <Skeleton className="h-32" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Typ</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Versuche</TableHead>
                  <TableHead>Priorität</TableHead>
                  <TableHead>Erstellt</TableHead>
                  <TableHead>Laufzeit</TableHead>
                  <TableHead>Fehler</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeJobs?.map(job => {
                  const runtime = job.started_at
                    ? formatDistanceToNow(new Date(job.started_at), { locale: de })
                    : '-';
                  return (
                    <TableRow key={job.id} className={stuckJobs.some(s => s.id === job.id) ? 'bg-red-500/10' : ''}>
                      <TableCell className="font-mono text-sm">{job.job_type}</TableCell>
                      <TableCell>
                        <Badge variant={job.status === 'processing' ? 'default' : 'secondary'}>
                          {job.status === 'processing' ? '🔄' : '⏳'} {job.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{job.attempts}/{job.max_attempts}</TableCell>
                      <TableCell>
                        <Badge variant="outline">P{job.priority}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {format(new Date(job.created_at), 'dd.MM. HH:mm', { locale: de })}
                      </TableCell>
                      <TableCell className="text-sm">{runtime}</TableCell>
                      <TableCell className="text-sm text-red-500 max-w-[200px] truncate">
                        {job.last_error || '-'}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(!activeJobs || activeJobs.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
                      Keine aktiven Jobs – System idle
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Recent Failures */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-red-500" /> Letzte Fehler
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Typ</TableHead>
                <TableHead>Versuche</TableHead>
                <TableHead>Fehler</TableHead>
                <TableHead>Zeitpunkt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failedJobs?.slice(0, 10).map(job => (
                <TableRow key={job.id}>
                  <TableCell className="font-mono text-sm">{job.job_type}</TableCell>
                  <TableCell>{job.attempts}/{job.max_attempts}</TableCell>
                  <TableCell className="text-sm text-red-500 max-w-[300px] truncate">
                    {job.error || job.last_error || 'Unbekannt'}
                  </TableCell>
                  <TableCell className="text-sm">
                    {job.completed_at ? format(new Date(job.completed_at), 'dd.MM. HH:mm', { locale: de }) : '-'}
                  </TableCell>
                </TableRow>
              ))}
              {(!failedJobs || failedJobs.length === 0) && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                    Keine Fehler – alles grün ✅
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Cost Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" /> Kostenübersicht (7 Tage)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job-Typ</TableHead>
                <TableHead>Runs</TableHead>
                <TableHead>Fehler</TableHead>
                <TableHead>Tokens</TableHead>
                <TableHead>Kosten</TableHead>
                <TableHead>Fehlerrate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(() => {
                const grouped = (costData || []).reduce((acc, c) => {
                  if (!acc[c.job_type]) acc[c.job_type] = { runs: 0, errors: 0, tokens: 0, cost: 0 };
                  acc[c.job_type].runs += c.runs;
                  acc[c.job_type].errors += c.errors;
                  acc[c.job_type].tokens += c.tokens_used;
                  acc[c.job_type].cost += c.cost_eur;
                  return acc;
                }, {} as Record<string, { runs: number; errors: number; tokens: number; cost: number }>);

                return Object.entries(grouped)
                  .sort((a, b) => b[1].cost - a[1].cost)
                  .map(([type, stats]) => {
                    const errorRate = stats.runs > 0 ? (stats.errors / stats.runs) * 100 : 0;
                    return (
                      <TableRow key={type}>
                        <TableCell className="font-mono text-sm">{type}</TableCell>
                        <TableCell>{stats.runs}</TableCell>
                        <TableCell className={stats.errors > 0 ? 'text-red-500' : ''}>{stats.errors}</TableCell>
                        <TableCell>{(stats.tokens / 1000).toFixed(1)}k</TableCell>
                        <TableCell className="font-medium">{stats.cost.toFixed(2)}€</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={Math.min(errorRate, 100)} className="w-16 h-2" />
                            <span className={`text-xs ${errorRate > 20 ? 'text-red-500' : ''}`}>
                              {errorRate.toFixed(0)}%
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  });
              })()}
              {(!costData || costData.length === 0) && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                    Keine Kostendaten vorhanden
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
