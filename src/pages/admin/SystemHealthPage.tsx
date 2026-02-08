import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { 
  Activity, 
  AlertTriangle,
  CheckCircle,
  XCircle,
  RefreshCw,
  Shield,
  Zap,
  Database,
  Server,
  Clock,
  Play,
  Pause,
  RotateCcw,
  Download,
  HardDrive,
  Cpu,
  Wifi
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

// Health Overview Tab
function HealthOverviewTab() {
  const [isRunningCheck, setIsRunningCheck] = useState(false);
  const queryClient = useQueryClient();

  const { data: healthChecks, isLoading } = useQuery({
    queryKey: ['health-checks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_health_checks')
        .select('*')
        .order('checked_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    }
  });

  const runHealthCheck = async () => {
    setIsRunningCheck(true);
    try {
      const { data, error } = await supabase.rpc('run_health_checks');
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['health-checks'] });
      toast.success('Health-Check abgeschlossen');
    } catch (error) {
      toast.error('Fehler beim Health-Check');
    } finally {
      setIsRunningCheck(false);
    }
  };

  // Get latest status per check type
  const latestByType = healthChecks?.reduce((acc, check) => {
    if (!acc[check.check_type] || new Date(check.checked_at) > new Date(acc[check.check_type].checked_at)) {
      acc[check.check_type] = check;
    }
    return acc;
  }, {} as Record<string, typeof healthChecks[0]>);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy': return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'degraded': return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'unhealthy': return <XCircle className="h-5 w-5 text-red-500" />;
      default: return <Activity className="h-5 w-5 text-gray-500" />;
    }
  };

  const getServiceIcon = (type: string) => {
    switch (type) {
      case 'database': return <Database className="h-5 w-5" />;
      case 'edge_function': return <Zap className="h-5 w-5" />;
      case 'storage': return <HardDrive className="h-5 w-5" />;
      case 'auth': return <Shield className="h-5 w-5" />;
      case 'realtime': return <Wifi className="h-5 w-5" />;
      default: return <Server className="h-5 w-5" />;
    }
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const healthyCount = Object.values(latestByType || {}).filter(c => c.status === 'healthy').length;
  const totalChecks = Object.keys(latestByType || {}).length;
  const healthPercentage = totalChecks > 0 ? (healthyCount / totalChecks) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Overall Health */}
      <Card className="glass-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>System-Gesundheit</CardTitle>
            <CardDescription>Übersicht aller Services und Komponenten</CardDescription>
          </div>
          <Button onClick={runHealthCheck} disabled={isRunningCheck}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isRunningCheck ? 'animate-spin' : ''}`} />
            Health-Check
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Progress value={healthPercentage} className="h-3" />
              </div>
              <span className="text-lg font-bold">{healthyCount}/{totalChecks}</span>
            </div>
            
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Object.entries(latestByType || {}).map(([type, check]) => (
                <Card key={type} className={`glass-card ${
                  check.status === 'healthy' ? 'border-green-500/30' :
                  check.status === 'degraded' ? 'border-yellow-500/30' :
                  'border-red-500/30'
                }`}>
                  <CardContent className="flex items-center gap-4 py-4">
                    {getServiceIcon(type)}
                    <div className="flex-1">
                      <div className="font-medium capitalize">{type.replace('_', ' ')}</div>
                      <div className="text-sm text-muted-foreground">
                        {check.response_time_ms}ms
                      </div>
                    </div>
                    {getStatusIcon(check.status)}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recent Checks History */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Check-Verlauf</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Check</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Antwortzeit</TableHead>
                <TableHead>Zeitpunkt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {healthChecks?.slice(0, 20).map((check) => (
                <TableRow key={check.id}>
                  <TableCell className="capitalize">{check.check_type.replace('_', ' ')}</TableCell>
                  <TableCell>{check.check_name}</TableCell>
                  <TableCell>
                    <Badge variant={
                      check.status === 'healthy' ? 'default' :
                      check.status === 'degraded' ? 'secondary' : 'destructive'
                    }>
                      {check.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{check.response_time_ms || '-'}ms</TableCell>
                  <TableCell>
                    {format(new Date(check.checked_at), 'dd.MM.yyyy HH:mm:ss', { locale: de })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// Alerts Tab
function AlertsTab() {
  const queryClient = useQueryClient();

  const { data: alerts, isLoading } = useQuery({
    queryKey: ['system-alerts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    }
  });

  const acknowledgeAlert = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await supabase
        .from('system_alerts')
        .update({ 
          is_acknowledged: true, 
          acknowledged_at: new Date().toISOString() 
        })
        .eq('id', alertId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-alerts'] });
      toast.success('Alert bestätigt');
    }
  });

  const attemptAutoRecovery = useMutation({
    mutationFn: async (alertId: string) => {
      const { data, error } = await supabase.rpc('attempt_auto_recovery', { p_alert_id: alertId });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['system-alerts'] });
      if ((data as { success?: boolean })?.success) {
        toast.success('Auto-Recovery erfolgreich');
      } else {
        toast.error('Auto-Recovery fehlgeschlagen');
      }
    }
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const unacknowledged = alerts?.filter(a => !a.is_acknowledged && !a.resolved_at) || [];
  const critical = alerts?.filter(a => a.alert_type === 'critical' && !a.resolved_at) || [];

  return (
    <div className="space-y-6">
      {/* Alert Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="glass-card border-red-500/30 bg-red-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Kritisch</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-500">{critical.length}</div>
          </CardContent>
        </Card>
        <Card className="glass-card border-orange-500/30 bg-orange-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Unbestätigt</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-500">{unacknowledged.length}</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Auto-Resolved</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {alerts?.filter(a => a.auto_resolved).length || 0}
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Gesamt (24h)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{alerts?.length || 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* Alerts List */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>System-Alerts</CardTitle>
          <CardDescription>Fehler, Warnungen und Benachrichtigungen</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Typ</TableHead>
                <TableHead>Quelle</TableHead>
                <TableHead>Nachricht</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Zeitpunkt</TableHead>
                <TableHead className="text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {alerts?.map((alert) => (
                <TableRow key={alert.id} className={!alert.is_acknowledged && !alert.resolved_at ? 'bg-muted/20' : ''}>
                  <TableCell>
                    <Badge variant={
                      alert.alert_type === 'critical' ? 'destructive' :
                      alert.alert_type === 'error' ? 'destructive' :
                      alert.alert_type === 'warning' ? 'secondary' : 'outline'
                    }>
                      {alert.alert_type}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{alert.source}</TableCell>
                  <TableCell className="max-w-xs truncate">{alert.title}</TableCell>
                  <TableCell>
                    {alert.resolved_at ? (
                      <Badge variant="default" className="bg-green-500">Gelöst</Badge>
                    ) : alert.is_acknowledged ? (
                      <Badge variant="secondary">Bestätigt</Badge>
                    ) : (
                      <Badge variant="outline">Neu</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {format(new Date(alert.created_at), 'dd.MM. HH:mm', { locale: de })}
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    {!alert.is_acknowledged && !alert.resolved_at && (
                      <>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => acknowledgeAlert.mutate(alert.id)}
                        >
                          <CheckCircle className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => attemptAutoRecovery.mutate(alert.id)}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {alerts?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Keine Alerts vorhanden
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

// Error Patterns & Auto-Recovery Tab
function AutoRecoveryTab() {
  const queryClient = useQueryClient();

  const { data: patterns, isLoading } = useQuery({
    queryKey: ['error-patterns'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('error_patterns')
        .select('*')
        .order('occurrences', { ascending: false });
      if (error) throw error;
      return data;
    }
  });

  const toggleAutoFix = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from('error_patterns')
        .update({ auto_fix_enabled: enabled })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['error-patterns'] });
      toast.success('Auto-Fix Status aktualisiert');
    }
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Erkannte Fehlermuster</CardTitle>
          <CardDescription>
            Automatische Erkennung und Behebung wiederkehrender Fehler
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fehlermuster</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead>Vorkommen</TableHead>
                <TableHead>Auto-Fix</TableHead>
                <TableHead>Erfolgsrate</TableHead>
                <TableHead>Zuletzt gesehen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {patterns?.map((pattern) => {
                const totalFixes = pattern.fix_success_count + pattern.fix_failure_count;
                const successRate = totalFixes > 0 
                  ? Math.round((pattern.fix_success_count / totalFixes) * 100) 
                  : 0;
                  
                return (
                  <TableRow key={pattern.id}>
                    <TableCell className="font-mono text-sm max-w-xs truncate">
                      {pattern.pattern_signature}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{pattern.error_type}</Badge>
                    </TableCell>
                    <TableCell>{pattern.occurrences}</TableCell>
                    <TableCell>
                      <Switch
                        checked={pattern.auto_fix_enabled}
                        onCheckedChange={(checked) => 
                          toggleAutoFix.mutate({ id: pattern.id, enabled: checked })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      {totalFixes > 0 ? (
                        <div className="flex items-center gap-2">
                          <Progress value={successRate} className="w-16 h-2" />
                          <span className="text-sm">{successRate}%</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {format(new Date(pattern.last_seen_at), 'dd.MM. HH:mm', { locale: de })}
                    </TableCell>
                  </TableRow>
                );
              })}
              {patterns?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Noch keine Fehlermuster erkannt
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

// Backups Tab
function BackupsTab() {
  const { data: backups, isLoading } = useQuery({
    queryKey: ['system-backups'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_backups')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    }
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const formatBytes = (bytes: number) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold">Datensicherungen</h3>
          <p className="text-muted-foreground">Automatische und manuelle Backups</p>
        </div>
        <Button>
          <Download className="h-4 w-4 mr-2" /> Backup erstellen
        </Button>
      </div>

      <Card className="glass-card">
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Typ</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Größe</TableHead>
                <TableHead>Tabellen</TableHead>
                <TableHead>Erstellt</TableHead>
                <TableHead>Gültig bis</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {backups?.map((backup) => (
                <TableRow key={backup.id}>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {backup.backup_type.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={
                      backup.status === 'completed' ? 'default' :
                      backup.status === 'in_progress' ? 'secondary' :
                      backup.status === 'failed' ? 'destructive' : 'outline'
                    }>
                      {backup.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatBytes(backup.size_bytes || 0)}</TableCell>
                  <TableCell>{backup.tables_included?.length || 0} Tabellen</TableCell>
                  <TableCell>
                    {format(new Date(backup.created_at), 'dd.MM.yyyy HH:mm', { locale: de })}
                  </TableCell>
                  <TableCell>
                    {backup.expires_at 
                      ? format(new Date(backup.expires_at), 'dd.MM.yyyy', { locale: de })
                      : 'Unbegrenzt'}
                  </TableCell>
                </TableRow>
              ))}
              {backups?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Keine Backups vorhanden
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

export default function SystemHealthPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold">System Health & Self-Healing</h1>
        <p className="text-muted-foreground">Monitoring, Alerts, Auto-Recovery und Backups</p>
      </div>

      <Tabs defaultValue="health" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="health" className="gap-2">
            <Activity className="h-4 w-4" /> Health
          </TabsTrigger>
          <TabsTrigger value="alerts" className="gap-2">
            <AlertTriangle className="h-4 w-4" /> Alerts
          </TabsTrigger>
          <TabsTrigger value="recovery" className="gap-2">
            <RotateCcw className="h-4 w-4" /> Auto-Recovery
          </TabsTrigger>
          <TabsTrigger value="backups" className="gap-2">
            <HardDrive className="h-4 w-4" /> Backups
          </TabsTrigger>
        </TabsList>

        <TabsContent value="health">
          <HealthOverviewTab />
        </TabsContent>
        <TabsContent value="alerts">
          <AlertsTab />
        </TabsContent>
        <TabsContent value="recovery">
          <AutoRecoveryTab />
        </TabsContent>
        <TabsContent value="backups">
          <BackupsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
