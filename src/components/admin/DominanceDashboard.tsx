import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  Globe, TrendingUp, Shield, AlertTriangle, CheckCircle2,
  RefreshCw, Loader2, Target, Zap, Crown, BarChart3,
  Layers, ArrowUpRight, Settings
} from 'lucide-react';
import { toast } from 'sonner';

interface ClusterData {
  cluster_id: string;
  slug: string;
  label: string;
  wave: number;
  strategy: string;
  cds: number;
  level: string;
  market_coverage: number;
  avg_authority: number;
  revenue_share: number;
  seo_visibility: number;
  competition_diff: number;
  total: number;
  optimize: number;
  authority: number;
  is_active_wave: boolean;
}

interface DominanceResult {
  clusters: ClusterData[];
  balance_warnings: { cluster: string; revenue_share: number; max: number }[];
  total_revenue: number;
}

const LEVEL_STYLES: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
  dominant: { color: 'text-success', bg: 'bg-success/10 border-success/30', icon: <Crown className="h-4 w-4" /> },
  marktfuehrer: { color: 'text-primary', bg: 'bg-primary/10 border-primary/30', icon: <TrendingUp className="h-4 w-4" /> },
  wettbewerbsfaehig: { color: 'text-warning', bg: 'bg-warning/10 border-warning/30', icon: <Target className="h-4 w-4" /> },
  aufbau: { color: 'text-muted-foreground', bg: 'bg-muted/50 border-border', icon: <Layers className="h-4 w-4" /> },
};

const LEVEL_LABELS: Record<string, string> = {
  dominant: 'Dominant',
  marktfuehrer: 'Marktführer',
  wettbewerbsfaehig: 'Wettbewerbsfähig',
  aufbau: 'Aufbau',
};

const STRATEGY_LABELS: Record<string, string> = {
  praxis_cases: '🛒 Praxisfälle',
  scenario_based: '💻 Szenario-basiert',
  regulatory_depth: '📜 Regulatorische Tiefe',
  process_scenarios: '⚙️ Prozess-Szenarien',
  clinical_cases: '🏥 Klinische Fälle',
  administrative_processes: '📋 Verwaltungsprozesse',
};

function CDSGauge({ cds, level, label }: { cds: number; level: string; label: string }) {
  const style = LEVEL_STYLES[level] || LEVEL_STYLES.aufbau;
  return (
    <div className={cn("rounded-xl border p-4 text-center", style.bg)}>
      <div className="flex items-center justify-center gap-1.5 mb-2">
        <span className={style.color}>{style.icon}</span>
        <span className={cn("text-xs font-bold uppercase tracking-wider", style.color)}>
          {LEVEL_LABELS[level] || level}
        </span>
      </div>
      <p className={cn("text-3xl font-black font-mono", style.color)}>{Math.round(cds)}</p>
      <p className="text-[10px] text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

function MetricBar({ label, value, max = 100, suffix = '%' }: { label: string; value: number; max?: number; suffix?: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground w-20 shrink-0">{label}</span>
      <Progress value={pct} className="h-1.5 flex-1" />
      <span className="text-[10px] font-mono text-foreground w-12 text-right">{Math.round(value)}{suffix}</span>
    </div>
  );
}

export default function DominanceDashboard() {
  const [data, setData] = useState<DominanceResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      // Try to get latest snapshots first
      const { data: clusters } = await (supabase as any)
        .from('market_clusters')
        .select('*')
        .order('wave_number');
      
      if (clusters?.length) {
        // Get latest snapshot per cluster
        const clusterData: ClusterData[] = [];
        for (const c of clusters) {
          const { data: snap } = await (supabase as any)
            .from('cluster_dominance_snapshots')
            .select('*')
            .eq('cluster_id', c.id)
            .order('snapshot_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          
          clusterData.push({
            cluster_id: c.id,
            slug: c.slug,
            label: c.label,
            wave: c.wave_number,
            strategy: c.authority_question_strategy,
            cds: snap?.cds || 0,
            level: snap?.dominance_level || 'aufbau',
            market_coverage: snap?.market_coverage || 0,
            avg_authority: snap?.avg_authority_index || 0,
            revenue_share: snap?.revenue_share || 0,
            seo_visibility: snap?.seo_visibility || 0,
            competition_diff: snap?.competition_diff || 0,
            total: snap?.total_berufe || 0,
            optimize: snap?.covered_optimize || 0,
            authority: snap?.covered_authority || 0,
            is_active_wave: c.max_active_dominance,
          });
        }
        setData({ clusters: clusterData, balance_warnings: [], total_revenue: 0 });
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const evaluate = async () => {
    setEvaluating(true);
    try {
      const { data: result, error } = await (supabase as any).rpc('evaluate_cluster_dominance');
      if (error) throw error;
      setData(result);
      toast.success('Cluster-Dominanz berechnet');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setEvaluating(false);
    }
  };

  const toggleWave = async (clusterId: string, active: boolean) => {
    // Check max active limit
    if (active && data) {
      const activeCount = data.clusters.filter(c => c.is_active_wave).length;
      if (activeCount >= 2) {
        toast.error('Max 2 aktive Dominanz-Cluster gleichzeitig');
        return;
      }
    }
    await (supabase as any).from('market_clusters').update({ max_active_dominance: active }).eq('id', clusterId);
    toast.success(active ? 'Cluster aktiviert' : 'Cluster deaktiviert');
    load();
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;

  const clusters = data?.clusters || [];
  const byWave = clusters.reduce<Record<number, ClusterData[]>>((acc, c) => {
    (acc[c.wave] = acc[c.wave] || []).push(c);
    return acc;
  }, {});
  const dominantCount = clusters.filter(c => c.cds >= 85).length;
  const marktfuehrerCount = clusters.filter(c => c.cds >= 70).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">Dominance Operating System</h2>
          <Badge variant="outline" className="text-[10px]">{dominantCount} Dominant · {marktfuehrerCount} Marktführer</Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5" /></Button>
          <Button size="sm" onClick={evaluate} disabled={evaluating}>
            {evaluating ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Zap className="h-3.5 w-3.5 mr-1" />}
            CDS berechnen
          </Button>
        </div>
      </div>

      {/* Balance Warnings */}
      {data?.balance_warnings && data.balance_warnings.length > 0 && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="py-3">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="text-sm font-medium text-destructive">Portfolio-Balance Warnung</span>
            </div>
            {data.balance_warnings.map((w, i) => (
              <p key={i} className="text-xs text-destructive/80">
                {w.cluster}: {w.revenue_share}% Umsatzanteil (Max: {w.max}%)
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {/* CDS Overview Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {clusters.map(c => (
          <CDSGauge key={c.cluster_id} cds={c.cds} level={c.level} label={c.label} />
        ))}
      </div>

      {/* Wave Strategy */}
      {Object.entries(byWave).sort(([a], [b]) => Number(a) - Number(b)).map(([wave, wClusters]) => (
        <Card key={wave}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="h-4 w-4" />
              Welle {wave}
              {Number(wave) <= 1 && <Badge className="text-[9px] bg-primary/20 text-primary">Aktiv</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {wClusters.map(c => {
                const style = LEVEL_STYLES[c.level] || LEVEL_STYLES.aufbau;
                return (
                  <div key={c.cluster_id} className={cn("rounded-lg border p-4", style.bg)}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className={style.color}>{style.icon}</span>
                        <span className="text-sm font-bold text-foreground">{c.label}</span>
                        <Badge className={cn("text-[9px]", style.color)}>{LEVEL_LABELS[c.level]}</Badge>
                        <Badge variant="outline" className="text-[9px]">
                          {STRATEGY_LABELS[c.strategy] || c.strategy}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={cn("text-xl font-black font-mono", style.color)}>{Math.round(c.cds)}</span>
                        <Button
                          variant={c.is_active_wave ? "default" : "outline"}
                          size="sm"
                          className="text-[10px] h-6"
                          onClick={() => toggleWave(c.cluster_id, !c.is_active_wave)}
                        >
                          {c.is_active_wave ? '🎯 Aktiv' : 'Aktivieren'}
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                      <MetricBar label="Abdeckung" value={c.market_coverage} />
                      <MetricBar label="Ø Authority" value={c.avg_authority} />
                      <MetricBar label="Revenue" value={c.revenue_share} suffix="%" />
                      <MetricBar label="SEO" value={c.seo_visibility} />
                      <MetricBar label="Konkurrenz" value={c.competition_diff} />
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground w-20">Portfolio</span>
                        <span className="text-[10px] font-mono text-foreground">
                          {c.total} Berufe · {c.optimize} Opt · {c.authority} Auth
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Expansion Queue */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ArrowUpRight className="h-4 w-4" /> Expansions-Prioritäten
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Berufe mit höchster Expansion Priority (40% Completion Gap + 30% Nachfrage + 20% Konkurrenzschwäche + 10% Synergie)
          </p>
          <ExpansionQueue />
        </CardContent>
      </Card>
    </div>
  );
}

function ExpansionQueue() {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from('portfolio_priority')
        .select('id, occupation_slug, demand_score, competition_score, authority_index, expansion_priority, cluster_id')
        .gt('expansion_priority', 0)
        .order('expansion_priority', { ascending: false })
        .limit(15);
      setEntries(data || []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <Loader2 className="h-4 w-4 animate-spin text-primary mx-auto" />;
  if (entries.length === 0) return <p className="text-xs text-muted-foreground text-center">Keine Einträge. Cluster-IDs in portfolio_priority zuweisen.</p>;

  return (
    <div className="space-y-1">
      {entries.map((e, i) => (
        <div key={e.id} className="flex items-center gap-3 py-1.5 border-b border-border/30 last:border-0">
          <span className="text-[10px] text-muted-foreground w-5">#{i + 1}</span>
          <span className="text-xs text-foreground flex-1 truncate">{e.occupation_slug || e.id.slice(0, 8)}</span>
          <span className="text-[10px] text-muted-foreground">D:{e.demand_score}</span>
          <span className="text-[10px] text-muted-foreground">C:{e.competition_score}</span>
          <span className={cn("text-xs font-mono font-bold",
            e.expansion_priority >= 70 ? 'text-success' : e.expansion_priority >= 40 ? 'text-warning' : 'text-muted-foreground'
          )}>{Math.round(e.expansion_priority)}</span>
        </div>
      ))}
    </div>
  );
}
