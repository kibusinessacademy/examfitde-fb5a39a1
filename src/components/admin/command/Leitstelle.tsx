import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useCommandData, type PipelinePackage } from '@/hooks/useCommandData';
import {
  Activity, CheckCircle2, Clock, DollarSign, Loader2, RefreshCw, XCircle,
  AlertTriangle, BookOpen, FileText, Brain, Mic, Package, TrendingUp, Zap,
} from 'lucide-react';

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

function ContentIcon({ ok, partial }: { ok: boolean; partial?: boolean }) {
  if (ok) return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  if (partial) return <Clock className="h-3.5 w-3.5 text-amber-500" />;
  return <XCircle className="h-3.5 w-3.5 text-destructive" />;
}

function PackageRow({ pkg }: { pkg: PipelinePackage }) {
  const stepsLabel = `${pkg.steps_done}/16`;
  const isStuck = pkg.steps_running === 0 && pkg.steps_failed === 0 && pkg.steps_done < 16;
  const lastUpdate = new Date(pkg.updated_at);
  const ageMin = Math.round((Date.now() - lastUpdate.getTime()) / 60000);
  const staleWarning = ageMin > 120;

  return (
    <TableRow className={cn(
      pkg.steps_failed > 0 && 'bg-destructive/5',
      pkg.steps_running > 0 && 'bg-primary/5',
    )}>
      <TableCell className="font-medium text-sm max-w-[200px] truncate">{pkg.name}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          {pkg.steps_running > 0 ? (
            <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">
              <Loader2 className="h-3 w-3 mr-0.5 animate-spin" />Step {(pkg.current_step || 0) + 1}
            </Badge>
          ) : staleWarning ? (
            <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-[10px]">
              <AlertTriangle className="h-3 w-3 mr-0.5" />Wartend
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">{stepsLabel}</Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right font-mono text-xs">{pkg.lessons}</TableCell>
      <TableCell className="text-right font-mono text-xs">{pkg.q_total}</TableCell>
      <TableCell className="text-center"><ContentIcon ok={pkg.step_generate_oral === 'done' && pkg.step_validate_oral === 'done'} partial={pkg.step_generate_oral === 'done'} /></TableCell>
      <TableCell className="text-center"><ContentIcon ok={pkg.step_build_tutor === 'done' && pkg.step_validate_tutor === 'done'} partial={pkg.step_build_tutor === 'done'} /></TableCell>
      <TableCell className="text-center"><ContentIcon ok={pkg.step_generate_handbook === 'done' && pkg.step_validate_handbook === 'done'} partial={pkg.step_generate_handbook === 'done'} /></TableCell>
      <TableCell className="text-right">
        <div className="flex items-center gap-1.5 justify-end">
          <Progress value={pkg.build_progress} className="h-1.5 w-14" />
          <span className="text-xs font-mono text-muted-foreground w-8 text-right">{pkg.build_progress}%</span>
        </div>
      </TableCell>
    </TableRow>
  );
}

function PackageCard({ pkg }: { pkg: PipelinePackage }) {
  return (
    <div className={cn(
      "border rounded-lg p-3 space-y-2",
      pkg.steps_failed > 0 && 'border-destructive/30 bg-destructive/5',
      pkg.steps_running > 0 && 'border-primary/30 bg-primary/5',
    )}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm truncate">{pkg.name}</span>
        <span className="text-xs font-mono text-muted-foreground">{pkg.build_progress}%</span>
      </div>
      <Progress value={pkg.build_progress} className="h-1.5" />
      <div className="grid grid-cols-5 gap-1 text-[10px] text-center text-muted-foreground">
        <div><span className="font-mono font-bold text-foreground">{pkg.lessons}</span><br/>Lekt.</div>
        <div><span className="font-mono font-bold text-foreground">{pkg.q_total}</span><br/>Fragen</div>
        <div><ContentIcon ok={pkg.step_generate_oral === 'done' && pkg.step_validate_oral === 'done'} partial={pkg.step_generate_oral === 'done'} /><br/>Oral</div>
        <div><ContentIcon ok={pkg.step_build_tutor === 'done' && pkg.step_validate_tutor === 'done'} partial={pkg.step_build_tutor === 'done'} /><br/>Tutor</div>
        <div><ContentIcon ok={pkg.step_generate_handbook === 'done' && pkg.step_validate_handbook === 'done'} partial={pkg.step_generate_handbook === 'done'} /><br/>Handb.</div>
      </div>
    </div>
  );
}

export default function Leitstelle() {
  const { packages, kpis, loading, lastRefresh, refetch } = useCommandData();

  if (loading) return (
    <div className="space-y-4">
      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
    </div>
  );

  if (!kpis) return null;

  const budgetPct = kpis.budget_eur > 0 ? Math.round((kpis.cost_mtd_eur / kpis.budget_eur) * 100) : 0;
  const throughputPerH = kpis.jobs_completed_today / Math.max(new Date().getHours(), 1);
  const etaH = throughputPerH > 0 ? Math.round((kpis.jobs_pending / throughputPerH) * 10) / 10 : 0;

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

      {/* Pipeline Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Metric
          icon={<Package className="h-3.5 w-3.5 text-muted-foreground" />}
          label="Gesamt" value={kpis.total_packages}
          sub={`${kpis.published} live`}
        />
        <Metric
          icon={<Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />}
          label="Building" value={kpis.building}
        />
        <Metric
          icon={<Clock className="h-3.5 w-3.5 text-muted-foreground" />}
          label="Queue" value={kpis.queued}
        />
        <Metric
          icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
          label="Published" value={kpis.published}
        />
        <Metric
          icon={<XCircle className="h-3.5 w-3.5 text-destructive" />}
          label="Failed" value={kpis.failed} alert={kpis.failed > 0}
        />
        <Metric
          icon={<TrendingUp className="h-3.5 w-3.5 text-primary" />}
          label="ETA Backlog" value={etaH > 0 ? `${etaH}h` : '—'}
          sub={`${Math.round(throughputPerH)} Jobs/h`}
        />
      </div>

      {/* Job Queue + Cost */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Metric
          icon={<Clock className="h-3.5 w-3.5 text-muted-foreground" />}
          label="Jobs Pending" value={kpis.jobs_pending}
        />
        <Metric
          icon={<Zap className="h-3.5 w-3.5 text-primary" />}
          label="Processing" value={kpis.jobs_processing}
        />
        <Metric
          icon={<XCircle className="h-3.5 w-3.5 text-destructive" />}
          label="Jobs Failed" value={kpis.jobs_failed}
          alert={kpis.jobs_failed > 5}
        />
        <Metric
          icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
          label="Erledigt heute" value={kpis.jobs_completed_today}
        />
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

      {/* Content Metrics Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Metric
          icon={<FileText className="h-3.5 w-3.5 text-muted-foreground" />}
          label="Lektionen (building)" value={kpis.total_lessons}
        />
        <Metric
          icon={<BookOpen className="h-3.5 w-3.5 text-muted-foreground" />}
          label="Fragen gesamt" value={kpis.total_questions}
          sub={`${kpis.total_approved} approved`}
        />
        <Metric
          icon={<Mic className="h-3.5 w-3.5 text-muted-foreground" />}
          label="Oral-Exam Sets" value={packages.filter(p => p.oral_sets > 0).length}
          sub={`von ${packages.length} Paketen`}
        />
        <Metric
          icon={<Brain className="h-3.5 w-3.5 text-muted-foreground" />}
          label="AI-Tutor Indizes" value={packages.filter(p => p.tutor_index > 0).length}
          sub={`von ${packages.length} Paketen`}
        />
      </div>

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
                  <TableHead className="text-right">Lekt.</TableHead>
                  <TableHead className="text-right">Fragen</TableHead>
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
    </div>
  );
}
