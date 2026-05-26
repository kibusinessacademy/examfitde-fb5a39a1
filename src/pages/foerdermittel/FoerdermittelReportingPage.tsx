// FördermittelOS Cut-5 follow-up: cross-module measurement & reporting view.
// Authority pages, index/crawler status, organic performance KPIs.
// Read-only, admin-only via useAuth.isAdmin gate.
import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { ArrowLeft, BarChart3, Search, Radar, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PROGRAMS } from "@/lib/foerdermittel/registry";
import {
  buildStateCluster,
  buildTopicCluster,
  buildIndustryCluster,
  buildCombinationCluster,
  COMBINATIONS,
} from "@/lib/foerdermittel/seoAuthority";
import { classifyFreshness } from "@/lib/foerdermittel/freshness";

const STATE_KEYS = ["BW", "BY", "BE", "BB", "HB", "HH", "HE", "MV", "NI", "NW", "RP", "SL", "SN", "ST", "SH", "TH"] as const;
const TOPIC_KEYS = ["digitalisierung", "ki", "weiterbildung", "ausbildung", "energie", "nachhaltigkeit", "innovation", "gruendung", "export", "personal"] as const;
const INDUSTRY_KEYS = ["it", "handwerk", "industrie", "handel", "dienstleistung"] as const;

interface EventBucket {
  event_type: string;
  count: number;
}

export default function FoerdermittelReportingPage() {
  const { isAdmin, loading } = useAuth();
  const [events, setEvents] = useState<EventBucket[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  useEffect(() => {
    if (!isAdmin) return;
    setEventsLoading(true);
    (async () => {
      const since = new Date(Date.now() - 30 * 86400_000).toISOString();
      const { data } = await supabase
        .from("conversion_events")
        .select("event_type")
        .gte("created_at", since)
        .like("page_path", "/foerdermittel%")
        .limit(5000);
      const map = new Map<string, number>();
      for (const r of data ?? []) {
        const t = (r as any).event_type as string;
        map.set(t, (map.get(t) ?? 0) + 1);
      }
      setEvents([...map.entries()]
        .map(([event_type, count]) => ({ event_type, count }))
        .sort((a, b) => b.count - a.count));
      setEventsLoading(false);
    })();
  }, [isAdmin]);

  const clusterMetrics = useMemo(() => {
    const stateClusters = STATE_KEYS.map((k) => buildStateCluster(PROGRAMS, k as any));
    const topicClusters = TOPIC_KEYS.map((k) => buildTopicCluster(PROGRAMS, k as any));
    const industryClusters = INDUSTRY_KEYS.map((k) => buildIndustryCluster(PROGRAMS, k as any));
    const combo = COMBINATIONS.map((def) => buildCombinationCluster(PROGRAMS, def));
    const all = [...stateClusters, ...topicClusters, ...industryClusters, ...combo];
    const thin = all.filter((c) => c.isThin).length;
    const indexable = all.filter((c) => !c.isThin).length;
    const avgAuthority = all.length === 0 ? 0 : Math.round(all.reduce((s, c) => s + c.authorityScore, 0) / all.length);
    return { all, thin, indexable, avgAuthority };
  }, []);

  const freshnessMetrics = useMemo(() => {
    const counts = { fresh: 0, watch: 0, stale: 0, unknown: 0 };
    for (const p of PROGRAMS) counts[classifyFreshness(p)] += 1;
    return counts;
  }, []);

  if (loading) {
    return <main className="min-h-screen bg-background flex items-center justify-center text-sm text-muted-foreground">Laden …</main>;
  }
  if (!isAdmin) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="p-6 text-center space-y-2">
            <div className="font-semibold">Zugriff beschränkt</div>
            <p className="text-sm text-muted-foreground">Diese Reporting-Ansicht ist nur für Admin- und Sales-Rollen freigegeben.</p>
            <Link to="/foerdermittel" className="text-sm text-primary hover:underline">Zurück zum Hub</Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <Helmet>
        <title>FördermittelOS Reporting · intern</title>
        <meta name="robots" content="noindex, nofollow, noarchive, nosnippet" />
      </Helmet>

      <section className="mx-auto max-w-7xl px-6 pt-8 pb-2">
        <Link to="/foerdermittel" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> FördermittelOS-Hub
        </Link>
      </section>

      <section className="mx-auto max-w-7xl px-6 pt-2 pb-6">
        <Badge variant="outline" className="mb-2">intern · admin</Badge>
        <h1 className="text-3xl font-semibold tracking-tight inline-flex items-center gap-2">
          <BarChart3 className="h-7 w-7 text-primary" />
          FördermittelOS Reporting
        </h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-3xl">
          Authority-Seiten, Index-/Crawler-Status, Freshness und Conversion-Performance — letzte 30 Tage.
        </p>
      </section>

      {/* SEO Authority KPIs */}
      <section className="mx-auto max-w-7xl px-6 pb-6 grid gap-3 sm:grid-cols-4">
        <Kpi label="Cluster gesamt" value={clusterMetrics.all.length} icon={<Layers className="h-4 w-4 text-primary" />} />
        <Kpi label="Indexierbar" value={clusterMetrics.indexable} hint="!isThin" />
        <Kpi label="Thin (noindex)" value={clusterMetrics.thin} hint="< 1 Programm oder stale-only" />
        <Kpi label="Ø Authority-Score" value={`${clusterMetrics.avgAuthority}/100`} />
      </section>

      {/* Freshness KPIs */}
      <section className="mx-auto max-w-7xl px-6 pb-6">
        <Card>
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold mb-3 inline-flex items-center gap-2">
              <Radar className="h-4 w-4 text-primary" /> Freshness-Verteilung ({PROGRAMS.length} Programme)
            </h2>
            <div className="grid gap-2 sm:grid-cols-4">
              <StatBox label="fresh" value={freshnessMetrics.fresh} tone="emerald" />
              <StatBox label="watch" value={freshnessMetrics.watch} tone="amber" />
              <StatBox label="stale" value={freshnessMetrics.stale} tone="orange" />
              <StatBox label="unknown" value={freshnessMetrics.unknown} tone="muted" />
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Conversion events */}
      <section className="mx-auto max-w-7xl px-6 pb-6">
        <Card>
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold mb-3 inline-flex items-center gap-2">
              <Search className="h-4 w-4 text-primary" /> Conversion-Events (letzte 30 Tage, /foerdermittel/*)
            </h2>
            {eventsLoading ? (
              <p className="text-sm text-muted-foreground">Lade …</p>
            ) : events.length === 0 ? (
              <p className="text-sm text-muted-foreground">Noch keine Events für /foerdermittel/* erfasst.</p>
            ) : (
              <ul className="divide-y">
                {events.map((e) => (
                  <li key={e.event_type} className="py-2 flex items-center gap-3 text-sm">
                    <span className="font-mono text-xs flex-1 truncate">{e.event_type}</span>
                    <span className="tabular-nums font-semibold">{e.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Cluster table */}
      <section className="mx-auto max-w-7xl px-6 pb-12">
        <Card>
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold mb-3">Cluster-Inventar</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground border-b">
                  <tr>
                    <th className="py-2 pr-3">Cluster</th>
                    <th className="py-2 pr-3">Typ</th>
                    <th className="py-2 pr-3">Programme</th>
                    <th className="py-2 pr-3">Authority</th>
                    <th className="py-2 pr-3">Index</th>
                  </tr>
                </thead>
                <tbody>
                  {clusterMetrics.all.slice(0, 50).map((c) => (
                    <tr key={c.meta.kind + ":" + c.meta.slug} className="border-b last:border-0">
                      <td className="py-1.5 pr-3 font-medium">{c.meta.h1}</td>
                      <td className="py-1.5 pr-3 capitalize text-muted-foreground">{c.meta.kind}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{c.programs.length}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{c.authorityScore}</td>
                      <td className="py-1.5 pr-3">
                        {c.isThin
                          ? <Badge variant="outline" className="text-[9px] border-amber-500/40 text-amber-700">noindex</Badge>
                          : <Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-700">indexable</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function Kpi({ label, value, hint, icon }: { label: string; value: string | number; hint?: string; icon?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
          {icon} {label}
        </div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function StatBox({ label, value, tone }: { label: string; value: number; tone: "emerald" | "amber" | "orange" | "muted" }) {
  const cls = {
    emerald: "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400",
    amber: "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400",
    orange: "border-orange-500/40 bg-orange-500/5 text-orange-700 dark:text-orange-400",
    muted: "border-muted bg-muted/30 text-muted-foreground",
  }[tone];
  return (
    <div className={`rounded-md border p-3 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
