import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCommandData } from '@/hooks/useCommandData';
import { cn } from '@/lib/utils';
import {
  BookOpen,
  Brain,
  CircleDollarSign,
  GraduationCap,
  LifeBuoy,
  Loader2,
  Search,
  ShieldCheck,
  Users,
  Wrench,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';

type JsonRow = Record<string, unknown>;

type ExecutiveAlert = {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  href?: string;
};

function fmtEur(v: number) {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  }).format(v || 0);
}

function SectionCard({
  title,
  subtitle,
  icon,
  href,
  tone = 'default',
  metric,
  children,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  href?: string;
  tone?: 'default' | 'danger' | 'warning' | 'success';
  metric?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card
      className={cn(
        'border-border/70 bg-card/70',
        tone === 'danger' && 'border-destructive/30 bg-destructive/5',
        tone === 'warning' && 'border-amber-500/30 bg-amber-500/5',
        tone === 'success' && 'border-emerald-500/30 bg-emerald-500/5',
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              {icon}
              <span>{title}</span>
            </CardTitle>
            <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>
          </div>
          {metric ? <div className="shrink-0">{metric}</div> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {children}
        {href ? (
          <Button asChild variant="outline" className="w-full justify-between">
            <Link to={href}>
              Bereich öffnen
              <span>→</span>
            </Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SmallStat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  tone?: 'default' | 'danger' | 'warning' | 'success';
}) {
  return (
    <div
      className={cn(
        'rounded-xl border px-3 py-3',
        tone === 'default' && 'border-border/70 bg-background/50',
        tone === 'danger' && 'border-destructive/30 bg-destructive/5',
        tone === 'warning' && 'border-amber-500/30 bg-amber-500/5',
        tone === 'success' && 'border-emerald-500/30 bg-emerald-500/5',
      )}
    >
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function AlertStack({ alerts }: { alerts: ExecutiveAlert[] }) {
  return (
    <Card className="border-border/70 bg-card/70">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Geschäftsrelevante Prioritäten</CardTitle>
          <Badge variant="outline">{alerts.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {alerts.length === 0 ? (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm text-emerald-600">
            Keine akuten Prioritäten. Startseite ist sauber.
          </div>
        ) : (
          alerts.map((alert) => (
            <div
              key={alert.id}
              className={cn(
                'rounded-xl border p-3',
                alert.severity === 'critical' && 'border-destructive/30 bg-destructive/5',
                alert.severity === 'warning' && 'border-amber-500/30 bg-amber-500/5',
                alert.severity === 'info' && 'border-border/70 bg-background/50',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium leading-tight">{alert.title}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{alert.detail}</div>
                </div>
                {alert.href ? (
                  <Button asChild size="sm" variant="outline" className="shrink-0">
                    <Link to={alert.href}>Öffnen</Link>
                  </Button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminExecutiveHomePage() {
  const { kpis, packages, loading, lastRefresh } = useCommandData();

  const { data: supportSignals = [], isLoading: supportLoading } = useQuery({
    queryKey: ['admin-home-support-signals'],
    queryFn: async () => {
      const sb = supabase as any;
      const { data, error } = await sb
        .from('license_claims')
        .select('id,status,created_at')
        .in('status', ['failed', 'conflict', 'pending_manual_review'])
        .limit(50);
      if (error) return [] as JsonRow[];
      return (data ?? []) as JsonRow[];
    },
    refetchInterval: 60000,
    staleTime: 20000,
  });

  const { data: seoSignals = [], isLoading: seoLoading } = useQuery({
    queryKey: ['admin-home-seo-signals'],
    queryFn: async () => {
      const sb = supabase as any;
      const { data, error } = await sb
        .from('v_package_publish_readiness')
        .select('package_id,publish_ready')
        .eq('publish_ready', false)
        .limit(100);
      if (error) return [] as JsonRow[];
      return (data ?? []) as JsonRow[];
    },
    refetchInterval: 60000,
    staleTime: 20000,
  });

  const { data: learnerSignals = [], isLoading: learnerLoading } = useQuery({
    queryKey: ['admin-home-learner-signals'],
    queryFn: async () => {
      const sb = supabase as any;
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await sb
        .from('exam_attempts')
        .select('id,score,created_at')
        .gte('created_at', since)
        .limit(200);
      if (error) return [] as JsonRow[];
      return (data ?? []) as JsonRow[];
    },
    refetchInterval: 60000,
    staleTime: 20000,
  });

  const { data: revenueSignals = [], isLoading: revenueLoading } = useQuery({
    queryKey: ['admin-home-revenue-signals'],
    queryFn: async () => {
      const sb = supabase as any;
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await sb
        .from('orders')
        .select('id,total_amount,amount,created_at')
        .gte('created_at', since)
        .limit(500);
      if (error) return [] as JsonRow[];
      return (data ?? []) as JsonRow[];
    },
    refetchInterval: 60000,
    staleTime: 20000,
  });

  const derived = useMemo(() => {
    const riskBuild = kpis
      ? (kpis.building_metrics.active_by_leases > 0 && kpis.building_metrics.active_by_jobs === 0 ? 1 : 0) +
        (kpis.failed > 0 ? 1 : 0)
      : 0;

    const criticalPackages = packages.filter((pkg) => pkg.build_progress < 40).length;
    const supportIssues = supportSignals.length;
    const publishBlockers = seoSignals.length;

    const lowScores = learnerSignals.filter((x) => typeof x.score === 'number' && x.score < 50).length;
    const avgScore = learnerSignals.length
      ? Math.round(
          learnerSignals.reduce((sum, x) => sum + (typeof x.score === 'number' ? x.score : 0), 0) /
            learnerSignals.length,
        )
      : 0;

    const revenue30d = revenueSignals.reduce((sum, row) => {
      if (typeof row.total_amount === 'number') return sum + row.total_amount;
      if (typeof row.amount === 'number') return sum + row.amount;
      return sum;
    }, 0);

    const alerts: ExecutiveAlert[] = [];

    if (kpis && kpis.building_metrics.active_by_leases > 0 && kpis.building_metrics.active_by_jobs === 0) {
      alerts.push({
        id: 'runner-idle',
        severity: 'critical',
        title: 'Produktion steht trotz aktiver Leases',
        detail: `${kpis.building_metrics.active_by_leases} Leases aktiv, aber keine laufenden Build-Jobs.`,
        href: '/admin/control-tower',
      });
    }

    if (publishBlockers > 0) {
      alerts.push({
        id: 'publish-blocked',
        severity: publishBlockers > 10 ? 'critical' : 'warning',
        title: `${publishBlockers} Publish-Blocker`,
        detail: 'Pakete sind noch nicht publish-ready und blockieren Rollout oder Vermarktung.',
        href: '/admin/packages/risk',
      });
    }

    if (supportIssues > 0) {
      alerts.push({
        id: 'support-issues',
        severity: supportIssues > 5 ? 'warning' : 'info',
        title: `${supportIssues} Claim- oder Zugriffsprobleme`,
        detail: 'Lizenz- und Zugriffsprobleme sollten vor Wachstum und Marketing bereinigt werden.',
        href: '/admin/revenue',
      });
    }

    if (lowScores > 0) {
      alerts.push({
        id: 'learner-risk',
        severity: lowScores > 20 ? 'warning' : 'info',
        title: `${lowScores} schwache Prüfungssignale`,
        detail: `Niedrige Scores in den letzten 7 Tagen. Durchschnitt aktuell bei ${avgScore} Punkten.`,
      });
    }

    return {
      riskBuild,
      criticalPackages,
      supportIssues,
      publishBlockers,
      lowScores,
      avgScore,
      revenue30d,
      alerts: alerts.slice(0, 5),
    };
  }, [kpis, packages, supportSignals, seoSignals, learnerSignals, revenueSignals]);

  if (loading) {
    return (
      <div className="space-y-4 pb-24">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (!kpis) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Admin-Startseite lädt…
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-24">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Admin-Startseite</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Executive-Übersicht für Produktion, Lernwirksamkeit, Umsatz, SEO und Service.
          </p>
        </div>
        <div className="text-right text-sm text-muted-foreground">
          <div>aktualisiert</div>
          <div className="font-medium text-foreground">{lastRefresh.toLocaleTimeString('de-DE')}</div>
        </div>
      </div>

      <AlertStack alerts={derived.alerts} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SmallStat label="Produktion" value={kpis.building} tone={derived.riskBuild > 0 ? 'danger' : 'success'} />
        <SmallStat label="Queue" value={kpis.queued} />
        <SmallStat label="Erledigt heute" value={kpis.jobs_completed_today} tone="success" />
        <SmallStat label="KI-Kosten heute" value={fmtEur(kpis.cost_today_eur)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard
          title="Leitstelle"
          subtitle="Aktuelle Systemlage, Runner, Queue, Builds und operative Bottlenecks."
          icon={<Wrench className="h-4 w-4 text-primary" />}
          href="/admin/control-tower"
          tone={derived.riskBuild > 0 ? 'danger' : 'default'}
          metric={
            <Badge variant={derived.riskBuild > 0 ? 'destructive' : 'outline'}>
              {derived.riskBuild > 0 ? 'Aktion nötig' : 'Stabil'}
            </Badge>
          }
        >
          <div className="grid grid-cols-2 gap-2">
            <SmallStat label="Leases aktiv" value={kpis.building_metrics.active_by_leases} />
            <SmallStat label="Jobs aktiv" value={kpis.building_metrics.active_by_jobs} />
            <SmallStat label="Zombies" value={kpis.building_metrics.zombies} tone={kpis.building_metrics.zombies > 0 ? 'warning' : 'success'} />
            <SmallStat label="Failed" value={kpis.failed} tone={kpis.failed > 0 ? 'danger' : 'success'} />
          </div>
        </SectionCard>

        <SectionCard
          title="Lernende & Prüfungsreife"
          subtitle="Frühe Lerner-Signale, schwache Scores und Aktivitätsqualität."
          icon={<GraduationCap className="h-4 w-4 text-primary" />}
          tone={derived.lowScores > 20 ? 'warning' : 'default'}
          metric={<Badge variant="outline">{learnerLoading ? '…' : `${derived.avgScore} Ø`}</Badge>}
        >
          <div className="grid grid-cols-2 gap-2">
            <SmallStat
              label="Schwache Scores"
              value={learnerLoading ? '…' : derived.lowScores}
              tone={derived.lowScores > 20 ? 'warning' : 'default'}
            />
            <SmallStat label="Durchschnitt" value={learnerLoading ? '…' : derived.avgScore} />
          </div>
          <div className="rounded-xl border border-border/70 bg-background/50 p-3 text-sm text-muted-foreground">
            Dieser Block sollte als nächstes an echte Mastery-, Simulation- und Drop-off-Daten angeschlossen werden.
          </div>
        </SectionCard>

        <SectionCard
          title="Umsatz & Commerce"
          subtitle="30-Tage-Umsatz, Claim-Probleme und kaufrelevante Reibung."
          icon={<CircleDollarSign className="h-4 w-4 text-primary" />}
          href="/admin/revenue"
          tone={derived.supportIssues > 0 ? 'warning' : 'default'}
          metric={<Badge variant="outline">{revenueLoading ? '…' : fmtEur(derived.revenue30d)}</Badge>}
        >
          <div className="grid grid-cols-2 gap-2">
            <SmallStat
              label="Claim-Probleme"
              value={supportLoading ? '…' : derived.supportIssues}
              tone={derived.supportIssues > 0 ? 'warning' : 'success'}
            />
            <SmallStat label="30 Tage" value={revenueLoading ? '…' : fmtEur(derived.revenue30d)} />
          </div>
        </SectionCard>

        <SectionCard
          title="SEO & Publish"
          subtitle="Publish-Blocker und Vermarktungsfähigkeit der Produkte."
          icon={<Search className="h-4 w-4 text-primary" />}
          href="/admin/packages/risk"
          tone={derived.publishBlockers > 0 ? 'warning' : 'success'}
          metric={
            <Badge variant={derived.publishBlockers > 0 ? 'secondary' : 'outline'}>
              {seoLoading ? '…' : `${derived.publishBlockers} Blocker`}
            </Badge>
          }
        >
          <div className="space-y-3">
            <div>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span>Publish Readiness</span>
                <span className="text-muted-foreground">
                  {packages.length > 0
                    ? `${Math.max(0, Math.round(((packages.length - derived.publishBlockers) / packages.length) * 100))}%`
                    : '–'}
                </span>
              </div>
              <Progress
                value={
                  packages.length > 0
                    ? Math.max(0, ((packages.length - derived.publishBlockers) / packages.length) * 100)
                    : 0
                }
                className="h-2"
              />
            </div>
            <SmallStat
              label="Blockierte Pakete"
              value={seoLoading ? '…' : derived.publishBlockers}
              tone={derived.publishBlockers > 0 ? 'warning' : 'success'}
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Content & Qualität"
          subtitle="Build-Tiefe, unfertige Pakete und Qualitätssicherung im Rollout."
          icon={<Brain className="h-4 w-4 text-primary" />}
          href="/admin/packages/risk"
          tone={derived.criticalPackages > 0 ? 'warning' : 'default'}
          metric={<Badge variant="outline">{derived.criticalPackages} kritisch</Badge>}
        >
          <div className="grid grid-cols-2 gap-2">
            <SmallStat label="Im Build" value={packages.length} />
            <SmallStat
              label="< 40% Fortschritt"
              value={derived.criticalPackages}
              tone={derived.criticalPackages > 0 ? 'warning' : 'success'}
            />
          </div>
        </SectionCard>

        <SectionCard
          title="CRM & Service"
          subtitle="Support, Claims und Nutzerzugriff mit direkter Umsatzwirkung."
          icon={<LifeBuoy className="h-4 w-4 text-primary" />}
          href="/admin/revenue"
          tone={derived.supportIssues > 0 ? 'warning' : 'success'}
          metric={
            <Badge variant={derived.supportIssues > 0 ? 'secondary' : 'outline'}>
              {derived.supportIssues} offen
            </Badge>
          }
        >
          <div className="grid grid-cols-2 gap-2">
            <SmallStat
              label="Offene Issues"
              value={supportLoading ? '…' : derived.supportIssues}
              tone={derived.supportIssues > 0 ? 'warning' : 'success'}
            />
            <SmallStat label="Zugriff gesund" value={supportLoading ? '…' : Math.max(0, 100 - derived.supportIssues)} />
          </div>
        </SectionCard>
      </div>

      <Card className="border-border/70 bg-card/70">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Empfohlene Admin-Navigation
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <Button asChild variant="outline" className="justify-between">
            <Link to="/admin/control-tower">
              Leitstelle
              <Wrench className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" className="justify-between">
            <Link to="/admin/packages/risk">
              Paket-Risiken
              <Brain className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" className="justify-between">
            <Link to="/admin/revenue">
              Umsatz & Claims
              <Users className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" className="justify-between">
            <Link to="/admin/providers">
              Provider Health
              <BookOpen className="h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
