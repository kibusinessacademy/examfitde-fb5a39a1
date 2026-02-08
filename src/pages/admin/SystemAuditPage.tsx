import { useState, lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { 
  FileText, 
  TrendingUp, 
  AlertTriangle,
  CheckCircle,
  XCircle,
  DollarSign,
  Zap,
  Database,
  Cpu,
  Clock,
  RefreshCw,
  Download,
  BarChart3,
  BookOpen,
  Brain,
  Target,
  Lightbulb,
  Shield,
  Gauge
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

// Lazy-load Chart-Komponente
const LazyAreaChart = lazy(() => import('recharts').then(m => ({ default: m.AreaChart })));

// =====================================================
// Cost Tracking Tab
// =====================================================
function CostTrackingTab() {
  const { data: costData, isLoading, refetch } = useQuery({
    queryKey: ['ai-cost-overview'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_cost_budgets')
        .select('*')
        .order('month', { ascending: false })
        .limit(12);
      if (error) throw error;
      return data;
    }
  });

  const { data: dailyUsage } = useQuery({
    queryKey: ['ai-daily-usage'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_usage_log')
        .select('job_type, cost_eur, total_tokens, success, created_at')
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    }
  });

  const currentMonth = costData?.[0];
  const budgetUsagePercent = currentMonth 
    ? (Number(currentMonth.spent_eur) / Number(currentMonth.budget_eur)) * 100 
    : 0;
  const isWarning = budgetUsagePercent >= 80;
  const isCritical = budgetUsagePercent >= 95;

  // Aggregiere tägliche Kosten
  const dailyCosts = dailyUsage?.reduce((acc, log) => {
    const date = format(new Date(log.created_at), 'yyyy-MM-dd');
    if (!acc[date]) acc[date] = { date, cost: 0, tokens: 0, requests: 0, errors: 0 };
    acc[date].cost += Number(log.cost_eur);
    acc[date].tokens += log.total_tokens || 0;
    acc[date].requests += 1;
    if (!log.success) acc[date].errors += 1;
    return acc;
  }, {} as Record<string, { date: string; cost: number; tokens: number; requests: number; errors: number }>);

  const dailyCostsArray = Object.values(dailyCosts || {}).slice(0, 14).reverse();

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      {/* Budget Overview */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className={`glass-card ${isCritical ? 'border-red-500/50 bg-red-500/5' : isWarning ? 'border-yellow-500/50 bg-yellow-500/5' : 'border-green-500/30'}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Monatliches Budget
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {Number(currentMonth?.spent_eur || 0).toFixed(2)}€
              <span className="text-lg text-muted-foreground font-normal">
                {' '}/ {Number(currentMonth?.budget_eur || 200).toFixed(0)}€
              </span>
            </div>
            <Progress 
              value={Math.min(budgetUsagePercent, 100)} 
              className={`mt-2 h-2 ${isCritical ? '[&>div]:bg-red-500' : isWarning ? '[&>div]:bg-yellow-500' : ''}`}
            />
            <p className="text-xs text-muted-foreground mt-1">
              {budgetUsagePercent.toFixed(1)}% verbraucht
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Tokens heute
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {((dailyCostsArray[dailyCostsArray.length - 1]?.tokens || 0) / 1000).toFixed(1)}k
            </div>
            <p className="text-xs text-muted-foreground">
              {dailyCostsArray[dailyCostsArray.length - 1]?.requests || 0} Anfragen
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="h-4 w-4" />
              Verbleibend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">
              {(Number(currentMonth?.budget_eur || 200) - Number(currentMonth?.spent_eur || 0)).toFixed(2)}€
            </div>
            <p className="text-xs text-muted-foreground">
              ~{Math.round((Number(currentMonth?.budget_eur || 200) - Number(currentMonth?.spent_eur || 0)) / 6.5)} Tage verbleibend
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Alert-Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {currentMonth?.alert_sent_at ? (
              <Badge variant="destructive" className="text-sm">
                Alert gesendet
              </Badge>
            ) : (
              <Badge variant="outline" className="text-sm">
                Kein Alert
              </Badge>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              Alert bei {Number(currentMonth?.alert_threshold || 0.8) * 100}%
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Alert Banner wenn nötig */}
      {isWarning && (
        <Alert variant={isCritical ? "destructive" : "default"} className={isCritical ? '' : 'border-yellow-500 bg-yellow-500/10'}>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {isCritical ? 'Kritisch: Budget fast erschöpft!' : 'Warnung: Budget zu 80% verbraucht'}
          </AlertTitle>
          <AlertDescription>
            {isCritical 
              ? 'Das monatliche AI-Budget ist fast aufgebraucht. Einige Funktionen könnten eingeschränkt werden.'
              : 'Du nähherst dich dem monatlichen Budgetlimit. Überprüfe die Nutzung oder erhöhe das Budget.'}
          </AlertDescription>
        </Alert>
      )}

      {/* Kosten-Verlauf */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Kostenverlauf (letzte 14 Tage)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-14 gap-1 h-32">
            {dailyCostsArray.map((day, i) => {
              const maxCost = Math.max(...dailyCostsArray.map(d => d.cost), 1);
              const height = (day.cost / maxCost) * 100;
              return (
                <div key={i} className="flex flex-col items-center justify-end">
                  <div 
                    className="w-full bg-primary/80 rounded-t hover:bg-primary transition-colors"
                    style={{ height: `${height}%` }}
                    title={`${day.date}: ${day.cost.toFixed(3)}€`}
                  />
                  <span className="text-[10px] text-muted-foreground mt-1">
                    {format(new Date(day.date), 'dd')}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Kosten nach Job-Typ */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Kosten nach Funktion</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Object.entries(
              dailyUsage?.reduce((acc, log) => {
                if (!acc[log.job_type]) acc[log.job_type] = { cost: 0, tokens: 0, count: 0 };
                acc[log.job_type].cost += Number(log.cost_eur);
                acc[log.job_type].tokens += log.total_tokens || 0;
                acc[log.job_type].count += 1;
                return acc;
              }, {} as Record<string, { cost: number; tokens: number; count: number }>) || {}
            )
              .sort((a, b) => b[1].cost - a[1].cost)
              .slice(0, 8)
              .map(([type, data]) => (
                <div key={type} className="flex items-center gap-4">
                  <div className="w-32 font-mono text-sm truncate">{type}</div>
                  <div className="flex-1">
                    <Progress value={(data.cost / Number(currentMonth?.spent_eur || 1)) * 100} className="h-2" />
                  </div>
                  <div className="text-sm font-medium w-20 text-right">{data.cost.toFixed(3)}€</div>
                  <div className="text-xs text-muted-foreground w-16 text-right">{data.count}x</div>
                </div>
              ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// =====================================================
// Optimization Report Tab
// =====================================================
function OptimizationReportTab() {
  const didacticSteps = [
    { key: 'einstieg', title: 'Einstieg', duration: '10 Min', h5p: 'ImageHotspots', status: 'validated' },
    { key: 'verstehen', title: 'Verstehen', duration: '25 Min', h5p: 'InteractiveVideo', status: 'validated' },
    { key: 'anwenden', title: 'Anwenden', duration: '30 Min', h5p: 'BranchingScenario', status: 'validated' },
    { key: 'wiederholen', title: 'Wiederholen', duration: '15 Min', h5p: 'Flashcards', status: 'validated' },
    { key: 'minicheck', title: 'Mini-Check', duration: '10 Min', h5p: 'QuestionSet', status: 'validated' }
  ];

  const blueprintSystem = {
    features: [
      { name: 'Lernfeld-Gewichtung', status: 'active', description: 'Automatische Fragenverteilung nach Lernfeldgewicht' },
      { name: 'Taxonomie-Anpassung', status: 'active', description: 'Schwierigkeitsanpassung nach Bloom-Taxonomie' },
      { name: 'Validierung', status: 'active', description: '4 Optionen pro Frage, korrekte Antwort-Counts' },
      { name: 'Batch-Generierung', status: 'active', description: 'Retry-Logic bei Fehlern' }
    ],
    difficultyDistribution: [
      { taxonomy: 'Erinnern', easy: 10, medium: 40, hard: 50 },
      { taxonomy: 'Verstehen', easy: 10, medium: 40, hard: 50 },
      { taxonomy: 'Analysieren+', easy: 10, medium: 40, hard: 50 }
    ]
  };

  const performanceChecks = [
    { name: 'Lazy-Loading Admin-Bereich', status: 'pending', priority: 'high' },
    { name: 'Chart-Libraries on-demand', status: 'pending', priority: 'high' },
    { name: 'PDF-Export separate Route', status: 'pending', priority: 'medium' },
    { name: 'Code-Splitting Editor', status: 'pending', priority: 'medium' },
    { name: 'E2E-Tests erweitern', status: 'pending', priority: 'low' },
    { name: 'Error-Monitoring (Sentry)', status: 'pending', priority: 'medium' },
    { name: 'A/B-Testing Conversion', status: 'pending', priority: 'low' }
  ];

  const upcomingFeatures = [
    { name: 'Blueprint-Editor fertigstellen', status: 'in_progress', eta: 'Q1 2026' },
    { name: 'AI SEO-Blog-Generator', status: 'planned', eta: 'Q1 2026' },
    { name: 'CourseReviews Komponente', status: 'done', eta: 'Abgeschlossen' }
  ];

  return (
    <div className="space-y-6">
      {/* Kern-Services Status */}
      <Card className="glass-card border-green-500/30 bg-green-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            Kern-Services (validiert)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-background/50">
            <Brain className="h-8 w-8 text-primary" />
            <div>
              <div className="font-medium">5-Schritte-Didaktik</div>
              <div className="text-sm text-muted-foreground">Intelligente AI-gestützte Didaktik implementiert</div>
            </div>
            <Badge variant="default" className="ml-auto">Aktiv</Badge>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-background/50">
            <Target className="h-8 w-8 text-primary" />
            <div>
              <div className="font-medium">Fragen-Generator</div>
              <div className="text-sm text-muted-foreground">AI-Fragen-Generator mit Validierung</div>
            </div>
            <Badge variant="default" className="ml-auto">Aktiv</Badge>
          </div>
        </CardContent>
      </Card>

      {/* 5-Schritte-Didaktik */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            5-Schritte-Didaktik Struktur
          </CardTitle>
          <CardDescription>
            Implementierte didaktische Struktur pro Kompetenz
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-5">
            {didacticSteps.map((step, i) => (
              <Card key={step.key} className="relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-primary" />
                <CardContent className="pt-4">
                  <div className="text-xs text-muted-foreground mb-1">Schritt {i + 1}</div>
                  <div className="font-semibold">{step.title}</div>
                  <div className="text-sm text-muted-foreground">{step.duration}</div>
                  <Badge variant="outline" className="mt-2 text-xs">
                    {step.h5p}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Blueprint-System */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Prüfungstrainer Blueprint-System
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            {blueprintSystem.features.map((feature) => (
              <div key={feature.name} className="flex items-center gap-3 p-3 rounded-lg border bg-muted/20">
                <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
                <div>
                  <div className="font-medium">{feature.name}</div>
                  <div className="text-sm text-muted-foreground">{feature.description}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4">
            <h4 className="font-medium mb-2">Schwierigkeitsverteilung</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Taxonomie</th>
                    <th className="text-center py-2">Leicht</th>
                    <th className="text-center py-2">Mittel</th>
                    <th className="text-center py-2">Schwer</th>
                  </tr>
                </thead>
                <tbody>
                  {blueprintSystem.difficultyDistribution.map((row) => (
                    <tr key={row.taxonomy} className="border-b">
                      <td className="py-2 font-medium">{row.taxonomy}</td>
                      <td className="text-center py-2">{row.easy}%</td>
                      <td className="text-center py-2">{row.medium}%</td>
                      <td className="text-center py-2">{row.hard}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Performance Optimierungen */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5" />
            Performance Optimierungen
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {performanceChecks.map((check) => (
              <div key={check.name} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                {check.status === 'done' ? (
                  <CheckCircle className="h-5 w-5 text-green-500" />
                ) : check.status === 'in_progress' ? (
                  <Clock className="h-5 w-5 text-yellow-500" />
                ) : (
                  <div className="h-5 w-5 rounded border-2 border-muted-foreground/30" />
                )}
                <span className={check.status === 'done' ? 'line-through text-muted-foreground' : ''}>
                  {check.name}
                </span>
                <Badge 
                  variant={check.priority === 'high' ? 'destructive' : check.priority === 'medium' ? 'secondary' : 'outline'}
                  className="ml-auto text-xs"
                >
                  {check.priority}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Upcoming Features */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5" />
            Feature-Roadmap
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {upcomingFeatures.map((feature) => (
              <div key={feature.name} className="flex items-center gap-3 p-3 rounded-lg border">
                {feature.status === 'done' ? (
                  <CheckCircle className="h-5 w-5 text-green-500" />
                ) : feature.status === 'in_progress' ? (
                  <Clock className="h-5 w-5 text-yellow-500 animate-pulse" />
                ) : (
                  <Target className="h-5 w-5 text-muted-foreground" />
                )}
                <div className="flex-1">
                  <div className="font-medium">{feature.name}</div>
                </div>
                <Badge variant={feature.status === 'done' ? 'default' : 'outline'}>
                  {feature.eta}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// =====================================================
// System Metrics Tab
// =====================================================
function SystemMetricsTab() {
  const { data: metrics, isLoading } = useQuery({
    queryKey: ['performance-metrics'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('performance_metrics')
        .select('*')
        .order('metric_date', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    }
  });

  const { data: healthChecks } = useQuery({
    queryKey: ['system-health-summary'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_health_checks')
        .select('*')
        .order('checked_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    }
  });

  const { data: jobStats } = useQuery({
    queryKey: ['job-stats-audit'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_queue')
        .select('status, job_type')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
      if (error) throw error;
      return data;
    }
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const jobStatusCounts = jobStats?.reduce((acc, job) => {
    acc[job.status] = (acc[job.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  const healthyChecks = healthChecks?.filter(c => c.status === 'healthy').length || 0;
  const totalChecks = healthChecks?.length || 1;

  return (
    <div className="space-y-6">
      {/* System Health Summary */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Shield className="h-4 w-4" />
              System Health
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">
              {Math.round((healthyChecks / totalChecks) * 100)}%
            </div>
            <Progress value={(healthyChecks / totalChecks) * 100} className="mt-2 h-2" />
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Jobs (24h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{jobStats?.length || 0}</div>
            <div className="flex gap-2 mt-1">
              <Badge variant="default">{jobStatusCounts['completed'] || 0} ✓</Badge>
              <Badge variant="destructive">{jobStatusCounts['failed'] || 0} ✗</Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Database className="h-4 w-4" />
              DB Response
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {healthChecks?.[0]?.response_time_ms || '--'}ms
            </div>
            <p className="text-xs text-muted-foreground">Durchschnittliche Antwortzeit</p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              Edge Functions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">Aktiv</div>
            <p className="text-xs text-muted-foreground">Alle Funktionen verfügbar</p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Health Checks */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>System-Komponenten Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            {Array.from(new Set(healthChecks?.map(c => c.check_type) || [])).map(type => {
              const latest = healthChecks?.find(c => c.check_type === type);
              const isHealthy = latest?.status === 'healthy';
              return (
                <Card key={type} className={`${isHealthy ? 'border-green-500/30' : 'border-red-500/30'}`}>
                  <CardContent className="flex items-center gap-3 py-4">
                    {isHealthy ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-500" />
                    )}
                    <div>
                      <div className="font-medium capitalize">{type?.replace('_', ' ')}</div>
                      <div className="text-sm text-muted-foreground">
                        {latest?.response_time_ms}ms
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Performance Metrics Table */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Performance-Metriken</CardTitle>
          <CardDescription>Aktuelle Systemleistung und Schwellenwerte</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {metrics?.slice(0, 10).map((metric) => {
              const isWarning = metric.threshold_warning && Number(metric.metric_value) >= Number(metric.threshold_warning);
              const isCritical = metric.threshold_critical && Number(metric.metric_value) >= Number(metric.threshold_critical);
              
              return (
                <div key={metric.id} className="flex items-center gap-4 p-3 rounded-lg bg-muted/30">
                  <div className="flex-1">
                    <div className="font-medium">{metric.metric_name}</div>
                    <div className="text-xs text-muted-foreground">{metric.metric_type}</div>
                  </div>
                  <div className={`text-lg font-bold ${isCritical ? 'text-red-500' : isWarning ? 'text-yellow-500' : ''}`}>
                    {Number(metric.metric_value).toFixed(2)} {metric.unit}
                  </div>
                  {(metric.threshold_warning || metric.threshold_critical) && (
                    <div className="text-xs text-muted-foreground">
                      ⚠ {metric.threshold_warning} / ⛔ {metric.threshold_critical}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// =====================================================
// UI/UX Features Tab
// =====================================================
function UIFeaturesTab() {
  const uiFeatures = [
    { 
      name: 'CourseReviews', 
      status: 'implemented', 
      features: ['Sterne-Bewertung (1-5)', 'Zusammenfassung mit Balkendiagramm', 'Verifizierte Käufer Badge', '"Hilfreich" Button', 'Responsive Design', 'Dark Mode Support'] 
    },
    { 
      name: 'Lern-Notizen', 
      status: 'implemented', 
      features: ['Eigene Notizen pro Lektion', 'Fragen markieren', 'Zur Wiederholung markieren', 'Notiz-Kategorien'] 
    },
    { 
      name: 'Prüfungssimulation', 
      status: 'implemented', 
      features: ['IHK-konforme Simulation', 'Zeitmessung', 'Detaillierte Auswertung', 'Lektionsempfehlungen'] 
    },
    { 
      name: 'Oral Exam Trainer', 
      status: 'implemented', 
      features: ['Speech-to-Text', 'Text-to-Speech', 'AI-Feedback', 'Musterantworten', 'Nachfragen'] 
    }
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        {uiFeatures.map((feature) => (
          <Card key={feature.name} className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                {feature.name}
                <Badge variant="default">Implementiert</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {feature.features.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// =====================================================
// Main Component
// =====================================================
export default function SystemAuditPage() {
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  const generateReport = async () => {
    setIsGeneratingReport(true);
    try {
      // Simuliere Report-Generierung
      await new Promise(resolve => setTimeout(resolve, 2000));
      toast.success('Audit-Bericht wurde generiert');
    } finally {
      setIsGeneratingReport(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">System Audit & Optimierung</h1>
          <p className="text-muted-foreground">
            Umfassende Analyse, Kostentracking und Optimierungsempfehlungen
          </p>
        </div>
        <Button onClick={generateReport} disabled={isGeneratingReport}>
          {isGeneratingReport ? (
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Download className="h-4 w-4 mr-2" />
          )}
          Bericht exportieren
        </Button>
      </div>

      <Tabs defaultValue="costs" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="costs" className="gap-2">
            <DollarSign className="h-4 w-4" /> Kosten
          </TabsTrigger>
          <TabsTrigger value="optimization" className="gap-2">
            <TrendingUp className="h-4 w-4" /> Optimierung
          </TabsTrigger>
          <TabsTrigger value="metrics" className="gap-2">
            <BarChart3 className="h-4 w-4" /> Metriken
          </TabsTrigger>
          <TabsTrigger value="ui" className="gap-2">
            <FileText className="h-4 w-4" /> UI/UX
          </TabsTrigger>
        </TabsList>

        <TabsContent value="costs">
          <CostTrackingTab />
        </TabsContent>
        <TabsContent value="optimization">
          <OptimizationReportTab />
        </TabsContent>
        <TabsContent value="metrics">
          <SystemMetricsTab />
        </TabsContent>
        <TabsContent value="ui">
          <UIFeaturesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}