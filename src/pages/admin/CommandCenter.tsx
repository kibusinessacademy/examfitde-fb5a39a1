import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import {
  AlertTriangle, ArrowRight, CheckCircle2, Clock, Package,
  XCircle, Wrench, Shield, Brain, Activity, DollarSign, Rocket, Play, Download, Zap
} from 'lucide-react';

/* ───── types ───── */
interface CoursePackageRow {
  id: string;
  title: string | null;
  status: string;
  build_progress: number;
  integrity_passed: boolean;
  council_approved: boolean;
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

/* ───── NBA (Next Best Action) ───── */
function getNextBestAction(pkg: CoursePackageRow): { label: string; icon: React.ElementType; variant: 'default' | 'destructive' | 'outline' } {
  if (pkg.status === 'failed')    return { label: 'Reparieren',      icon: Wrench,   variant: 'destructive' };
  if (pkg.status === 'published') return { label: 'Exportieren',     icon: Download, variant: 'outline' };
  if (pkg.status === 'qa')        return { label: 'Finalisieren',    icon: Shield,   variant: 'default' };
  if (pkg.status === 'building')  return { label: 'Fortschritt',     icon: Activity, variant: 'outline' };
  if (pkg.council_approved)       return { label: 'Build starten',   icon: Play,     variant: 'default' };
  return { label: 'Plan genehmigen', icon: Brain, variant: 'default' };
}

function getStatusConfig(status: string) {
  const map: Record<string, { label: string; color: string; icon: React.ElementType }> = {
    planning:       { label: 'Draft',          color: 'bg-muted text-muted-foreground', icon: Clock },
    council_review: { label: 'Council Review', color: 'bg-warning/20 text-warning',     icon: Brain },
    building:       { label: 'Build läuft',    color: 'bg-primary/20 text-primary',     icon: Wrench },
    qa:             { label: 'QA',             color: 'bg-accent/20 text-accent-foreground', icon: Shield },
    published:      { label: 'Live',           color: 'bg-success/20 text-success',     icon: CheckCircle2 },
    failed:         { label: 'Fehler',         color: 'bg-destructive/20 text-destructive', icon: XCircle },
  };
  return map[status] || map.planning;
}

/* ───── component ───── */
export default function CommandCenter() {
  const [packages, setPackages] = useState<CoursePackageRow[]>([]);
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const sb = supabase as any;
        const pkgRes = await sb.from('course_packages')
          .select('id, title, status, build_progress, integrity_passed, council_approved, created_at')
          .order('created_at', { ascending: false }).limit(20);
        const jobsRes = await sb.from('job_queue').select('id, status');
        const budgetRes = await sb.from('ai_cost_budgets')
          .select('budget_eur, spent_eur').order('month', { ascending: false }).limit(1);

        setPackages((pkgRes.data || []) as CoursePackageRow[]);

        const systemAlerts: SystemAlert[] = [];
        const jobs = jobsRes.data || [];
        const failedJobs = jobs.filter((j: any) => j.status === 'failed').length;
        const pendingJobs = jobs.filter((j: any) => j.status === 'pending').length;

        if (failedJobs > 0) {
          systemAlerts.push({
            id: 'failed-jobs',
            label: `${failedJobs} fehlgeschlagene Jobs`,
            detail: 'Job Queue benötigt Aufmerksamkeit',
            link: '/admin/system/jobs',
            icon: XCircle,
            level: failedJobs > 10 ? 'critical' : 'warning',
          });
        }
        if (pendingJobs > 30) {
          systemAlerts.push({
            id: 'pending-jobs',
            label: `${pendingJobs} wartende Jobs`,
            detail: 'Queue läuft langsam',
            link: '/admin/system/jobs',
            icon: Clock,
            level: 'warning',
          });
        }

        const budget = budgetRes.data?.[0];
        if (budget && budget.budget_eur > 0) {
          const pct = (budget.spent_eur / budget.budget_eur) * 100;
          if (pct > 80) {
            systemAlerts.push({
              id: 'llm-budget',
              label: `LLM-Budget bei ${Math.round(pct)}%`,
              detail: `€${budget.spent_eur.toFixed(0)} / €${budget.budget_eur}`,
              link: '/admin/finance',
              icon: DollarSign,
              level: pct > 95 ? 'critical' : 'warning',
            });
          }
        }

        setAlerts(systemAlerts);
      } catch (e) {
        console.error('CommandCenter load error:', e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      </div>
    );
  }

  const actionable = packages.filter(p => p.status !== 'published');
  const live = packages.filter(p => p.status === 'published');

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">Command Center</h1>
        <p className="text-sm text-muted-foreground mt-1">Was muss jetzt passieren?</p>
      </div>

      {/* System Alerts */}
      {alerts.length > 0 && (
        <section className="space-y-2">
          {alerts.map(a => {
            const Icon = a.icon;
            return (
              <Link key={a.id} to={a.link} className="block">
                <Card className={`hover:shadow-md transition-shadow ${
                  a.level === 'critical' ? 'border-destructive/30 bg-destructive/5' : 'border-warning/30 bg-warning/5'
                }`}>
                  <CardContent className="py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Icon className={`h-4 w-4 ${a.level === 'critical' ? 'text-destructive' : 'text-warning'}`} />
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

      {/* Actionable Packages */}
      {actionable.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <Package className="h-3.5 w-3.5" /> Unfertige Kurspakete ({actionable.length})
          </h2>
          <div className="space-y-2">
            {actionable.map(pkg => {
              const cfg = getStatusConfig(pkg.status);
              const StatusIcon = cfg.icon;
              const nba = getNextBestAction(pkg);
              const NbaIcon = nba.icon;
              return (
                <Card key={pkg.id} className={`border-l-4 ${
                  pkg.status === 'failed' ? 'border-l-destructive' :
                  pkg.status === 'building' ? 'border-l-primary' :
                  pkg.status === 'qa' ? 'border-l-warning' :
                  'border-l-muted-foreground'
                }`}>
                  <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={`p-2 rounded-lg ${cfg.color}`}>
                        <StatusIcon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm text-foreground truncate">
                            {pkg.title || pkg.id.substring(0, 12)}
                          </p>
                          <Badge variant="outline" className={`text-xs ${cfg.color}`}>{cfg.label}</Badge>
                        </div>
                        {pkg.build_progress > 0 && pkg.build_progress < 100 && (
                          <div className="flex items-center gap-2 mt-1.5">
                            <Progress value={pkg.build_progress} className="h-1.5 flex-1 max-w-48" />
                            <span className="text-xs text-muted-foreground">{pkg.build_progress}%</span>
                          </div>
                        )}
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          {pkg.council_approved && (
                            <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-success" /> Council OK</span>
                          )}
                          {pkg.integrity_passed && (
                            <span className="flex items-center gap-1"><Shield className="h-3 w-3 text-success" /> Integrity OK</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button asChild size="sm" variant={nba.variant} className="shrink-0">
                      <Link to={`/admin/course/${pkg.id}`}>
                        <NbaIcon className="h-3.5 w-3.5 mr-1.5" /> {nba.label}
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* Empty state */}
      {packages.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Package className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-4">Noch keine Kurspakete erstellt.</p>
            <Button asChild>
              <Link to="/admin/course-studio"><Rocket className="h-4 w-4 mr-2" /> Erstes Kurspaket erstellen</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Live Packages */}
      {live.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5" /> Live ({live.length})
          </h2>
          <div className="space-y-2">
            {live.map(pkg => (
              <Link key={pkg.id} to={`/admin/course/${pkg.id}`} className="block">
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

      {/* Quick links */}
      <section className="pt-2">
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/course-studio"><Rocket className="h-4 w-4 mr-1" /> Neues Paket</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin/courses"><Package className="h-4 w-4 mr-1" /> Alle Kurse</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin/system"><Activity className="h-4 w-4 mr-1" /> System</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin/finance"><DollarSign className="h-4 w-4 mr-1" /> Finanzen</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
