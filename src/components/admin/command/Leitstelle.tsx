import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import { cn } from '@/lib/utils';
import { useCommandData, type PipelinePackage } from '@/hooks/useCommandData';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, CheckCircle2, Clock, DollarSign, Loader2, RefreshCw, XCircle,
  AlertTriangle, Package, TrendingUp, Zap,
  ShieldAlert, Wrench, Server,
} from 'lucide-react';
import { deriveStepProgress } from '@/lib/pipeline-steps';
import ForensikPanel from './ForensikPanel';
import StepDurationPanel from './StepDurationPanel';

const fmtEur = (v: number) => `€${v.toFixed(2)}`;

function Metric({ icon, label, value, sub, alert }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string; alert?: boolean;
}) {
  return (
    <Card className={cn(alert && 'border-destructive/40 bg-destructive/5')}>
      <CardContent className="pt-3 pb-2.5 px-3">
        <div className="flex items-center gap-1.5 mb-1">
          {icon}
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">{label}</span>
        </div>
        <p className={cn("text-lg font-bold font-mono", alert && 'text-destructive')}>{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

/** Derive content artefact status from step_status_json SSOT */
function getStepOk(statuses: Record<string, string>, genKey: string, valKey: string) {
  const gen = statuses[genKey];
  const val = statuses[valKey];
  const done = (gen === 'done' || gen === 'skipped') && (val === 'done' || val === 'skipped');
  const partial = gen === 'done' || gen === 'skipped';
  return { done, partial };
}

function ContentIcon({ done, partial }: { done: boolean; partial?: boolean }) {
  if (done) return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  if (partial) return <Clock className="h-3.5 w-3.5 text-amber-500" />;
  return <XCircle className="h-3.5 w-3.5 text-destructive" />;
}

function PackageRow({ pkg }: { pkg: PipelinePackage }) {
  const stepStatuses = (pkg.step_status_json || {}) as Record<string, string>;
  const { progress, currentLabel, isActive } = deriveStepProgress(stepStatuses);
  const lastUpdate = new Date(pkg.updated_at);
  const ageMin = Math.round((Date.now() - lastUpdate.getTime()) / 60000);
  const staleWarning = ageMin > 120 && !isActive;

  const oral = getStepOk(stepStatuses, 'generate_oral_exam', 'validate_oral_exam');
  const tutor = getStepOk(stepStatuses, 'build_ai_tutor_index', 'validate_tutor_index');
  const handbook = getStepOk(stepStatuses, 'generate_handbook', 'validate_handbook');

  return (
    <TableRow className={cn(
      Object.values(stepStatuses).some(s => s === 'failed') && 'bg-destructive/5',
      isActive && 'bg-primary/5',
    )}>
      <TableCell className="font-medium text-sm max-w-[200px] truncate">{pkg.name}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          {isActive ? (
            <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">
              <Loader2 className="h-3 w-3 mr-0.5 animate-spin" />{currentLabel}
            </Badge>
          ) : staleWarning ? (
            <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-[10px]">
              <AlertTriangle className="h-3 w-3 mr-0.5" />Wartend
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">{currentLabel}</Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="text-center"><ContentIcon done={oral.done} partial={oral.partial} /></TableCell>
      <TableCell className="text-center"><ContentIcon done={tutor.done} partial={tutor.partial} /></TableCell>
      <TableCell className="text-center"><ContentIcon done={handbook.done} partial={handbook.partial} /></TableCell>
      <TableCell className="text-right">
        <div className="flex items-center gap-1.5 justify-end">
          <Progress value={progress} className="h-1.5 w-14" />
          <span className="text-xs font-mono text-muted-foreground w-8 text-right">{progress}%</span>
        </div>
      </TableCell>
    </TableRow>
  );
}

function PackageCard({ pkg }: { pkg: PipelinePackage }) {
  const stepStatuses = (pkg.step_status_json || {}) as Record<string, string>;
  const { progress, currentLabel } = deriveStepProgress(stepStatuses);
  const hasFailed = Object.values(stepStatuses).some(s => s === 'failed');
  const isActive = Object.values(stepStatuses).some(s => s === 'running' || s === 'enqueued');

  const oral = getStepOk(stepStatuses, 'generate_oral_exam', 'validate_oral_exam');
  const tutor = getStepOk(stepStatuses, 'build_ai_tutor_index', 'validate_tutor_index');
  const handbook = getStepOk(stepStatuses, 'generate_handbook', 'validate_handbook');

  return (
    <div className={cn(
      "border rounded-lg p-3 space-y-2",
      hasFailed && 'border-destructive/30 bg-destructive/5',
      isActive && 'border-primary/30 bg-primary/5',
    )}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm truncate">{pkg.name}</span>
        <span className="text-xs font-mono text-muted-foreground">{progress}%</span>
      </div>
      <Progress value={progress} className="h-1.5" />
      <div className="text-[10px] text-muted-foreground text-center">{currentLabel}</div>
      <div className="grid grid-cols-3 gap-1 text-[10px] text-center text-muted-foreground">
        <div><ContentIcon done={oral.done} partial={oral.partial} /><br/>Oral</div>
        <div><ContentIcon done={tutor.done} partial={tutor.partial} /><br/>Tutor</div>
        <div><ContentIcon done={handbook.done} partial={handbook.partial} /><br/>Handb.</div>
      </div>
    </div>
  );
}

export default function Leitstelle() {
  const { packages, kpis, loading, lastRefresh, refetch } = useCommandData();
  const [zombieDrawerOpen, setZombieDrawerOpen] = useState(false);

  const { data: zombieRows } = useQuery({
    queryKey: ['zombie-packages'],
    queryFn: async () => {
      const { data } = await (supabase as any).from('ops_building_without_job_or_lease').select('*');
      return (data || []) as { package_id: string; title: string; build_progress: number; updated_at: string; last_progress_at: string | null }[];
    },
    refetchInterval: 30000,
  });

  if (loading) return (
    <div className="space-y-4">
      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
    </div>
  );

  if (!kpis) return null;

  const budgetPct = kpis.budget_eur > 0 ? Math.round((kpis.cost_mtd_eur / kpis.budget_eur) * 100) : 0;
  const throughputPerH = kpis.jobs_completed_today / Math.max(new Date().getHours(), 1);
  const etaH = throughputPerH > 0 ? Math.round((kpis.jobs_pending / throughputPerH) * 10) / 10 : 0;
  const bm = kpis.building_metrics;
  const runnerIdle = bm.active_by_leases > 0 && bm.active_by_jobs === 0;
  const orchestrationBug = bm.active_by_jobs > bm.active_by_leases;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-display font-bold text-foreground">Leitstelle</h1>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            {lastRefresh.toLocaleTimeString('de-DE')} · 30s
          </span>
          <Button variant="ghost" size="sm" onClick={refetch} className="h-8 w-8 p-0">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Ampel Alerts */}
      {runnerIdle && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span><strong>Runner idle:</strong> {bm.active_by_leases} Leases aktiv, aber 0 Jobs laufen.</span>
        </div>
      )}
      {orchestrationBug && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span><strong>Orchestrierungsbug:</strong> {bm.active_by_jobs} Jobs ohne Lease-Policy ({bm.active_by_leases} Leases).</span>
        </div>
      )}

      {/* Pipeline Overview – SSOT */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        <Metric icon={<Package className="h-3.5 w-3.5 text-muted-foreground" />} label="Gesamt" value={kpis.total_packages} sub={`${kpis.published} live`} />
        <Metric icon={<Server className="h-3.5 w-3.5 text-primary" />} label="Build (Leases)" value={bm.active_by_leases} sub="WIP-Slots" />
        <Metric icon={<Zap className="h-3.5 w-3.5 text-primary" />} label="Build (Jobs)" value={bm.active_by_jobs} sub="Runner aktiv" />
        <Metric icon={<Wrench className="h-3.5 w-3.5 text-destructive" />} label="Zombies" value={bm.zombies} alert={bm.zombies > 0} sub={bm.zombies > 0 ? 'Fix nötig' : 'Sauber'} />
        <Metric icon={<Clock className="h-3.5 w-3.5 text-muted-foreground" />} label="Queue" value={kpis.queued} />
        <Metric icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />} label="Published" value={kpis.published} />
        <Metric icon={<XCircle className="h-3.5 w-3.5 text-destructive" />} label="Failed" value={kpis.failed} alert={kpis.failed > 0} />
        <Metric icon={<TrendingUp className="h-3.5 w-3.5 text-primary" />} label="ETA Backlog" value={etaH > 0 ? `${etaH}h` : '—'} sub={`${Math.round(throughputPerH)} Jobs/h`} />
      </div>

      {/* Zombie Drawer Button */}
      {bm.zombies > 0 && (
        <Button variant="destructive" size="sm" onClick={() => setZombieDrawerOpen(true)} className="text-xs">
          <ShieldAlert className="h-3.5 w-3.5 mr-1" />
          {bm.zombies} Zombie-Package{bm.zombies > 1 ? 's' : ''} anzeigen
        </Button>
      )}

      {/* Job Queue + Cost */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Metric icon={<Clock className="h-3.5 w-3.5 text-muted-foreground" />} label="Jobs Pending" value={kpis.jobs_pending} />
        <Metric icon={<Zap className="h-3.5 w-3.5 text-primary" />} label="Processing" value={kpis.jobs_processing} />
        <Metric icon={<XCircle className="h-3.5 w-3.5 text-destructive" />} label="Jobs Failed" value={kpis.jobs_failed} alert={kpis.jobs_failed > 5} />
        <Metric icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />} label="Erledigt heute" value={kpis.jobs_completed_today} />
      </div>

      {/* Cost Card */}
      <Card>
        <CardContent className="py-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">KI-Kosten heute</span>
              </div>
              <p className="text-2xl font-bold font-mono">{fmtEur(kpis.cost_today_eur)}</p>
            </div>
            <div>
              <span className="text-sm text-muted-foreground">MTD</span>
              <p className="text-2xl font-bold font-mono">{fmtEur(kpis.cost_mtd_eur)}</p>
            </div>
            <div>
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span>Budget: {fmtEur(kpis.cost_mtd_eur)} / {fmtEur(kpis.budget_eur)}</span>
                <span className={cn(budgetPct > 80 && 'text-destructive font-bold')}>{budgetPct}%</span>
              </div>
              <Progress value={budgetPct} className={cn("h-2.5", budgetPct > 80 && "[&>div]:bg-destructive")} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Forensik */}
      <ForensikPanel />

      {/* Step Duration / Bottleneck Analysis */}
      <StepDurationPanel />

      {/* Building Packages Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Pakete im Build ({packages.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:p-0">
          {/* Desktop Table */}
          <div className="hidden sm:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Paket</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">Oral</TableHead>
                  <TableHead className="text-center">Tutor</TableHead>
                  <TableHead className="text-center">Handb.</TableHead>
                  <TableHead className="text-right pr-4">Fortschritt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {packages.map(pkg => <PackageRow key={pkg.id} pkg={pkg} />)}
              </TableBody>
            </Table>
          </div>
          {/* Mobile Cards */}
          <div className="sm:hidden space-y-2 p-3">
            {packages.map(pkg => <PackageCard key={pkg.id} pkg={pkg} />)}
          </div>
        </CardContent>
      </Card>

      {/* Zombie Drawer */}
      <Drawer open={zombieDrawerOpen} onOpenChange={setZombieDrawerOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              Zombie-Packages (building ohne Lease/Jobs)
            </DrawerTitle>
            <DrawerDescription>
              Diese Pakete sind als &quot;building&quot; markiert, haben aber weder aktive Leases noch Jobs. Auto-Heal oder manueller Reset empfohlen.
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-6 space-y-2 max-h-[50vh] overflow-y-auto">
            {(zombieRows || []).map(z => (
              <div key={z.package_id} className="border rounded-lg p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm truncate">{z.title || z.package_id.slice(0, 12)}</span>
                  <Badge variant="outline" className="text-[10px]">{z.build_progress}%</Badge>
                </div>
                <div className="text-[10px] text-muted-foreground font-mono">{z.package_id}</div>
                <div className="text-[10px] text-muted-foreground">
                  Letzter Fortschritt: {z.last_progress_at ? new Date(z.last_progress_at).toLocaleString('de-DE') : 'nie'}
                </div>
              </div>
            ))}
            {(!zombieRows || zombieRows.length === 0) && (
              <p className="text-sm text-muted-foreground text-center py-4">Keine Zombies – alles sauber ✅</p>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
