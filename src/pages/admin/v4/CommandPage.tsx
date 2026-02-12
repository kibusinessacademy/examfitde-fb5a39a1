import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import {
  AlertTriangle, ArrowRight, CheckCircle2, Clock, Package,
  XCircle, Wrench, Shield, Brain, Activity, DollarSign, Rocket,
  Play, Download, Zap, RefreshCw, Pause, StopCircle, RotateCcw, Lightbulb
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import QueueOverview from '@/components/admin/QueueOverview';

interface CoursePackageRow {
  id: string;
  title: string | null;
  status: string;
  build_progress: number;
  integrity_passed: boolean;
  council_approved: boolean;
  queue_position: number | null;
  created_at: string;
}

interface SystemAlert {
  id: string;
  label: string;
  detail: string;
  link: string;
  icon: React.ElementType;
  level: 'critical' | 'warning' | 'info';
}

interface SummaryStats {
  activeBuilds: number;
  waiting: number;
  failedJobs7d: number;
  integrityBelow60: number;
  unpublishedErrors: number;
  budgetToday: string;
  lastPublishes: number;
}

function getStatusConfig(status: string) {
  const map: Record<string, { label: string; color: string; icon: React.ElementType }> = {
    planning: { label: 'Draft', color: 'bg-muted text-muted-foreground', icon: Clock },
    council_review: { label: 'Council', color: 'bg-warning/20 text-warning', icon: Brain },
    building: { label: 'Build', color: 'bg-primary/20 text-primary', icon: Wrench },
    qa: { label: 'QA', color: 'bg-accent/20 text-accent-foreground', icon: Shield },
    published: { label: 'Live', color: 'bg-success/20 text-success', icon: CheckCircle2 },
    failed: { label: 'Fehler', color: 'bg-destructive/20 text-destructive', icon: XCircle },
  };
  return map[status] || map.planning;
}

function getNBA(pkg: CoursePackageRow) {
  if (pkg.status === 'failed') return { label: 'Reparieren', icon: Wrench, variant: 'destructive' as const };
  if (pkg.status === 'published') return { label: 'Exportieren', icon: Download, variant: 'outline' as const };
  if (pkg.status === 'building') return { label: 'Fortschritt', icon: Activity, variant: 'outline' as const };
  if (pkg.council_approved) return { label: 'Build starten', icon: Play, variant: 'default' as const };
  return { label: 'Plan prüfen', icon: Brain, variant: 'default' as const };
}

export default function CommandPage() {
  const [packages, setPackages] = useState<CoursePackageRow[]>([]);
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [stats, setStats] = useState<SummaryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryingAll, setRetryingAll] = useState(false);

  const load = async () => {
    try {
      const sb = supabase as any;
      const [pkgRes, jobsRes, budgetRes] = await Promise.all([
        sb.from('course_packages')
          .select('id, title, status, build_progress, integrity_passed, council_approved, queue_position, created_at')
          .order('created_at', { ascending: false }).limit(30),
        sb.from('job_queue').select('id, status, created_at'),
        sb.from('ai_cost_budgets').select('budget_eur, spent_eur').order('month', { ascending: false }).limit(1),
      ]);

      const pkgs = (pkgRes.data || []) as CoursePackageRow[];
      setPackages(pkgs);

      const jobs = jobsRes.data || [];
      const failedJobs = jobs.filter((j: any) => j.status === 'failed');
      const pendingJobs = jobs.filter((j: any) => j.status === 'pending');
      const budget = budgetRes.data?.[0];

      const systemAlerts: SystemAlert[] = [];
      if (failedJobs.length > 0) {
        systemAlerts.push({
          id: 'failed-jobs', label: `${failedJobs.length} fehlgeschlagene Jobs`,
          detail: 'Dead Letter Queue prüfen', link: '/admin/ops/deadletter',
          icon: XCircle, level: failedJobs.length > 10 ? 'critical' : 'warning',
        });
      }

      const integrityFail = pkgs.filter(p => !p.integrity_passed && p.status !== 'planning' && p.status !== 'published');
      if (integrityFail.length > 0) {
        systemAlerts.push({
          id: 'integrity-low', label: `${integrityFail.length} Pakete mit Integritätsproblemen`,
          detail: 'Qualitätsprüfung fehlgeschlagen', link: '/admin/quality/integrity',
          icon: Shield, level: 'warning',
        });
      }

      if (budget && budget.budget_eur > 0) {
        const pct = (budget.spent_eur / budget.budget_eur) * 100;
        if (pct > 80) {
          systemAlerts.push({
            id: 'budget', label: `LLM-Budget bei ${Math.round(pct)}%`,
            detail: `€${budget.spent_eur.toFixed(0)} / €${budget.budget_eur}`,
            link: '/admin/business', icon: DollarSign, level: pct > 95 ? 'critical' : 'warning',
          });
        }
      }

      setAlerts(systemAlerts);
      setStats({
        activeBuilds: pkgs.filter(p => p.status === 'building').length,
        waiting: pkgs.filter(p => p.queue_position && p.status !== 'building' && p.status !== 'published').length,
        failedJobs7d: failedJobs.length,
        integrityBelow60: integrityFail.length,
        unpublishedErrors: pkgs.filter(p => p.status === 'failed').length,
        budgetToday: budget ? `€${budget.spent_eur.toFixed(0)}/${budget.budget_eur}` : '–',
        lastPublishes: pkgs.filter(p => p.status === 'published').length,
      });
    } catch (e) {
      console.error('CommandPage load error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleRetryAllFailed = async () => {
    setRetryingAll(true);
    try {
      await (supabase as any).from('job_queue')
        .update({ status: 'pending', attempts: 0, run_after: new Date().toISOString() })
        .eq('status', 'failed');
      toast.success('Alle fehlgeschlagenen Jobs werden erneut versucht');
      load();
    } catch (e: any) {
      toast.error(`Fehler: ${e.message}`);
    } finally {
      setRetryingAll(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      </div>
    );
  }

  const actionable = packages.filter(p => p.status !== 'published');
  const live = packages.filter(p => p.status === 'published');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">Leitstelle</h1>
        <p className="text-sm text-muted-foreground mt-1">Tagesübersicht & Sofortaktionen</p>
      </div>

      {/* KPI Cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {[
            { label: 'Aktive Builds', value: stats.activeBuilds, color: stats.activeBuilds > 0 ? 'text-primary' : 'text-muted-foreground' },
            { label: 'Wartend', value: stats.waiting, color: 'text-muted-foreground' },
            { label: 'Failed (7T)', value: stats.failedJobs7d, color: stats.failedJobs7d > 0 ? 'text-destructive' : 'text-success' },
            { label: 'Integrität ⚠', value: stats.integrityBelow60, color: stats.integrityBelow60 > 0 ? 'text-warning' : 'text-success' },
            { label: 'Fehler-Pakete', value: stats.unpublishedErrors, color: stats.unpublishedErrors > 0 ? 'text-destructive' : 'text-success' },
            { label: 'Budget heute', value: stats.budgetToday, color: 'text-muted-foreground' },
            { label: 'Live', value: stats.lastPublishes, color: 'text-success' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardContent className="py-3 px-4">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{kpi.label}</p>
                <p className={cn("text-xl font-bold mt-1", kpi.color)}>{kpi.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={handleRetryAllFailed} disabled={retryingAll || (stats?.failedJobs7d ?? 0) === 0}>
          <RotateCcw className="h-3.5 w-3.5 mr-1" /> Alle Failed retrien
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/studio/new"><Rocket className="h-3.5 w-3.5 mr-1" /> Neues Paket</Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/ops"><Activity className="h-3.5 w-3.5 mr-1" /> Queue</Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/business"><DollarSign className="h-3.5 w-3.5 mr-1" /> Finanzen</Link>
        </Button>
        <Button variant="ghost" size="sm" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Aktualisieren
        </Button>
      </div>

      {/* System Alerts */}
      {alerts.length > 0 && (
        <section className="space-y-2">
          {alerts.map(a => {
            const Icon = a.icon;
            return (
              <Link key={a.id} to={a.link} className="block">
                <Card className={cn("hover:shadow-md transition-shadow",
                  a.level === 'critical' ? 'border-destructive/30 bg-destructive/5' : 'border-warning/30 bg-warning/5'
                )}>
                  <CardContent className="py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Icon className={cn("h-4 w-4", a.level === 'critical' ? 'text-destructive' : 'text-warning')} />
                      <div>
                        <p className="text-sm font-medium text-foreground">{a.label}</p>
                        <p className="text-xs text-muted-foreground">{a.detail}</p>
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </section>
      )}

      {/* Queue Overview */}
      <QueueOverview />

      {/* Root Cause Card for blocked packages */}
      {packages.filter(p => p.status === 'failed').length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <Lightbulb className="h-3.5 w-3.5" /> Blockierte Pakete – Ursachenanalyse
          </h2>
          <div className="space-y-2">
            {packages.filter(p => p.status === 'failed').map(pkg => (
              <Card key={pkg.id} className="border-l-4 border-l-destructive">
                <CardContent className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate">{pkg.title || pkg.id.substring(0, 12)}</p>
                    <p className="text-xs text-destructive mt-0.5">Pipeline fehlgeschlagen – Details im Studio</p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/admin/studio/${pkg.id}`}>
                      <Wrench className="h-3.5 w-3.5 mr-1" /> Analysieren
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Actionable Packages */}
      {actionable.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <Package className="h-3.5 w-3.5" /> Unfertige Pakete ({actionable.length})
          </h2>
          <div className="space-y-2">
            {actionable.map(pkg => {
              const cfg = getStatusConfig(pkg.status);
              const StatusIcon = cfg.icon;
              const nba = getNBA(pkg);
              const NbaIcon = nba.icon;
              return (
                <Card key={pkg.id} className={cn("border-l-4",
                  pkg.status === 'failed' ? 'border-l-destructive' :
                  pkg.status === 'building' ? 'border-l-primary' : 'border-l-muted-foreground'
                )}>
                  <CardContent className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={cn("p-2 rounded-lg", cfg.color)}>
                        <StatusIcon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm text-foreground truncate">{pkg.title || pkg.id.substring(0, 12)}</p>
                          <Badge variant="outline" className={cn("text-xs", cfg.color)}>{cfg.label}</Badge>
                        </div>
                        {pkg.build_progress > 0 && pkg.build_progress < 100 && (
                          <div className="flex items-center gap-2 mt-1">
                            <Progress value={pkg.build_progress} className="h-1.5 flex-1 max-w-48" />
                            <span className="text-xs text-muted-foreground">{pkg.build_progress}%</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <Button asChild size="sm" variant={nba.variant} className="shrink-0">
                      <Link to={`/admin/studio/${pkg.id}`}>
                        <NbaIcon className="h-3.5 w-3.5 mr-1" /> {nba.label}
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* Empty */}
      {packages.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Package className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-4">Noch keine Kurspakete erstellt.</p>
            <Button asChild>
              <Link to="/admin/studio/new"><Rocket className="h-4 w-4 mr-2" /> Erstes Paket erstellen</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Live */}
      {live.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5" /> Live ({live.length})
          </h2>
          <div className="space-y-2">
            {live.map(pkg => (
              <Link key={pkg.id} to={`/admin/studio/${pkg.id}`} className="block">
                <Card className="hover:border-primary/30 transition-colors">
                  <CardContent className="py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-4 w-4 text-success" />
                      <p className="text-sm font-medium text-foreground">{pkg.title || pkg.id.substring(0, 12)}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
