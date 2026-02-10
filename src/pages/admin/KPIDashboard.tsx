import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  TrendingUp, TrendingDown, Users, BookOpen, DollarSign, Activity,
  RefreshCw, AlertTriangle, CheckCircle, Clock, Target, Zap, Mail,
  UserPlus, GraduationCap, Brain, Shield, BarChart3, Eye, Heart
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

// ---- Metric Card ----
const MetricCard = ({ title, value, icon: Icon, trend, trendValue, subtitle, variant = 'default' }: {
  title: string; value: string | number; icon: React.ElementType;
  trend?: 'up' | 'down' | 'neutral'; trendValue?: string; subtitle?: string;
  variant?: 'default' | 'success' | 'warning' | 'danger';
}) => {
  const styles = { default: '', success: 'border-green-500/30 bg-green-500/5', warning: 'border-yellow-500/30 bg-yellow-500/5', danger: 'border-red-500/30 bg-red-500/5' };
  return (
    <Card className={`glass-card ${styles[variant]}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <div className="text-2xl font-bold">{value}</div>
          {trend && trendValue && (
            <Badge variant={trend === 'up' ? 'default' : 'destructive'} className="text-xs">
              {trend === 'up' ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
              {trendValue}
            </Badge>
          )}
        </div>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </CardContent>
    </Card>
  );
};

// ---- Prüfungsreife Controlling Tab ----
function ReadinessControllingTab() {
  const { data: snapshots, isLoading } = useQuery({
    queryKey: ['controlling-readiness'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('controlling_snapshots')
        .select('*')
        .in('kpi_type', ['readiness_avg', 'critical_learners_pct', 'confidence_avg', 'churn_rate'])
        .order('snapshot_date', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    }
  });

  const { data: alerts } = useQuery({
    queryKey: ['management-alerts-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('management_alerts')
        .select('*')
        .is('resolved_at', null)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    }
  });

  const queryClient = useQueryClient();
  const acknowledgeAlert = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await supabase
        .from('management_alerts')
        .update({ acknowledged_at: new Date().toISOString() })
        .eq('id', alertId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['management-alerts-active'] });
      toast.success('Alert bestätigt');
    }
  });

  const latestByType = (type: string) => snapshots?.find(s => s.kpi_type === type);
  const fmt = (v?: number | null) => v != null ? `${Math.round(Number(v))}%` : '–';

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      {/* Prüfungsreife KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Ø Prüfungsreife" value={fmt(latestByType('readiness_avg')?.kpi_value)} icon={Target}
          variant={Number(latestByType('readiness_avg')?.kpi_value || 0) < 50 ? 'warning' : 'success'} />
        <MetricCard title="Kritische Lerner (<40%)" value={fmt(latestByType('critical_learners_pct')?.kpi_value)} icon={AlertTriangle}
          variant={Number(latestByType('critical_learners_pct')?.kpi_value || 0) > 20 ? 'danger' : 'default'} />
        <MetricCard title="Vertrauens-Score" value={fmt(latestByType('confidence_avg')?.kpi_value)} icon={Heart}
          subtitle="Subjektives Sicherheitsgefühl" />
        <MetricCard title="Churn-Rate" value={fmt(latestByType('churn_rate')?.kpi_value)} icon={TrendingDown}
          variant={Number(latestByType('churn_rate')?.kpi_value || 0) > 10 ? 'danger' : 'default'} />
      </div>

      {/* Management Alerts */}
      {alerts && alerts.length > 0 && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Management Alerts ({alerts.length})
            </CardTitle>
            <CardDescription>Automatische Warnungen – Push statt Pull</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {alerts.map(alert => (
                <div key={alert.id} className={`flex items-start gap-3 p-3 rounded-lg border ${
                  alert.severity === 'critical' ? 'border-red-500/40 bg-red-500/5' :
                  alert.severity === 'warning' ? 'border-yellow-500/40 bg-yellow-500/5' : 'border-border'
                }`}>
                  <Badge variant={alert.severity === 'critical' ? 'destructive' : 'outline'} className="mt-0.5 shrink-0">
                    {alert.severity}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{alert.title}</p>
                    {alert.description && <p className="text-xs text-muted-foreground mt-0.5">{alert.description}</p>}
                  </div>
                  {!alert.acknowledged_at && (
                    <Button size="sm" variant="ghost" onClick={() => acknowledgeAlert.mutate(alert.id)}>
                      <CheckCircle className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---- Content Effectiveness Tab ----
function ContentEffectivenessTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['content-effectiveness'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('content_effectiveness')
        .select('*')
        .order('readiness_impact', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    }
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const classIcon = (c: string) => c === 'high_impact' ? '🔥' : c === 'overkill' ? '❌' : '🟡';

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Content</TableHead>
          <TableHead>Typ</TableHead>
          <TableHead className="text-right">Nutzungen</TableHead>
          <TableHead className="text-right">Ø Min</TableHead>
          <TableHead className="text-right">Prüfungsreife-Impact</TableHead>
          <TableHead className="text-right">Support-Tickets</TableHead>
          <TableHead className="text-right">Abbruch</TableHead>
          <TableHead>Klasse</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data?.map(item => (
          <TableRow key={item.id}>
            <TableCell className="font-medium max-w-[200px] truncate">{item.entity_title || item.entity_id}</TableCell>
            <TableCell><Badge variant="outline">{item.entity_type}</Badge></TableCell>
            <TableCell className="text-right">{item.usage_count}</TableCell>
            <TableCell className="text-right">{Number(item.avg_time_minutes).toFixed(1)}</TableCell>
            <TableCell className="text-right">
              <span className={Number(item.readiness_impact) > 0 ? 'text-green-600' : 'text-red-500'}>
                {Number(item.readiness_impact) > 0 ? '+' : ''}{Number(item.readiness_impact).toFixed(1)}
              </span>
            </TableCell>
            <TableCell className="text-right">{item.support_tickets_generated}</TableCell>
            <TableCell className="text-right">{Number(item.abort_rate).toFixed(0)}%</TableCell>
            <TableCell>{classIcon(item.classification || 'medium')} {item.classification}</TableCell>
          </TableRow>
        ))}
        {(!data || data.length === 0) && (
          <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Noch keine Content-Analysen vorhanden</TableCell></TableRow>
        )}
      </TableBody>
    </Table>
  );
}

// ---- Churn & Retention Tab ----
function ChurnRetentionTab() {
  const { data: predictions, isLoading } = useQuery({
    queryKey: ['churn-predictions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('churn_predictions')
        .select('*')
        .order('risk_score', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    }
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const riskColor = (level: string) => {
    switch (level) {
      case 'critical': return 'destructive';
      case 'high': return 'destructive';
      case 'medium': return 'secondary';
      default: return 'outline';
    }
  };

  const criticalCount = predictions?.filter(p => p.risk_level === 'critical' || p.risk_level === 'high').length || 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard title="Hohe Churn-Risiken" value={criticalCount} icon={AlertTriangle}
          variant={criticalCount > 5 ? 'danger' : 'default'} subtitle="critical + high" />
        <MetricCard title="Gesamt Predictions" value={predictions?.length || 0} icon={Brain} />
        <MetricCard title="Mit Intervention" value={predictions?.filter(p => p.action_taken).length || 0} icon={CheckCircle}
          variant="success" subtitle="Maßnahme ergriffen" />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User ID</TableHead>
            <TableHead>Risiko</TableHead>
            <TableHead>Score</TableHead>
            <TableHead>Signale</TableHead>
            <TableHead>Empfehlung</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {predictions?.map(p => (
            <TableRow key={p.id}>
              <TableCell className="font-mono text-xs">{p.user_id.slice(0, 8)}…</TableCell>
              <TableCell><Badge variant={riskColor(p.risk_level)}>{p.risk_level}</Badge></TableCell>
              <TableCell>{Number(p.risk_score).toFixed(0)}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {(p.signals as string[] || []).slice(0, 3).map((s, i) => (
                    <Badge key={i} variant="outline" className="text-xs">{s}</Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell className="max-w-[200px] truncate text-sm">{p.recommended_action || '–'}</TableCell>
              <TableCell>
                {p.action_taken ? (
                  <Badge variant="default" className="text-xs">✓ {p.action_taken}</Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">offen</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
          {(!predictions || predictions.length === 0) && (
            <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Keine Churn-Predictions vorhanden</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// ---- Classic KPI Tab ----
function ClassicKPITab() {
  const { data: metrics, isLoading } = useQuery({
    queryKey: ['kpi-metrics'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('calculate_daily_kpis');
      if (error) throw error;
      return data as unknown as Record<string, any>;
    },
    refetchInterval: 60000,
  });

  const fmt = (v: number) => new Intl.NumberFormat('de-DE').format(v || 0);
  const fmtCur = (v: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v || 0);

  if (isLoading) return <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-32" />)}</div>;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-4">Nutzer & Engagement</h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard title="Gesamt-Nutzer" value={fmt(metrics?.total_users)} icon={Users} />
          <MetricCard title="Aktiv heute" value={fmt(metrics?.active_learners_today)} icon={Activity} />
          <MetricCard title="Aktiv (7 Tage)" value={fmt(metrics?.active_learners_7d)} icon={Clock} />
          <MetricCard title="Aktiv (30 Tage)" value={fmt(metrics?.active_learners_30d)} icon={Target} />
        </div>
      </div>
      <div>
        <h3 className="text-lg font-semibold mb-4">Lernfortschritt</h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard title="Einschreibungen" value={fmt(metrics?.total_enrollments)} icon={BookOpen} subtitle={`+${metrics?.new_enrollments_today || 0} heute`} />
          <MetricCard title="Abgeschlossene Kurse" value={fmt(metrics?.completed_courses)} icon={GraduationCap} />
          <MetricCard title="Lektionen bearbeitet" value={fmt(metrics?.total_lessons_completed)} icon={CheckCircle} />
          <MetricCard title="Prüfungen absolviert" value={fmt(metrics?.total_exams_taken)} icon={Target} subtitle={`${metrics?.exam_pass_rate || 0}% Bestehensquote`} />
        </div>
      </div>
      <div>
        <h3 className="text-lg font-semibold mb-4">Umsatz</h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard title="Umsatz heute" value={fmtCur(metrics?.revenue_today)} icon={DollarSign} variant={(metrics?.revenue_today || 0) > 0 ? 'success' : 'default'} />
          <MetricCard title="Umsatz (7 Tage)" value={fmtCur(metrics?.revenue_7d)} icon={TrendingUp} />
          <MetricCard title="Umsatz (30 Tage)" value={fmtCur(metrics?.revenue_30d)} icon={TrendingUp} />
          <MetricCard title="Offene Tickets" value={fmt(metrics?.open_tickets)} icon={AlertTriangle} variant={(metrics?.open_tickets || 0) > 10 ? 'warning' : 'default'} />
        </div>
      </div>
    </div>
  );
}

// ---- Main Dashboard ----
export default function KPIDashboard() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const queryClient = useQueryClient();

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['controlling-readiness'] });
    await queryClient.invalidateQueries({ queryKey: ['kpi-metrics'] });
    await queryClient.invalidateQueries({ queryKey: ['content-effectiveness'] });
    await queryClient.invalidateQueries({ queryKey: ['churn-predictions'] });
    await queryClient.invalidateQueries({ queryKey: ['management-alerts-active'] });
    setIsRefreshing(false);
    toast.success('Dashboard aktualisiert');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">Controlling & Intelligence</h1>
          <p className="text-muted-foreground">Prüfungsreife steuern – Risiken antizipieren – Content optimieren</p>
        </div>
        <Button onClick={handleRefresh} disabled={isRefreshing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
          Aktualisieren
        </Button>
      </div>

      <Tabs defaultValue="readiness" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="readiness" className="gap-2"><Target className="h-4 w-4" /> Prüfungsreife</TabsTrigger>
          <TabsTrigger value="content" className="gap-2"><BarChart3 className="h-4 w-4" /> Content-ROI</TabsTrigger>
          <TabsTrigger value="churn" className="gap-2"><Shield className="h-4 w-4" /> Churn & Retention</TabsTrigger>
          <TabsTrigger value="classic" className="gap-2"><Activity className="h-4 w-4" /> Klassisch</TabsTrigger>
        </TabsList>
        <TabsContent value="readiness"><ReadinessControllingTab /></TabsContent>
        <TabsContent value="content"><ContentEffectivenessTab /></TabsContent>
        <TabsContent value="churn"><ChurnRetentionTab /></TabsContent>
        <TabsContent value="classic"><ClassicKPITab /></TabsContent>
      </Tabs>
    </div>
  );
}
