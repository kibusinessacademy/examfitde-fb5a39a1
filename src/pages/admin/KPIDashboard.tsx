import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  TrendingUp, 
  TrendingDown, 
  Users, 
  BookOpen, 
  DollarSign, 
  Activity,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Clock,
  Target,
  Zap,
  Mail,
  UserPlus,
  GraduationCap
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

interface KPIMetrics {
  total_users: number;
  active_learners_today: number;
  active_learners_7d: number;
  active_learners_30d: number;
  total_enrollments: number;
  new_enrollments_today: number;
  completed_courses: number;
  total_lessons_completed: number;
  total_exams_taken: number;
  exam_pass_rate: number;
  revenue_today: number;
  revenue_7d: number;
  revenue_30d: number;
  open_tickets: number;
  active_promo_codes: number;
  active_affiliates: number;
  pending_affiliate_payouts: number;
  newsletter_subscribers: number;
  jobs_pending: number;
  jobs_failed_24h: number;
  system_health: Record<string, string>;
  unacknowledged_alerts: number;
  snapshot_timestamp: string;
}

const MetricCard = ({ 
  title, 
  value, 
  icon: Icon, 
  trend, 
  trendValue,
  subtitle,
  variant = 'default'
}: { 
  title: string; 
  value: string | number; 
  icon: React.ElementType;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  subtitle?: string;
  variant?: 'default' | 'success' | 'warning' | 'danger';
}) => {
  const variantStyles = {
    default: 'border-border',
    success: 'border-green-500/30 bg-green-500/5',
    warning: 'border-yellow-500/30 bg-yellow-500/5',
    danger: 'border-red-500/30 bg-red-500/5'
  };

  return (
    <Card className={`glass-card ${variantStyles[variant]}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <div className="text-2xl font-bold">{value}</div>
          {trend && trendValue && (
            <Badge variant={trend === 'up' ? 'default' : trend === 'down' ? 'destructive' : 'secondary'} className="text-xs">
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

const SystemHealthIndicator = ({ health }: { health: Record<string, string> }) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'bg-green-500';
      case 'degraded': return 'bg-yellow-500';
      case 'unhealthy': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const entries = Object.entries(health || {});
  
  if (entries.length === 0) {
    return <span className="text-muted-foreground text-sm">Keine Daten</span>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {entries.map(([key, status]) => (
        <Badge key={key} variant="outline" className="gap-1">
          <span className={`h-2 w-2 rounded-full ${getStatusColor(status)}`} />
          {key}
        </Badge>
      ))}
    </div>
  );
};

export default function KPIDashboard() {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: metrics, isLoading, refetch } = useQuery({
    queryKey: ['kpi-metrics'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('calculate_daily_kpis');
      if (error) throw error;
      return data as unknown as KPIMetrics;
    },
    refetchInterval: 60000, // Refresh every minute
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
      toast.success('KPIs aktualisiert');
    } catch (error) {
      toast.error('Fehler beim Aktualisieren');
    } finally {
      setIsRefreshing(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('de-DE', { 
      style: 'currency', 
      currency: 'EUR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value || 0);
  };

  const formatNumber = (value: number) => {
    return new Intl.NumberFormat('de-DE').format(value || 0);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">KPI Dashboard</h1>
          <p className="text-muted-foreground">
            Letzte Aktualisierung: {metrics?.snapshot_timestamp 
              ? new Date(metrics.snapshot_timestamp).toLocaleString('de-DE')
              : 'Nie'}
          </p>
        </div>
        <Button onClick={handleRefresh} disabled={isRefreshing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
          Aktualisieren
        </Button>
      </div>

      {/* Alerts Banner */}
      {(metrics?.unacknowledged_alerts || 0) > 0 && (
        <Card className="border-red-500/50 bg-red-500/10">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            <span className="font-medium">
              {metrics?.unacknowledged_alerts} unbestätigte System-Alerts
            </span>
            <Button variant="outline" size="sm" className="ml-auto">
              Alerts anzeigen
            </Button>
          </CardContent>
        </Card>
      )}

      {/* User & Engagement Metrics */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Nutzer & Engagement</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard 
            title="Gesamt-Nutzer" 
            value={formatNumber(metrics?.total_users || 0)}
            icon={Users}
            subtitle="Registrierte Accounts"
          />
          <MetricCard 
            title="Aktiv heute" 
            value={formatNumber(metrics?.active_learners_today || 0)}
            icon={Activity}
            subtitle="Lerner mit Aktivität"
          />
          <MetricCard 
            title="Aktiv (7 Tage)" 
            value={formatNumber(metrics?.active_learners_7d || 0)}
            icon={Clock}
          />
          <MetricCard 
            title="Aktiv (30 Tage)" 
            value={formatNumber(metrics?.active_learners_30d || 0)}
            icon={Target}
          />
        </div>
      </div>

      {/* Learning Metrics */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Lernfortschritt</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard 
            title="Kurs-Einschreibungen" 
            value={formatNumber(metrics?.total_enrollments || 0)}
            icon={BookOpen}
            subtitle={`+${metrics?.new_enrollments_today || 0} heute`}
          />
          <MetricCard 
            title="Abgeschlossene Kurse" 
            value={formatNumber(metrics?.completed_courses || 0)}
            icon={GraduationCap}
          />
          <MetricCard 
            title="Lektionen bearbeitet" 
            value={formatNumber(metrics?.total_lessons_completed || 0)}
            icon={CheckCircle}
          />
          <MetricCard 
            title="Prüfungen absolviert" 
            value={formatNumber(metrics?.total_exams_taken || 0)}
            icon={Target}
            subtitle={`${metrics?.exam_pass_rate || 0}% Bestehensquote`}
          />
        </div>
      </div>

      {/* Revenue Metrics */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Umsatz</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard 
            title="Umsatz heute" 
            value={formatCurrency(metrics?.revenue_today || 0)}
            icon={DollarSign}
            variant={(metrics?.revenue_today || 0) > 0 ? 'success' : 'default'}
          />
          <MetricCard 
            title="Umsatz (7 Tage)" 
            value={formatCurrency(metrics?.revenue_7d || 0)}
            icon={TrendingUp}
          />
          <MetricCard 
            title="Umsatz (30 Tage)" 
            value={formatCurrency(metrics?.revenue_30d || 0)}
            icon={TrendingUp}
          />
          <MetricCard 
            title="Affiliate Auszahlungen" 
            value={formatCurrency(metrics?.pending_affiliate_payouts || 0)}
            icon={UserPlus}
            subtitle={`${metrics?.active_affiliates || 0} aktive Partner`}
            variant={(metrics?.pending_affiliate_payouts || 0) > 100 ? 'warning' : 'default'}
          />
        </div>
      </div>

      {/* Marketing & Support Metrics */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Marketing & Support</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard 
            title="Newsletter Abonnenten" 
            value={formatNumber(metrics?.newsletter_subscribers || 0)}
            icon={Mail}
          />
          <MetricCard 
            title="Aktive Promo-Codes" 
            value={formatNumber(metrics?.active_promo_codes || 0)}
            icon={Zap}
          />
          <MetricCard 
            title="Offene Tickets" 
            value={formatNumber(metrics?.open_tickets || 0)}
            icon={AlertTriangle}
            variant={(metrics?.open_tickets || 0) > 10 ? 'warning' : 'default'}
          />
          <MetricCard 
            title="Aktive Affiliates" 
            value={formatNumber(metrics?.active_affiliates || 0)}
            icon={UserPlus}
          />
        </div>
      </div>

      {/* System Health */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Systemstatus</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-sm">System Health</CardTitle>
            </CardHeader>
            <CardContent>
              <SystemHealthIndicator health={metrics?.system_health || {}} />
            </CardContent>
          </Card>
          
          <MetricCard 
            title="Ausstehende Jobs" 
            value={formatNumber(metrics?.jobs_pending || 0)}
            icon={Clock}
            variant={(metrics?.jobs_pending || 0) > 50 ? 'warning' : 'default'}
          />
          
          <MetricCard 
            title="Fehlgeschlagene Jobs (24h)" 
            value={formatNumber(metrics?.jobs_failed_24h || 0)}
            icon={AlertTriangle}
            variant={(metrics?.jobs_failed_24h || 0) > 5 ? 'danger' : 'default'}
          />
        </div>
      </div>
    </div>
  );
}
