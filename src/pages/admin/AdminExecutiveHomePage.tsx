import { Link } from 'react-router-dom';
import { useAdminDashboard } from '@/components/admin/hooks/useAdminDashboard';
import { useCanonicalTitles, resolveTitle } from '@/hooks/useCanonicalTitles';
import { cn } from '@/lib/utils';
import {
  BookOpen, Brain, CircleDollarSign, GraduationCap,
  Loader2, Search, ShieldCheck, Users, Wrench,
  AlertTriangle, Zap, Clock, CheckCircle, XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { FULL_STEP_ORDER as STEP_ORDER, PIPELINE_STEP_LABELS as STEP_LABELS } from '@/lib/pipeline-steps';
import type { DashboardKpis, DashboardBuildingPackage, GlobalHealthItem } from '@/components/admin/lib/admin-types';

function fmtEur(v: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(v || 0);
}

function SmallStat({ label, value, tone = 'default' }: {
  label: string; value: string | number; tone?: 'default' | 'danger' | 'warning' | 'success';
}) {
  return (
    <div className={cn(
      'rounded-xl border px-3 py-3',
      tone === 'default' && 'border-border/70 bg-background/50',
      tone === 'danger' && 'border-destructive/30 bg-destructive/5',
      tone === 'warning' && 'border-amber-500/30 bg-amber-500/5',
      tone === 'success' && 'border-emerald-500/30 bg-emerald-500/5',
    )}>
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function HealthBar({ items }: { items: GlobalHealthItem[] }) {
  return (
    <div className="flex flex-wrap gap-2 mb-5">
      {items.map((item) => {
        const toneClass = item.tone === 'green' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
          : item.tone === 'yellow' ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
          : item.tone === 'red' ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'border-border bg-muted/30 text-muted-foreground';
        return (
          <div key={item.key} className={`rounded-full border px-3 py-1.5 text-xs font-medium ${toneClass}`}>
            <span className="mr-2 opacity-80">{item.label}</span>
            <span className="font-semibold">{item.count}</span>
          </div>
        );
      })}
    </div>
  );
}

function BuildingPackageRow({ pkg }: { pkg: DashboardBuildingPackage }) {
  const stepStatuses = pkg.step_status_json || {};
  return (
    <div className="rounded-xl border border-border/70 bg-background/50 p-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <Link to={`/admin/studio/${pkg.id}`} className="text-sm font-medium hover:text-primary transition-colors truncate">
          {pkg.title || pkg.id.slice(0, 12)}
        </Link>
        <div className="flex items-center gap-2 shrink-0">
          <Progress value={pkg.build_progress} className="h-1.5 w-16" />
          <span className="text-xs font-mono text-muted-foreground w-8 text-right">{pkg.build_progress}%</span>
        </div>
      </div>
      <div className="flex gap-0.5">
        {STEP_ORDER.map(step => {
          const s = stepStatuses[step];
          return (
            <div key={step} className={cn(
              "w-4 h-2 rounded-sm",
              s === 'done' || s === 'skipped' ? 'bg-emerald-500' :
              s === 'running' || s === 'enqueued' || s === 'processing' ? 'bg-primary animate-pulse' :
              s === 'failed' ? 'bg-destructive' : 'bg-muted'
            )} title={`${STEP_LABELS[step] || step}: ${s || 'ausstehend'}`} />
          );
        })}
      </div>
    </div>
  );
}

export default function AdminExecutiveHomePage() {
  const { data, isLoading, error, dataUpdatedAt } = useAdminDashboard();

  if (isLoading) {
    return (
      <div className="space-y-4 pb-24">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
        Fehler beim Laden: {(error as Error).message}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Admin-Startseite lädt…
      </div>
    );
  }

  const k = data.kpis;
  const bm = k.building_metrics;
  const riskBuild = (bm.active_by_leases > 0 && bm.active_by_jobs === 0 ? 1 : 0) + (k.failed > 0 ? 1 : 0);

  return (
    <div className="space-y-5 pb-24">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Admin-Startseite</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            SSOT Executive-Übersicht · Alle Daten live aus der Datenbank
          </p>
        </div>
        <div className="text-right text-sm text-muted-foreground">
          <div>aktualisiert</div>
          <div className="font-medium text-foreground">{new Date(dataUpdatedAt).toLocaleTimeString('de-DE')}</div>
        </div>
      </div>

      {/* Health bar */}
      <HealthBar items={data.health} />

      {/* Priority alerts derived from SSOT KPIs */}
      {(riskBuild > 0 || k.lc_starvation > 0 || k.blocked_publishables > 5 || k.open_claim_issues > 0) && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Geschäftsrelevante Prioritäten
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {bm.active_by_leases > 0 && bm.active_by_jobs === 0 && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                <div className="font-medium">Produktion steht trotz aktiver Leases</div>
                <div className="text-sm text-muted-foreground">{bm.active_by_leases} Leases aktiv, aber keine laufenden Build-Jobs.</div>
              </div>
            )}
            {k.lc_starvation > 0 && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                <div className="font-medium">{k.lc_starvation} Pakete mit Content-Starvation</div>
                <div className="text-sm text-muted-foreground">Building-Pakete ohne aktive Content-Jobs.</div>
              </div>
            )}
            {k.blocked_publishables > 5 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="font-medium">{k.blocked_publishables} Publish-Blocker</div>
                <div className="text-sm text-muted-foreground">Pakete nicht publish-ready.</div>
              </div>
            )}
            {k.open_claim_issues > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="font-medium">{k.open_claim_issues} Claim-Probleme</div>
                <div className="text-sm text-muted-foreground">Lizenz-Issues mit Umsatzwirkung.</div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Top KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SmallStat label="Produktion" value={k.building} tone={riskBuild > 0 ? 'danger' : 'success'} />
        <SmallStat label="Queue" value={k.queued} />
        <SmallStat label="Erledigt heute" value={k.jobs_completed_today} tone="success" />
        <SmallStat label="KI-Kosten heute" value={fmtEur(k.cost_today_eur)} />
      </div>

      {/* Section cards */}
      <div className="grid gap-4 xl:grid-cols-2">
        {/* Leitstelle */}
        <Card className={cn('border-border/70 bg-card/70', riskBuild > 0 && 'border-destructive/30 bg-destructive/5')}>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Wrench className="h-4 w-4 text-primary" />
                  Leitstelle
                </CardTitle>
                <div className="mt-1 text-sm text-muted-foreground">Runner, Queue, Builds & Bottlenecks</div>
              </div>
              <Badge variant={riskBuild > 0 ? 'destructive' : 'outline'}>
                {riskBuild > 0 ? 'Aktion nötig' : 'Stabil'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <SmallStat label="Leases aktiv" value={bm.active_by_leases} />
              <SmallStat label="Jobs aktiv" value={bm.active_by_jobs} />
              <SmallStat label="Zombies" value={bm.zombies} tone={bm.zombies > 0 ? 'warning' : 'success'} />
              <SmallStat label="Failed" value={k.failed} tone={k.failed > 0 ? 'danger' : 'success'} />
            </div>
            <Button asChild variant="outline" className="w-full justify-between">
              <Link to="/admin/control-tower">Leitstelle öffnen <span>→</span></Link>
            </Button>
          </CardContent>
        </Card>

        {/* Umsatz */}
        <Card className={cn('border-border/70 bg-card/70', k.open_claim_issues > 0 && 'border-amber-500/30 bg-amber-500/5')}>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CircleDollarSign className="h-4 w-4 text-primary" />
                  Umsatz & Commerce
                </CardTitle>
                <div className="mt-1 text-sm text-muted-foreground">30-Tage-Umsatz und Claim-Probleme</div>
              </div>
              <Badge variant="outline">{fmtEur(k.revenue_30d)}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <SmallStat label="Claim-Probleme" value={k.open_claim_issues} tone={k.open_claim_issues > 0 ? 'warning' : 'success'} />
              <SmallStat label="30 Tage" value={fmtEur(k.revenue_30d)} />
            </div>
            <Button asChild variant="outline" className="w-full justify-between">
              <Link to="/admin/revenue">Umsatz öffnen <span>→</span></Link>
            </Button>
          </CardContent>
        </Card>

        {/* SEO & Publish */}
        <Card className={cn('border-border/70 bg-card/70', k.blocked_publishables > 0 && 'border-amber-500/30 bg-amber-500/5')}>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Search className="h-4 w-4 text-primary" />
                  SEO & Publish
                </CardTitle>
                <div className="mt-1 text-sm text-muted-foreground">Publish-Blocker und Vermarktungsfähigkeit</div>
              </div>
              <Badge variant={k.blocked_publishables > 0 ? 'secondary' : 'outline'}>
                {k.blocked_publishables} Blocker
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span>Publish Readiness</span>
                <span className="text-muted-foreground">
                  {k.total_packages > 0 ? `${Math.max(0, Math.round(((k.total_packages - k.blocked_publishables) / k.total_packages) * 100))}%` : '–'}
                </span>
              </div>
              <Progress value={k.total_packages > 0 ? Math.max(0, ((k.total_packages - k.blocked_publishables) / k.total_packages) * 100) : 0} className="h-2" />
            </div>
            <SmallStat label="Blockierte Pakete" value={k.blocked_publishables} tone={k.blocked_publishables > 0 ? 'warning' : 'success'} />
            <Button asChild variant="outline" className="w-full justify-between">
              <Link to="/admin/packages/risk">Risiken öffnen <span>→</span></Link>
            </Button>
          </CardContent>
        </Card>

        {/* Content & Qualität */}
        <Card className={cn('border-border/70 bg-card/70', k.stalled_packages > 0 && 'border-amber-500/30 bg-amber-500/5')}>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Brain className="h-4 w-4 text-primary" />
                  Content & Qualität
                </CardTitle>
                <div className="mt-1 text-sm text-muted-foreground">Build-Tiefe, Stalls und Qualitätssicherung</div>
              </div>
              <Badge variant="outline">{k.stalled_packages} stalled</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <SmallStat label="Im Build" value={k.building} />
              <SmallStat label="Stalled" value={k.stalled_packages} tone={k.stalled_packages > 0 ? 'warning' : 'success'} />
              <SmallStat label="Content Starvation" value={k.lc_starvation} tone={k.lc_starvation > 0 ? 'danger' : 'success'} />
              <SmallStat label="Provider Cooldowns" value={k.provider_cooldowns} tone={k.provider_cooldowns > 0 ? 'warning' : 'success'} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Building packages */}
      {data.building_packages.length > 0 && (
        <Card className="border-border/70 bg-card/70">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <GraduationCap className="h-4 w-4 text-primary" />
              Aktive Builds ({data.building_packages.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.building_packages.map((pkg) => (
              <BuildingPackageRow key={pkg.id} pkg={pkg} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Pipeline overview */}
      {data.pipeline.length > 0 && (
        <Card className="border-border/70 bg-card/70">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pipeline (SSOT)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.pipeline.map((step) => {
              const total = step.queued + step.running + step.done + step.failed;
              const donePct = total > 0 ? (step.done / total) * 100 : 0;
              return (
                <div key={step.step_key} className="rounded-xl border border-border/50 bg-muted/20 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">{STEP_LABELS[step.step_key] || step.step_key}</span>
                    <span className="text-xs text-muted-foreground">{donePct.toFixed(0)}%</span>
                  </div>
                  <Progress value={donePct} className="h-1.5 mb-2" />
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    <div className="rounded-lg bg-muted px-2 py-1 text-muted-foreground">Q: {step.queued}</div>
                    <div className="rounded-lg bg-muted px-2 py-1 text-blue-400">R: {step.running}</div>
                    <div className="rounded-lg bg-muted px-2 py-1 text-emerald-400">D: {step.done}</div>
                    <div className="rounded-lg bg-muted px-2 py-1 text-rose-400">F: {step.failed}</div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <Card className="border-border/70 bg-card/70">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Admin-Navigation
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <Button asChild variant="outline" className="justify-between">
            <Link to="/admin/control-tower">Leitstelle <Wrench className="h-4 w-4" /></Link>
          </Button>
          <Button asChild variant="outline" className="justify-between">
            <Link to="/admin/packages/risk">Paket-Risiken <Brain className="h-4 w-4" /></Link>
          </Button>
          <Button asChild variant="outline" className="justify-between">
            <Link to="/admin/revenue">Umsatz & Claims <Users className="h-4 w-4" /></Link>
          </Button>
          <Button asChild variant="outline" className="justify-between">
            <Link to="/admin/providers">Provider Health <BookOpen className="h-4 w-4" /></Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
