import { useQuery } from '@tanstack/react-query';
import { adminRpc } from '@/integrations/supabase/admin-rpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  Activity, DollarSign, Target, Zap, AlertTriangle,
  Package, Clock, TrendingUp, ShieldAlert, CheckCircle2
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';

type Signal = 'green' | 'yellow' | 'red' | 'neutral';

const signalColor: Record<Signal, string> = {
  green: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  yellow: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  red: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  neutral: 'bg-muted text-muted-foreground border-border',
};

const signalDot: Record<Signal, string> = {
  green: 'bg-emerald-400',
  yellow: 'bg-amber-400',
  red: 'bg-rose-400',
  neutral: 'bg-muted-foreground',
};

const signalLabel: Record<Signal, string> = {
  green: '🟢',
  yellow: '🟡',
  red: '🔴',
  neutral: '⚪',
};

function SignalBadge({ signal, label }: { signal: Signal; label: string }) {
  return (
    <Badge variant="outline" className={cn('gap-1.5 text-xs font-medium', signalColor[signal])}>
      <span className={cn('inline-block h-2 w-2 rounded-full', signalDot[signal])} />
      {label}
    </Badge>
  );
}

function KPIBlock({
  icon, title, value, unit, signal, details, target,
}: {
  icon: React.ReactNode; title: string; value: string | number;
  unit?: string; signal: Signal; details?: string; target?: string;
}) {
  return (
    <Card className={cn('border', signal === 'red' ? 'border-destructive/40' : 'border-border')}>
      <CardContent className="py-4 px-5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
            {icon} {title}
          </div>
          <SignalBadge signal={signal} label={signal === 'green' ? 'Healthy' : signal === 'yellow' ? 'Warning' : signal === 'red' ? 'Critical' : '—'} />
        </div>
        <div className="text-3xl font-bold tracking-tight text-foreground">
          {value}<span className="text-base font-normal text-muted-foreground ml-1">{unit}</span>
        </div>
        {target && <p className="text-[10px] text-muted-foreground mt-1">Ziel: {target}</p>}
        {details && <p className="text-xs text-muted-foreground mt-1">{details}</p>}
      </CardContent>
    </Card>
  );
}

function CostBlock({ d }: { d: Record<string, any> }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-muted-foreground" /> Kostenübersicht
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-4 text-center">
        <div>
          <p className="text-[10px] uppercase text-muted-foreground">24h</p>
          <p className="text-lg font-bold">€{Number(d.cost_24h_eur).toFixed(2)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-muted-foreground">7 Tage</p>
          <p className="text-lg font-bold">€{Number(d.cost_7d_eur).toFixed(2)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-muted-foreground">Gesamt</p>
          <p className="text-lg font-bold">€{Number(d.cost_total_eur).toFixed(2)}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function PipelineBlock({ d }: { d: Record<string, any> }) {
  const items = [
    { label: 'Building', val: d.pkg_building, color: 'text-blue-400' },
    { label: 'Queued', val: d.pkg_queued, color: 'text-muted-foreground' },
    { label: 'Blocked', val: d.pkg_blocked, color: 'text-rose-400' },
    { label: 'Completed', val: d.pkg_completed, color: 'text-emerald-400' },
    { label: 'Failed', val: d.pkg_failed, color: 'text-destructive' },
  ];
  const total = Number(d.pkg_total) || 1;
  const completedPct = ((Number(d.pkg_completed) / total) * 100).toFixed(1);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Package className="h-4 w-4 text-muted-foreground" /> Pipeline-Status ({d.pkg_total} Pakete)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-1 h-3 rounded-full overflow-hidden mb-3">
          {Number(d.pkg_completed) > 0 && (
            <div className="bg-emerald-500" style={{ width: `${(Number(d.pkg_completed) / total) * 100}%` }} />
          )}
          {Number(d.pkg_building) > 0 && (
            <div className="bg-blue-500" style={{ width: `${(Number(d.pkg_building) / total) * 100}%` }} />
          )}
          {Number(d.pkg_blocked) > 0 && (
            <div className="bg-rose-500" style={{ width: `${(Number(d.pkg_blocked) / total) * 100}%` }} />
          )}
          {Number(d.pkg_queued) > 0 && (
            <div className="bg-muted-foreground/30" style={{ width: `${(Number(d.pkg_queued) / total) * 100}%` }} />
          )}
        </div>
        <div className="grid grid-cols-5 gap-2 text-center text-xs">
          {items.map(i => (
            <div key={i.label}>
              <p className={cn('text-lg font-bold', i.color)}>{i.val}</p>
              <p className="text-muted-foreground">{i.label}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2 text-center">{completedPct}% abgeschlossen</p>
      </CardContent>
    </Card>
  );
}

function ETABlock({ d }: { d: Record<string, any> }) {
  const eta = d.eta_days ? Number(d.eta_days) : null;
  const tph = Number(d.throughput_per_hour) || 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" /> ETA & Throughput
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-4 text-center">
        <div>
          <p className="text-[10px] uppercase text-muted-foreground">Jobs/h (2h)</p>
          <p className="text-lg font-bold">{tph}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-muted-foreground">Jobs 2h</p>
          <p className="text-lg font-bold">{d.throughput_2h}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-muted-foreground">ETA (Tage)</p>
          <p className={cn('text-lg font-bold', eta && eta > 21 ? 'text-rose-400' : eta && eta > 14 ? 'text-amber-400' : 'text-emerald-400')}>
            {eta ? `~${eta}` : '—'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function CriticalFindings({ d }: { d: Record<string, any> }) {
  const findings: { icon: React.ReactNode; label: string; signal: Signal }[] = [];

  if (Number(d.building_without_job) > 0) {
    findings.push({
      icon: <ShieldAlert className="h-4 w-4" />,
      label: `${d.building_without_job} Building-Pakete ohne aktiven Job (Fake-WIP)`,
      signal: Number(d.building_without_job) > 2 ? 'red' : 'yellow',
    });
  }
  if (Number(d.pkg_blocked) > 0) {
    findings.push({
      icon: <AlertTriangle className="h-4 w-4" />,
      label: `${d.pkg_blocked} blockierte Pakete (Loop-Guard / exam-pool)`,
      signal: 'red',
    });
  }
  if (Number(d.pkg_completed) === 0) {
    findings.push({
      icon: <Target className="h-4 w-4" />,
      label: 'Noch kein Paket published — End-to-End nicht validiert',
      signal: 'red',
    });
  }
  if (Number(d.total_failed_24h) > 10) {
    findings.push({
      icon: <AlertTriangle className="h-4 w-4" />,
      label: `${d.total_failed_24h} fehlgeschlagene Jobs in 24h`,
      signal: 'yellow',
    });
  }

  if (findings.length === 0) {
    findings.push({
      icon: <CheckCircle2 className="h-4 w-4" />,
      label: 'Keine kritischen Befunde',
      signal: 'green',
    });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" /> Kritische Befunde
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {findings.map((f, i) => (
          <div key={i} className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-sm', signalColor[f.signal])}>
            {f.icon}
            {f.label}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function ExecutiveReportDashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'executive-kpis'],
    queryFn: adminRpc.executiveKpis,
    refetchInterval: 20_000,
    staleTime: 15_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
        Fehler: {(error as Error).message}
      </div>
    );
  }

  if (!data) return null;
  const d = data as Record<string, any>;
  const overall = (d.overall_signal || 'neutral') as Signal;

  return (
    <div className="space-y-6">
      {/* Overall Status Banner */}
      <div className={cn('rounded-2xl border p-4 flex items-center gap-3', signalColor[overall])}>
        <span className="text-2xl">{signalLabel[overall]}</span>
        <div>
          <p className="font-semibold text-sm">
            Gesamtstatus: {overall === 'green' ? 'Pipeline gesund' : overall === 'yellow' ? 'Einschränkungen – beobachtungsbedürftig' : 'Kritische Probleme – Eingriff nötig'}
          </p>
          <p className="text-xs opacity-80">Echtzeit-KPIs aus der Produktion · Auto-Refresh 20s</p>
        </div>
      </div>

      {/* 3 Core KPIs */}
      <div className="grid gap-4 md:grid-cols-3">
        <KPIBlock
          icon={<Activity className="h-3.5 w-3.5" />}
          title="Runner Utilization"
          value={d.runner_utilization_pct}
          unit="%"
          signal={d.runner_utilization_signal as Signal}
          details={`${d.active_jobs}/${d.max_slots} Slots aktiv · ${d.building_without_job} Fake-WIP`}
          target="≥ 85%"
        />
        <KPIBlock
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          title="Jobs / Package"
          value={Number(d.avg_jobs_per_package).toFixed(1)}
          unit="avg"
          signal={d.jobs_per_package_signal as Signal}
          details={`Median: ${Number(d.median_jobs_per_package).toFixed(0)} · Sample: ${d.completed_package_sample}`}
          target="≤ 25"
        />
        <KPIBlock
          icon={<Zap className="h-3.5 w-3.5" />}
          title="First-Pass Yield"
          value={d.first_pass_yield_pct}
          unit="%"
          signal={d.first_pass_yield_signal as Signal}
          details={`${d.first_pass_jobs_24h}/${d.total_completed_24h} Jobs ohne Retry (24h)`}
          target="≥ 80%"
        />
      </div>

      {/* Details */}
      <div className="grid gap-4 md:grid-cols-2">
        <PipelineBlock d={d} />
        <ETABlock d={d} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <CostBlock d={d} />
        <CriticalFindings d={d} />
      </div>

      {/* Executive Summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">📊 Executive Summary</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Auf Basis der letzten 2 Stunden liegt der Durchsatz bei <strong className="text-foreground">{d.throughput_per_hour} Jobs/h</strong>.
            {' '}Bei {Number(d.pkg_total) - Number(d.pkg_completed)} verbleibenden Paketen ergibt sich eine geschätzte Restlaufzeit
            von <strong className="text-foreground">~{d.eta_days ?? '—'} Tagen</strong>.
          </p>
          <p>
            Die Gesamtkosten betragen bisher <strong className="text-foreground">€{Number(d.cost_total_eur).toFixed(2)}</strong>.
            {' '}Hochrechnung Restproduktion: <strong className="text-foreground">€300–600</strong> (szenariobasiert).
          </p>
          {Number(d.pkg_blocked) > 0 && (
            <p className="text-destructive">
              ⚠️ {d.pkg_blocked} blockierte Pakete erfordern manuellen Eingriff. Diese verzögern die Gesamtproduktion
              und können die ETA um 30–50% verlängern.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
