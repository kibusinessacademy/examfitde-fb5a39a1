import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  Crown, TrendingUp, Shield, AlertTriangle, CheckCircle2,
  XCircle, RefreshCw, Loader2, Target, Activity, Zap,
  BarChart3, Eye, DollarSign, Globe, Sparkles
} from 'lucide-react';
import { toast } from 'sonner';

interface PortfolioHealth {
  phi: number;
  avg_authority: number;
  avg_governance: number;
  avg_confidence: number;
  total_berufe: number;
  covered_optimize: number;
  covered_authority: number;
  top_revenue: any[];
  top_risk: any[];
  sector_coverage: any[];
  authority_pipeline: any[];
}

function PHIGauge({ value }: { value: number }) {
  const color = value >= 85 ? 'text-success' : value >= 65 ? 'text-warning' : 'text-destructive';
  const bg = value >= 85 ? 'bg-success/10' : value >= 65 ? 'bg-warning/10' : 'bg-destructive/10';
  return (
    <div className={cn("flex flex-col items-center justify-center p-6 rounded-xl", bg)}>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Portfolio Health Index</p>
      <p className={cn("text-5xl font-black font-mono", color)}>{Math.round(value)}</p>
      <p className="text-xs text-muted-foreground mt-1">/ 100</p>
      <div className="flex items-center gap-1 mt-2">
        {value >= 85 ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <AlertTriangle className="h-3.5 w-3.5 text-warning" />}
        <span className={cn("text-xs font-medium", color)}>
          {value >= 85 ? 'Exzellent' : value >= 65 ? 'Aufbauphase' : 'Kritisch'}
        </span>
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value, sub, color = 'text-foreground' }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center gap-2 mb-2 text-muted-foreground">{icon}<span className="text-[10px] uppercase tracking-wider">{label}</span></div>
        <p className={cn("text-2xl font-bold font-mono", color)}>{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

const AUTHORITY_COLORS: Record<string, string> = {
  authority: 'bg-success/20 text-success border-success/30',
  advanced: 'bg-primary/20 text-primary border-primary/30',
  optimize: 'bg-warning/20 text-warning border-warning/30',
  ship: 'bg-muted text-muted-foreground border-border',
};

export default function CEOStrategicDashboard() {
  const [data, setData] = useState<PortfolioHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [promoting, setPromoting] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data: result, error } = await (supabase as any).rpc('evaluate_portfolio_health');
      if (error) throw error;
      setData(result);
    } catch (e: any) {
      toast.error(e.message || 'Fehler beim Laden');
    } finally {
      setLoading(false);
    }
  };

  const promoteToAuthority = async (portfolioId: string) => {
    setPromoting(portfolioId);
    try {
      const { data: result, error } = await (supabase as any).rpc('promote_to_authority', {
        p_portfolio_id: portfolioId,
        p_admin_id: 'ceo',
      });
      if (error) throw error;
      if (result.ok) {
        toast.success('Authority-Status verliehen!');
      } else {
        toast.error(`Ablehnung: ${(result.issues || []).join(', ')}`);
      }
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setPromoting(null);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  if (!data) return <p className="text-sm text-muted-foreground text-center py-8">Keine Portfolio-Daten verfügbar</p>;

  const coveragePct = data.total_berufe > 0 ? Math.round((data.covered_optimize / data.total_berufe) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Crown className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">CEO Strategic Command</h2>
        </div>
        <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>

      {/* PHI + Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <PHIGauge value={data.phi} />
        <div className="md:col-span-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
          <MetricCard icon={<Globe className="h-3.5 w-3.5" />} label="Berufe gesamt" value={data.total_berufe} sub={`${coveragePct}% ≥ Optimize`} />
          <MetricCard icon={<Crown className="h-3.5 w-3.5" />} label="Authority" value={data.covered_authority} color="text-success" sub="Marktführer-Kurse" />
          <MetricCard icon={<Target className="h-3.5 w-3.5" />} label="≥ Optimize" value={data.covered_optimize} color="text-primary" sub="Produktionsreif" />
          <MetricCard icon={<Sparkles className="h-3.5 w-3.5" />} label="Ø Authority Index" value={Math.round(data.avg_authority)} color={data.avg_authority >= 70 ? 'text-success' : 'text-warning'} />
          <MetricCard icon={<Shield className="h-3.5 w-3.5" />} label="Ø Governance" value={Math.round(data.avg_governance)} color={data.avg_governance >= 80 ? 'text-success' : 'text-warning'} />
          <MetricCard icon={<Activity className="h-3.5 w-3.5" />} label="Ø Confidence" value={Math.round(data.avg_confidence)} color={data.avg_confidence >= 85 ? 'text-success' : 'text-warning'} />
        </div>
      </div>

      {/* Sector Coverage (Dominanz-Map) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Globe className="h-4 w-4" /> Markt-Abdeckung nach Branche</CardTitle>
        </CardHeader>
        <CardContent>
          {data.sector_coverage.length === 0 ? (
            <p className="text-xs text-muted-foreground">Keine Sektoren zugewiesen. Setze market_sector in portfolio_priority.</p>
          ) : (
            <div className="space-y-2">
              {data.sector_coverage.map((s: any, i: number) => {
                const pct = s.total > 0 ? Math.round((s.optimize_plus / s.total) * 100) : 0;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs text-foreground w-28 truncate">{s.sector}</span>
                    <Progress value={pct} className="h-2 flex-1" />
                    <span className="text-[10px] text-muted-foreground w-20 text-right">
                      {s.optimize_plus}/{s.total} ({pct}%)
                    </span>
                    <Badge variant="outline" className="text-[9px]">Ø {s.avg_index}</Badge>
                    {s.authority > 0 && <Badge className="text-[9px] bg-success/20 text-success">{s.authority} Auth</Badge>}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Authority Pipeline */}
      <Card className="border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Crown className="h-4 w-4 text-primary" /> Authority Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          {data.authority_pipeline.length === 0 ? (
            <p className="text-xs text-muted-foreground">Keine Kurse nahe Authority-Level</p>
          ) : (
            <div className="space-y-2">
              {data.authority_pipeline.map((p: any, i: number) => {
                const gap = Math.max(0, 93 - (p.authority_index || 0));
                const level = p.authority_index >= 93 ? 'authority' : p.authority_index >= 85 ? 'advanced' : 'optimize';
                return (
                  <div key={i} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-foreground truncate">{p.occupation_slug || '—'}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-muted-foreground">C:{Math.round(p.confidence || 0)}</span>
                        <span className="text-[10px] text-muted-foreground">G:{Math.round(p.governance_score || 0)}</span>
                        <span className="text-[10px] text-muted-foreground">Audits:{p.audit_cycles_passed || 0}</span>
                      </div>
                    </div>
                    <Badge className={cn("text-[9px]", AUTHORITY_COLORS[level])}>{level}</Badge>
                    <div className="text-right w-16">
                      <p className={cn("text-sm font-bold font-mono", p.authority_index >= 93 ? 'text-success' : 'text-primary')}>
                        {Math.round(p.authority_index || 0)}
                      </p>
                      {gap > 0 && <p className="text-[9px] text-muted-foreground">-{gap.toFixed(0)} to Auth</p>}
                    </div>
                    {p.authority_index >= 93 && p.authority_status !== 'authority' && (
                      <Button
                        size="sm"
                        className="text-[10px] h-6"
                        onClick={() => promoteToAuthority(p.id)}
                        disabled={promoting === p.id}
                      >
                        {promoting === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Crown className="h-3 w-3 mr-1" />}
                        Promote
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quadrant: Top Revenue + Risk */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Top Revenue */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><DollarSign className="h-4 w-4 text-success" /> Top Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            {data.top_revenue.length === 0 ? (
              <p className="text-xs text-muted-foreground">Noch keine Umsatzdaten</p>
            ) : (
              <div className="space-y-1">
                {data.top_revenue.map((r: any, i: number) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                    <span className="text-xs text-foreground truncate flex-1">{r.occupation_slug || '—'}</span>
                    <span className="text-xs font-mono text-success">{r.revenue_monthly?.toFixed(0) || 0}€</span>
                    <Badge className={cn("text-[9px] ml-2", AUTHORITY_COLORS[r.authority_status || 'ship'])}>{r.authority_status || 'ship'}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Risk Radar */}
        <Card className="border-destructive/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" /> Risk Radar</CardTitle>
          </CardHeader>
          <CardContent>
            {data.top_risk.length === 0 ? (
              <p className="text-xs text-muted-foreground">Keine Risiken erkannt ✓</p>
            ) : (
              <div className="space-y-1">
                {data.top_risk.map((r: any, i: number) => {
                  const issues: string[] = [];
                  if ((r.confidence || 0) < 80) issues.push(`C:${Math.round(r.confidence || 0)}`);
                  if ((r.governance_score || 0) < 70) issues.push(`G:${Math.round(r.governance_score || 0)}`);
                  return (
                    <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                      <span className="text-xs text-foreground truncate flex-1">{r.occupation_slug || '—'}</span>
                      <div className="flex gap-1">
                        {issues.map((iss, j) => (
                          <Badge key={j} variant="outline" className="text-[9px] text-destructive border-destructive/30">{iss}</Badge>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
