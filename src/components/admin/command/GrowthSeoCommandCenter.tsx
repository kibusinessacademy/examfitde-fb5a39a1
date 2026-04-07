import { useGrowthSeoTower, type DiagnosedIssue, type HealthBarItem } from '@/components/admin/hooks/useGrowthSeoTower';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  Search, FileText, Globe, TrendingUp, AlertTriangle, CheckCircle,
  XCircle, ArrowRight, Link2, Package, Zap, UserX, Bell,
  BarChart3, Shield, Eye, BookOpen,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/* ── Health Bar ── */
function HealthBar({ items }: { items: HealthBarItem[] }) {
  const toneColors: Record<string, string> = {
    green: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
    yellow: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
    red: 'bg-rose-500/15 text-rose-600 border-rose-500/30',
    neutral: 'bg-muted text-muted-foreground border-border',
  };

  return (
    <div className="flex flex-wrap gap-2 mb-6">
      {items.map(item => (
        <div
          key={item.key}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium',
            toneColors[item.tone],
          )}
          title={item.hint}
        >
          <span className="font-semibold">{item.value}</span>
          <span className="opacity-80">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ── SEO Score Ring ── */
function ScoreRing({ score, label }: { score: number; label: string }) {
  const color = score >= 80 ? 'text-emerald-500' : score >= 50 ? 'text-amber-500' : 'text-rose-500';
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-20 h-20">
        <svg className="w-20 h-20 -rotate-90" viewBox="0 0 36 36">
          <path
            className="text-muted/30"
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            fill="none" stroke="currentColor" strokeWidth="3"
          />
          <path
            className={color}
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            fill="none" stroke="currentColor" strokeWidth="3"
            strokeDasharray={`${score}, 100`}
          />
        </svg>
        <span className={cn('absolute inset-0 flex items-center justify-center text-lg font-bold', color)}>
          {score}
        </span>
      </div>
      <span className="text-[10px] text-muted-foreground font-medium">{label}</span>
    </div>
  );
}

/* ── Issue Card ── */
function IssueCard({ issue }: { issue: DiagnosedIssue }) {
  const severityConfig: Record<string, { bg: string; text: string; icon: typeof AlertTriangle }> = {
    critical: { bg: 'border-l-rose-500 bg-rose-500/5', text: 'text-rose-600', icon: XCircle },
    high: { bg: 'border-l-orange-500 bg-orange-500/5', text: 'text-orange-600', icon: AlertTriangle },
    medium: { bg: 'border-l-amber-500 bg-amber-500/5', text: 'text-amber-600', icon: Eye },
    low: { bg: 'border-l-blue-500 bg-blue-500/5', text: 'text-blue-600', icon: BarChart3 },
  };

  const domainIcons: Record<string, typeof Search> = {
    seo: Search,
    growth: TrendingUp,
    publish: Package,
    content: FileText,
  };

  const config = severityConfig[issue.severity] || severityConfig.medium;
  const Icon = config.icon;
  const DomainIcon = domainIcons[issue.domain] || Globe;

  return (
    <Card className={cn('border-l-4', config.bg)}>
      <CardContent className="py-3 px-4">
        <div className="flex items-start gap-3">
          <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', config.text)} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-foreground">{issue.title}</span>
              <Badge variant="outline" className="text-[9px] gap-1">
                <DomainIcon className="h-2.5 w-2.5" />
                {issue.domain.toUpperCase()}
              </Badge>
              <Badge variant="outline" className={cn('text-[9px]', config.text)}>
                {issue.severity}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{issue.detail}</p>
            <div className="flex items-center gap-1 mt-2 text-[10px] text-primary">
              <Zap className="h-3 w-3" />
              <span>{issue.recommendation}</span>
            </div>
          </div>
          <span className={cn('text-lg font-bold shrink-0', config.text)}>{issue.metric}</span>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── KPI Mini Card ── */
function MiniKpi({ icon, label, value, sub, tone }: {
  icon: React.ReactNode; label: string; value: number | string; sub?: string;
  tone?: 'green' | 'yellow' | 'red' | 'neutral';
}) {
  const toneClasses = {
    green: 'text-emerald-600',
    yellow: 'text-amber-600',
    red: 'text-rose-600',
    neutral: 'text-foreground',
  };
  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-2 mb-1">
          {icon}
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        </div>
        <p className={cn('text-2xl font-bold', toneClasses[tone || 'neutral'])}>{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

/* ── SEO Gaps Table ── */
function SeoGapsPanel({ seo }: { seo: any }) {
  const gaps = [
    ...seo.seo_gaps.missing_meta_title.map((g: any) => ({ ...g, type: 'Meta Title fehlt', severity: 'high' })),
    ...seo.seo_gaps.missing_meta_desc.map((g: any) => ({ ...g, type: 'Meta Desc fehlt', severity: 'high' })),
    ...seo.seo_gaps.long_meta_title.map((g: any) => ({ ...g, type: `Title zu lang (${g.length})`, severity: 'medium' })),
    ...seo.seo_gaps.long_meta_desc.map((g: any) => ({ ...g, type: `Desc zu lang (${g.length})`, severity: 'medium' })),
    ...seo.seo_gaps.noindex_published.map((g: any) => ({ ...g, type: 'Noindex aktiv', severity: 'critical' })),
  ];

  if (gaps.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-8 text-center">
          <CheckCircle className="h-8 w-8 mx-auto mb-2 text-emerald-500" />
          <p className="text-sm font-medium">Keine SEO-Lücken gefunden</p>
          <p className="text-xs text-muted-foreground">Alle veröffentlichten Seiten haben vollständige Meta-Daten.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" /> SEO-Lücken ({gaps.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border max-h-80 overflow-y-auto">
          {gaps.map((g, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-2 text-xs hover:bg-muted/30">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium text-foreground truncate">{g.title}</span>
                <span className="text-muted-foreground truncate">/{g.slug}</span>
              </div>
              <Badge variant="outline" className={cn('text-[9px] shrink-0',
                g.severity === 'critical' ? 'text-rose-600 bg-rose-500/10' :
                g.severity === 'high' ? 'text-orange-600 bg-orange-500/10' : 'text-amber-600 bg-amber-500/10'
              )}>
                {g.type}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Publish Readiness Panel ── */
function PublishReadinessPanel({ publish }: { publish: any }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Package className="h-4 w-4 text-muted-foreground" /> Publish-Readiness
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {publish.ready_packages.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Bereit zur Veröffentlichung</p>
            <div className="space-y-1">
              {publish.ready_packages.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between text-xs bg-emerald-500/5 rounded px-3 py-1.5">
                  <span className="font-medium truncate">{p.title || p.id.slice(0, 8)}</span>
                  <div className="flex items-center gap-1.5">
                    {p.track && <Badge variant="outline" className="text-[9px]">{p.track}</Badge>}
                    {p.integrity_passed ? (
                      <CheckCircle className="h-3 w-3 text-emerald-500" />
                    ) : (
                      <AlertTriangle className="h-3 w-3 text-amber-500" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {publish.blocked_details.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Blockiert</p>
            <div className="space-y-1">
              {publish.blocked_details.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between text-xs bg-rose-500/5 rounded px-3 py-1.5">
                  <span className="font-medium truncate">{p.title || p.id.slice(0, 8)}</span>
                  <span className="text-rose-600 text-[10px] truncate max-w-[200px]">{p.reason || 'Quality Gate'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {publish.ready_packages.length === 0 && publish.blocked_details.length === 0 && (
          <div className="text-center py-4">
            <CheckCircle className="h-6 w-6 mx-auto mb-1 text-emerald-500" />
            <p className="text-xs text-muted-foreground">Keine ausstehenden Veröffentlichungen</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Growth Intelligence Panel ── */
function GrowthIntelPanel({ growth }: { growth: any }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" /> Growth Intelligence
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Churn overview */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Churn-Risiko</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center bg-rose-500/10 rounded-lg py-2">
              <p className="text-lg font-bold text-rose-600">{growth.churn.high_risk}</p>
              <p className="text-[9px] text-muted-foreground">Hoch</p>
            </div>
            <div className="text-center bg-amber-500/10 rounded-lg py-2">
              <p className="text-lg font-bold text-amber-600">{growth.churn.medium_risk}</p>
              <p className="text-[9px] text-muted-foreground">Mittel</p>
            </div>
            <div className="text-center bg-muted rounded-lg py-2">
              <p className="text-lg font-bold text-foreground">{growth.churn.total}</p>
              <p className="text-[9px] text-muted-foreground">Gesamt</p>
            </div>
          </div>
        </div>

        {/* Top risks */}
        {growth.churn.top_risks.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Top Risiken</p>
            <div className="space-y-1">
              {growth.churn.top_risks.map((r: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-xs bg-muted/50 rounded px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <UserX className="h-3 w-3 text-muted-foreground" />
                    <span className="font-mono text-[10px]">{r.user_id?.slice(0, 8)}…</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={cn('text-[9px]',
                      r.score > 70 ? 'text-rose-600' : 'text-amber-600'
                    )}>
                      {r.score}%
                    </Badge>
                    {r.action && <span className="text-[10px] text-muted-foreground">{r.action}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Nudge pipeline */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Nudge-Pipeline</p>
          <div className="flex items-center gap-1 text-[10px]">
            <div className="flex-1 bg-muted rounded px-2 py-1 text-center">
              <p className="font-semibold">{growth.nudges.proposed}</p>
              <p className="text-muted-foreground">Vorgeschlagen</p>
            </div>
            <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
            <div className="flex-1 bg-primary/10 rounded px-2 py-1 text-center">
              <p className="font-semibold text-primary">{growth.nudges.approved}</p>
              <p className="text-muted-foreground">Freigegeben</p>
            </div>
            <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
            <div className="flex-1 bg-emerald-500/10 rounded px-2 py-1 text-center">
              <p className="font-semibold text-emerald-600">{growth.nudges.sent}</p>
              <p className="text-muted-foreground">Gesendet</p>
            </div>
            {growth.nudges.failed > 0 && (
              <>
                <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                <div className="flex-1 bg-rose-500/10 rounded px-2 py-1 text-center">
                  <p className="font-semibold text-rose-600">{growth.nudges.failed}</p>
                  <p className="text-muted-foreground">Failed</p>
                </div>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Main Dashboard ── */
export default function GrowthSeoCommandCenter() {
  const { data, isLoading, error } = useGrowthSeoTower();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
        Fehler beim Laden der Growth & SEO Zentrale: {(error as Error).message}
      </div>
    );
  }

  if (!data) return null;

  const { health, seo, growth, publish, issues } = data;
  const criticalCount = issues.filter(i => i.severity === 'critical' || i.severity === 'high').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Globe className="h-5 w-5 text-primary" />
          Growth & SEO Command Center
        </h1>
        <p className="text-sm text-muted-foreground">
          SSOT-Systemlage für Wachstum, SEO und Content-Pipeline
        </p>
      </div>

      {/* Health Bar */}
      <HealthBar items={health} />

      {/* Score + KPI Row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Card className="col-span-1">
          <CardContent className="py-4 flex justify-center">
            <ScoreRing score={seo.health_score} label="SEO Health" />
          </CardContent>
        </Card>
        <MiniKpi
          icon={<FileText className="h-3.5 w-3.5 text-muted-foreground" />}
          label="Seiten Live"
          value={seo.pages.published}
          sub={`${seo.pages.total} gesamt · ${seo.pages.review} in Review`}
          tone={seo.pages.published > 0 ? 'green' : 'yellow'}
        />
        <MiniKpi
          icon={<BookOpen className="h-3.5 w-3.5 text-muted-foreground" />}
          label="Blog Live"
          value={seo.blogs.published}
          sub={`${seo.blogs.total} gesamt · ${seo.blogs.draft} Entwürfe`}
          tone={seo.blogs.published > 0 ? 'green' : 'yellow'}
        />
        <MiniKpi
          icon={<Link2 className="h-3.5 w-3.5 text-muted-foreground" />}
          label="Backlinks"
          value={seo.backlinks.active}
          sub={`${seo.backlinks.high_da} mit DA ≥ 40`}
          tone={seo.backlinks.high_da > 5 ? 'green' : 'neutral'}
        />
        <MiniKpi
          icon={<Shield className="h-3.5 w-3.5 text-muted-foreground" />}
          label="Redirects"
          value={seo.redirects.active}
          sub={seo.redirects.broken > 0 ? `${seo.redirects.broken} kaputt!` : `${seo.redirects.total} konfiguriert`}
          tone={seo.redirects.broken > 0 ? 'red' : 'green'}
        />
      </div>

      <Tabs defaultValue="issues" className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1 rounded-xl">
          <TabsTrigger value="issues" className="flex items-center gap-1.5 text-xs py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg">
            <AlertTriangle className="h-3.5 w-3.5" />
            Diagnose
            {criticalCount > 0 && (
              <Badge variant="destructive" className="text-[9px] h-4 px-1 ml-1">{criticalCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="seo" className="flex items-center gap-1.5 text-xs py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg">
            <Search className="h-3.5 w-3.5" /> SEO-Lücken
          </TabsTrigger>
          <TabsTrigger value="publish" className="flex items-center gap-1.5 text-xs py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg">
            <Package className="h-3.5 w-3.5" /> Publish
          </TabsTrigger>
          <TabsTrigger value="growth" className="flex items-center gap-1.5 text-xs py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg">
            <TrendingUp className="h-3.5 w-3.5" /> Growth Intel
          </TabsTrigger>
          <TabsTrigger value="engine" className="flex items-center gap-1.5 text-xs py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg">
            <Zap className="h-3.5 w-3.5" /> Content Engine
          </TabsTrigger>
        </TabsList>

        <TabsContent value="issues" className="mt-4 space-y-2">
          {issues.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-10 text-center">
                <CheckCircle className="h-10 w-10 mx-auto mb-3 text-emerald-500" />
                <p className="text-sm font-medium">Keine Probleme erkannt</p>
                <p className="text-xs text-muted-foreground">Growth & SEO sind im grünen Bereich.</p>
              </CardContent>
            </Card>
          ) : (
            issues.map((issue, i) => <IssueCard key={i} issue={issue} />)
          )}
        </TabsContent>

        <TabsContent value="seo" className="mt-4">
          <SeoGapsPanel seo={seo} />
        </TabsContent>

        <TabsContent value="publish" className="mt-4">
          <PublishReadinessPanel publish={publish} />
        </TabsContent>

        <TabsContent value="growth" className="mt-4">
          <GrowthIntelPanel growth={growth} />
        </TabsContent>
      </Tabs>

      {/* Content Pipeline Overview */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Content-Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            {[
              { label: 'Entwurf', count: seo.pages.draft + seo.blogs.draft, color: 'bg-muted' },
              { label: 'Review', count: seo.pages.review, color: 'bg-amber-500/20' },
              { label: 'Published', count: seo.pages.published + seo.blogs.published, color: 'bg-emerald-500/20' },
            ].map((stage, i) => (
              <div key={i} className="flex-1">
                <div className={cn('rounded-lg py-3 text-center', stage.color)}>
                  <p className="text-lg font-bold">{stage.count}</p>
                  <p className="text-[10px] text-muted-foreground">{stage.label}</p>
                </div>
                {i < 2 && <div className="flex justify-center my-1"><ArrowRight className="h-3 w-3 text-muted-foreground" /></div>}
              </div>
            ))}
          </div>
          <div className="mt-3">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
              <span>SEO-Abdeckung</span>
              <span>{seo.health_score}%</span>
            </div>
            <Progress value={seo.health_score} className="h-1.5" />
          </div>
        </CardContent>
      </Card>

      {/* Timestamp */}
      <p className="text-[10px] text-muted-foreground text-right">
        Stand: {new Date(data.generated_at).toLocaleString('de-DE')} · Auto-Refresh 30s
      </p>
    </div>
  );
}
