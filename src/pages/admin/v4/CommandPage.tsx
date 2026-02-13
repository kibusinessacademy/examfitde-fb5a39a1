import { useEffect, useState, useCallback } from 'react';
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
  Play, Download, Zap, RefreshCw, Pause, RotateCcw, Lightbulb,
  Timer, TrendingUp, Gauge
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import PageExplainer from '@/components/admin/PageExplainer';
import CommandStatusBoard from '@/components/admin/CommandStatusBoard';

export default function CommandPage() {
  const [kpis, setKpis] = useState<any>(null);
  const [packages, setPackages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [kpiRes, pkgRes] = await Promise.all([
        (supabase as any).rpc('get_production_kpis'),
        (supabase as any).from('course_packages')
          .select('id, title, status, build_progress, integrity_passed, council_approved, queue_position, current_step, step_status_json, last_progress_at, stuck_reason, priority, created_at')
          .order('created_at', { ascending: false }).limit(40),
      ]);
      setKpis(kpiRes.data);
      setPackages(pkgRes.data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startNext = async () => {
    setActing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/package-queue-next`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      });
      const d = await res.json();
      if (d.ok && !d.skipped) toast.success(`Package gestartet: ${d.started_package_id?.slice(0, 8)}`);
      else toast.info(d.reason || 'Keine Packages in Queue');
      load();
    } catch (e: any) { toast.error(e.message); }
    setActing(false);
  };

  const retryAllFailed = async () => {
    setActing(true);
    await (supabase as any).from('job_queue')
      .update({ status: 'pending', attempts: 0, run_after: new Date().toISOString(), scheduled_at: null })
      .eq('status', 'failed');
    toast.success('Alle Failed Jobs zurückgesetzt');
    load();
    setActing(false);
  };

  const retryStuckPkg = async (pkgId: string) => {
    const { data } = await (supabase as any).rpc('auto_retry_stuck_package', { p_package_id: pkgId });
    toast.success(`${data ?? 0} Jobs retried für Package`);
    load();
  };

  if (loading) return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
      </div>
    </div>
  );

  const budget = kpis?.budget;
  const activePackages = packages.filter(p => p.status === 'building');
  const queuedPackages = packages.filter(p => ['queued', 'planning'].includes(p.status) && p.queue_position);
  const failedPackages = packages.filter(p => p.status === 'failed');
  const publishedPackages = packages.filter(p => p.status === 'published');
  const stuckPackages = packages.filter(p => p.stuck_reason && p.status === 'building');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">Leitstelle</h1>
        <p className="text-sm text-muted-foreground mt-1">Produktionssteuerung · Completion-First · Max {budget?.max_active_packages ?? 4} aktive Pakete</p>
      </div>

      <PageExplainer
        title="Produktions-Leitstelle"
        description="Completion-First: Laufende Pakete werden priorisiert fertiggestellt, bevor neue gestartet werden. Max 4 aktive Pakete gleichzeitig. Stuck Detection erkennt hängende Builds automatisch."
        workflow={[
          { label: 'Leitstelle', active: true },
          { label: 'Studio' },
          { label: 'Quality' },
          { label: 'Ops' },
          { label: 'Business' },
        ]}
        actions={[
          '"Start Next" – Startet das nächste Package aus der Queue',
          '"Retry Stuck" – Setzt festgefahrene 429/Timeout-Jobs zurück',
          'Klick auf Package → Course Workspace',
        ]}
      />

      {/* Command Status Board – 5 Ampeln */}
      <CommandStatusBoard />

      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <KPICard label="Aktiv" value={kpis?.active_packages ?? 0} sub={`/ ${budget?.max_active_packages ?? 4}`} alert={(kpis?.active_packages ?? 0) >= (budget?.max_active_packages ?? 4)} />
        <KPICard label="Queued" value={kpis?.queued_packages ?? 0} />
        <KPICard label="Published" value={kpis?.published_packages ?? 0} color="text-success" />
        <KPICard label="Stuck" value={kpis?.stuck_packages ?? 0} alert={(kpis?.stuck_packages ?? 0) > 0} />
        <KPICard label="Jobs ✅ 24h" value={kpis?.completed_jobs_24h ?? 0} color="text-success" />
        <KPICard label="Jobs ❌ 24h" value={kpis?.failed_jobs_24h ?? 0} alert={(kpis?.failed_jobs_24h ?? 0) > 5} />
        <KPICard label="Kosten heute" value={`€${Number(kpis?.cost_today ?? 0).toFixed(1)}`} />
        <KPICard label="Throughput/h" value={kpis?.throughput_1h ?? 0} />
      </div>

      {/* Provider Load */}
      {kpis?.rate_limits?.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {kpis.rate_limits.map((rl: any) => {
            const running = kpis.provider_load?.find((p: any) => p.provider === rl.provider)?.running ?? 0;
            const pct = rl.max_concurrent > 0 ? (running / rl.max_concurrent) * 100 : 0;
            return (
              <Card key={rl.provider} className={cn(rl.is_paused && "border-warning/50 bg-warning/5")}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium uppercase">{rl.provider}</span>
                    {rl.is_paused && <Badge variant="outline" className="text-[10px] text-warning">PAUSED</Badge>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Progress value={pct} className="h-2 flex-1" />
                    <span className="text-xs font-mono">{running}/{rl.max_concurrent}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={startNext} disabled={acting}>
          <Play className="h-3.5 w-3.5 mr-1" /> Start Next
        </Button>
        <Button variant="outline" size="sm" onClick={retryAllFailed} disabled={acting || (kpis?.failed_jobs_24h ?? 0) === 0}>
          <RotateCcw className="h-3.5 w-3.5 mr-1" /> Alle Failed retrien
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/studio/new"><Rocket className="h-3.5 w-3.5 mr-1" /> Neues Paket</Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/ops"><Activity className="h-3.5 w-3.5 mr-1" /> Queue</Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/business"><DollarSign className="h-3.5 w-3.5 mr-1" /> Kosten</Link>
        </Button>
        <Button variant="ghost" size="sm" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
        </Button>
      </div>

      {/* Top Errors */}
      {kpis?.top_errors?.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" /> Top Fehler
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {kpis.top_errors.map((e: any) => (
                <Badge key={e.code} variant="outline" className="text-destructive">{e.code}: {e.cnt}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stuck Packages */}
      {stuckPackages.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-destructive mb-3 flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5" /> Stuck ({stuckPackages.length})
          </h2>
          <div className="space-y-2">
            {stuckPackages.map(pkg => (
              <Card key={pkg.id} className="border-l-4 border-l-destructive">
                <CardContent className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{pkg.title || pkg.id.slice(0, 12)}</p>
                    <p className="text-xs text-destructive">{pkg.stuck_reason}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => retryStuckPkg(pkg.id)}>
                    <RotateCcw className="h-3.5 w-3.5 mr-1" /> Retry
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Active Builds */}
      {activePackages.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-primary mb-3 flex items-center gap-2">
            <Wrench className="h-3.5 w-3.5" /> Building ({activePackages.length})
          </h2>
          <div className="space-y-2">
            {activePackages.map(pkg => (
              <PackageCard key={pkg.id} pkg={pkg} />
            ))}
          </div>
        </section>
      )}

      {/* Queued */}
      {queuedPackages.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <Clock className="h-3.5 w-3.5" /> Queued ({queuedPackages.length})
          </h2>
          <div className="space-y-2">
            {queuedPackages.map(pkg => (
              <PackageCard key={pkg.id} pkg={pkg} />
            ))}
          </div>
        </section>
      )}

      {/* Failed */}
      {failedPackages.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-destructive mb-3 flex items-center gap-2">
            <XCircle className="h-3.5 w-3.5" /> Failed ({failedPackages.length})
          </h2>
          <div className="space-y-2">
            {failedPackages.map(pkg => (
              <PackageCard key={pkg.id} pkg={pkg} />
            ))}
          </div>
        </section>
      )}

      {/* Published */}
      {publishedPackages.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-success mb-3 flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5" /> Live ({publishedPackages.length})
          </h2>
          <div className="space-y-2">
            {publishedPackages.slice(0, 5).map(pkg => (
              <Link key={pkg.id} to={`/admin/studio/${pkg.id}`} className="block">
                <Card className="hover:border-primary/30 transition-colors">
                  <CardContent className="py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-4 w-4 text-success" />
                      <p className="text-sm font-medium">{pkg.title || pkg.id.slice(0, 12)}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {packages.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Package className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-4">Noch keine Kurspakete.</p>
            <Button asChild>
              <Link to="/admin/studio/new"><Rocket className="h-4 w-4 mr-2" /> Erstes Paket</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KPICard({ label, value, sub, color, alert: isAlert }: { label: string; value: any; sub?: string; color?: string; alert?: boolean }) {
  return (
    <Card className={cn(isAlert && "border-destructive/50")}>
      <CardContent className="py-3 px-4">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={cn("text-xl font-bold mt-1", isAlert ? "text-destructive" : color || "text-foreground")}>{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

const STEPS = ['Scaffold', 'Exam', 'Oral', 'Tutor', 'Handbuch', 'Integrity', 'Publish'];

function PackageCard({ pkg }: { pkg: any }) {
  const step = pkg.current_step ?? 0;
  const pct = Math.round((step / 7) * 100);

  return (
    <Link to={`/admin/studio/${pkg.id}`} className="block">
      <Card className={cn("hover:shadow-md transition-shadow border-l-4",
        pkg.status === 'building' ? 'border-l-primary' :
        pkg.status === 'failed' ? 'border-l-destructive' : 'border-l-muted-foreground'
      )}>
        <CardContent className="py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{pkg.title || pkg.id.slice(0, 12)}</p>
              {pkg.status === 'building' && (
                <div className="flex items-center gap-2 mt-1">
                  <Progress value={pct} className="h-1.5 flex-1 max-w-48" />
                  <span className="text-[10px] text-muted-foreground">{step}/7 · {STEPS[step - 1] || '–'}</span>
                </div>
              )}
              {pkg.last_progress_at && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Letzter Fortschritt: {new Date(pkg.last_progress_at).toLocaleString('de-DE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                </p>
              )}
            </div>
            <Badge variant="outline" className="text-xs shrink-0">{pkg.status}</Badge>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
