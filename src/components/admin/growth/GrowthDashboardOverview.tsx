import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2, RefreshCw, Search, Target, FileText, Globe, Link2,
  Zap, Radar, Settings, Image, Share2, Euro, Tag, Music, Laugh,
  Activity, Rocket, BarChart3, ChevronRight, TrendingUp, AlertCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type HealthColor = "green" | "yellow" | "red";

interface Overview {
  total_clusters: number; active_clusters: number;
  total_keywords: number; clustered_keywords: number; mapped_keywords: number; avg_opportunity: number;
  total_briefs: number; draft_briefs: number; ready_briefs: number; published_briefs: number;
  total_pages: number; published_pages: number; draft_pages: number;
  total_audits: number; critical_audits: number; warning_audits: number; healthy_audits: number; avg_score: number;
  pending_refreshes: number; in_progress_refreshes: number; completed_last_7d: number;
  keywords_health: HealthColor; briefs_health: HealthColor;
  audits_health: HealthColor; refresh_health: HealthColor;
}

interface RefreshCandidate {
  slug: string; title: string; refresh_score: number;
  refresh_reason: string; content_url: string;
}

interface TopPage {
  slug: string; title: string; views_90d: number;
  paid_orders_90d: number; revenue_eur_90d: number; performance_tier: string;
}

interface ActivityRow {
  activity_kind: string; action_type: string;
  target_id: string | null; metadata: any; created_at: string;
}

const SUBPAGES: Array<{
  tab: string; label: string; icon: any;
  countKey?: keyof Overview; healthKey?: keyof Overview;
}> = [
  { tab: "growth", label: "Growth Loop", icon: Rocket },
  { tab: "keywords", label: "Keywords", icon: Search, countKey: "total_keywords", healthKey: "keywords_health" },
  { tab: "briefs", label: "Briefs", icon: Target, countKey: "total_briefs", healthKey: "briefs_health" },
  { tab: "blog", label: "Blog", icon: FileText },
  { tab: "pages", label: "Seiten", icon: Globe, countKey: "total_pages" },
  { tab: "links", label: "Links", icon: Link2 },
  { tab: "audit", label: "Audit", icon: Zap, countKey: "critical_audits", healthKey: "audits_health" },
  { tab: "refresh", label: "Refresh", icon: RefreshCw, countKey: "pending_refreshes", healthKey: "refresh_health" },
  { tab: "discovery", label: "Discovery", icon: Radar },
  { tab: "seo", label: "SEO", icon: Settings },
  { tab: "redirects", label: "Redirects", icon: Link2 },
  { tab: "assets", label: "Assets", icon: Image },
  { tab: "social", label: "Social", icon: Share2 },
  { tab: "pricing", label: "Preise", icon: Euro },
  { tab: "promo", label: "Promo", icon: Tag },
  { tab: "songs", label: "Songs", icon: Music },
  { tab: "humor", label: "Humor QC", icon: Laugh },
  { tab: "intel", label: "Marketing-Intel", icon: Activity },
];

function healthBg(h?: HealthColor) {
  if (h === "red") return "bg-surface-sunken border-l-2 border-l-destructive";
  if (h === "yellow") return "bg-surface-sunken border-l-2 border-l-warning";
  if (h === "green") return "border-l-2 border-l-success";
  return "border-l-2 border-l-border";
}

function healthDot(h?: HealthColor) {
  if (h === "red") return "bg-destructive";
  if (h === "yellow") return "bg-warning";
  if (h === "green") return "bg-success";
  return "bg-muted";
}

function tierBadge(tier: string) {
  const map: Record<string, string> = {
    top_performer: "bg-success-bg-subtle text-success-foreground",
    lead_generator: "bg-primary/15 text-primary",
    leaky_funnel: "bg-warning-bg-subtle text-warning-foreground",
    no_traffic: "bg-muted text-muted-foreground",
    low_signal: "bg-muted text-muted-foreground",
  };
  return map[tier] ?? "bg-muted";
}

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `vor ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `vor ${h}h`;
  return `vor ${Math.floor(h / 24)}d`;
}

export default function GrowthDashboardOverview({
  onTabSwitch,
}: { onTabSwitch?: (tab: string) => void }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [refreshCands, setRefreshCands] = useState<RefreshCandidate[]>([]);
  const [topPages, setTopPages] = useState<TopPage[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("admin_seo_compute_overview");
      if (error) throw error;
      const res = data as any;
      if (res?.error) throw new Error(res.error);
      setOverview(res.overview ?? null);
      setRefreshCands(res.top_refresh_candidates ?? []);
      setTopPages(res.top_pages ?? []);
      setActivity(res.recent_activity ?? []);
    } catch (e: any) {
      toast({ title: "Fehler beim Laden", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function enqueueRefresh() {
    setBusy("refresh");
    try {
      const { data, error } = await supabase.rpc("admin_seo_enqueue_refresh_top_n", { p_limit: 10 });
      if (error) throw error;
      const res = data as any;
      if (res?.error) throw new Error(res.error);
      toast({
        title: "Refresh-Queue aktualisiert",
        description: `${res.inserted} neu, ${res.skipped} übersprungen.`,
      });
      await load();
    } catch (e: any) {
      toast({ title: "Fehler", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function runAuditBatch() {
    setBusy("audit");
    try {
      const { data, error } = await supabase.functions.invoke("seo-audit-run", {
        body: { mode: "batch", limit: 25 },
      });
      if (error) throw error;
      toast({
        title: "Audit-Lauf abgeschlossen",
        description: `${data.audited} Pages auditiert.`,
      });
      await load();
    } catch (e: any) {
      toast({ title: "Audit-Fehler", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <Card className="shadow-elev-1">
        <CardContent className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header KPI-Strip */}
      <Card className="shadow-elev-1 border-l-2 border-l-primary">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              Growth-OS Übersicht
            </CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={load} disabled={busy !== null}>
                <RefreshCw className="h-3 w-3 mr-1" /> Reload
              </Button>
              <Button size="sm" variant="outline" onClick={runAuditBatch} disabled={busy !== null}>
                {busy === "audit" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Zap className="h-3 w-3 mr-1" />}
                Audit-Batch (25)
              </Button>
              <Button size="sm" onClick={enqueueRefresh} disabled={busy !== null}>
                {busy === "refresh" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                Top-10 in Refresh-Queue
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 text-xs">
            <KpiCell label="Cluster" value={overview?.active_clusters ?? 0} sub={`${overview?.total_clusters ?? 0} total`} />
            <KpiCell label="Keywords" value={overview?.total_keywords ?? 0} sub={`${overview?.mapped_keywords ?? 0} mapped`} health={overview?.keywords_health} />
            <KpiCell label="Briefs (ready)" value={overview?.ready_briefs ?? 0} sub={`${overview?.draft_briefs ?? 0} draft`} health={overview?.briefs_health} />
            <KpiCell label="Pages (live)" value={overview?.published_pages ?? 0} sub={`${overview?.draft_pages ?? 0} draft`} />
            <KpiCell label="Audit avg" value={overview?.avg_score ?? 0} sub={`${overview?.critical_audits ?? 0} kritisch`} health={overview?.audits_health} />
            <KpiCell label="Refresh queue" value={overview?.pending_refreshes ?? 0} sub={`${overview?.completed_last_7d ?? 0}/7d done`} health={overview?.refresh_health} />
          </div>
        </CardContent>
      </Card>

      {/* Subpage-Cards Grid */}
      <Card className="shadow-elev-1">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Sektionen ({SUBPAGES.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            {SUBPAGES.map((s) => {
              const Icon = s.icon;
              const count = s.countKey && overview ? overview[s.countKey] as number : null;
              const health = s.healthKey && overview ? overview[s.healthKey] as HealthColor : undefined;
              return (
                <button
                  key={s.tab}
                  onClick={() => onTabSwitch?.(s.tab)}
                  className={`text-left p-2.5 rounded-lg bg-surface-1 hover:bg-surface-2 transition-all group ${healthBg(health)}`}
                >
                  <div className="flex items-start justify-between mb-1.5">
                    <Icon className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                    {health && <span className={`h-1.5 w-1.5 rounded-full ${healthDot(health)}`} />}
                  </div>
                  <div className="text-xs font-medium text-foreground">{s.label}</div>
                  {count !== null && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">{count.toLocaleString("de-DE")}</div>
                  )}
                  <ChevronRight className="h-3 w-3 text-muted-foreground/50 mt-1 group-hover:text-foreground/70 transition-colors" />
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* 2-Spalten: Top Refresh + Top Performer */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card className="shadow-elev-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-warning-foreground" />
              Top Refresh-Kandidaten
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[280px]">
              <div className="space-y-1.5">
                {refreshCands.length === 0 && (
                  <div className="text-xs text-muted-foreground py-6 text-center">Keine Kandidaten</div>
                )}
                {refreshCands.map((c) => (
                  <Link
                    key={c.slug}
                    to={c.content_url}
                    target="_blank"
                    className="flex items-center justify-between gap-2 p-2 rounded-md bg-surface-1 hover:bg-surface-2 transition-colors text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate text-foreground">{c.title}</div>
                      <div className="text-[10px] text-muted-foreground">{c.refresh_reason.replace(/_/g, " ")}</div>
                    </div>
                    <Badge variant={c.refresh_score >= 75 ? "destructive" : c.refresh_score >= 60 ? "secondary" : "outline"} className="text-[10px] shrink-0">
                      {c.refresh_score}
                    </Badge>
                  </Link>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="shadow-elev-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-success" />
              Top Performer (90d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[280px]">
              <div className="space-y-1.5">
                {topPages.length === 0 && (
                  <div className="text-xs text-muted-foreground py-6 text-center">Noch keine Conversion-Daten</div>
                )}
                {topPages.map((p) => (
                  <div key={p.slug} className="flex items-center justify-between gap-2 p-2 rounded-md bg-surface-1 text-xs">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate text-foreground">{p.title}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {p.views_90d.toLocaleString("de-DE")} Views · {p.paid_orders_90d} Käufe · {Number(p.revenue_eur_90d).toFixed(0)}€
                      </div>
                    </div>
                    <Badge className={`text-[10px] shrink-0 ${tierBadge(p.performance_tier)}`}>
                      {p.performance_tier.replace(/_/g, " ")}
                    </Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card className="shadow-elev-1">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Letzte SEO-Aktivität
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[200px]">
            <div className="space-y-1">
              {activity.length === 0 && (
                <div className="text-xs text-muted-foreground py-4 text-center">Keine Aktivität</div>
              )}
              {activity.map((a, i) => (
                <div key={i} className="flex items-center gap-2 text-xs py-1.5 border-b border-border/40 last:border-0">
                  <Badge variant="outline" className="text-[10px] shrink-0 capitalize">{a.activity_kind}</Badge>
                  <span className="font-mono text-[10px] text-muted-foreground shrink-0">{a.action_type}</span>
                  <span className="text-muted-foreground truncate flex-1">
                    {a.metadata && typeof a.metadata === "object"
                      ? (a.metadata.title || a.metadata.h1 || a.metadata.keyword || a.metadata.slug || `${Object.keys(a.metadata).length} fields`)
                      : ""}
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(a.created_at)}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCell({ label, value, sub, health }: { label: string; value: number | string; sub?: string; health?: HealthColor }) {
  return (
    <div className={`p-2 rounded-md bg-surface-1 ${healthBg(health)}`}>
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
        {health && <span className={`h-1.5 w-1.5 rounded-full ${healthDot(health)}`} />}
      </div>
      <div className="text-base font-semibold text-foreground mt-0.5">
        {typeof value === "number" ? value.toLocaleString("de-DE") : value}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
