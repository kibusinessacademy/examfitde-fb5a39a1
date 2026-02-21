import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { formatEurAmount } from '@/lib/timezone';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  TrendingUp, TrendingDown, Euro, Users, Target,
  Brain, AlertTriangle, Activity, RefreshCw, Loader2,
  BarChart3, Zap, Shield, Sparkles
} from 'lucide-react';

interface DailyKPI {
  date: string;
  revenue_eur: number;
  mau: number;
  dau: number;
  pass_rate_7d: number | null;
  pass_rate_14d: number | null;
  pass_rate_30d: number | null;
  retention_7d: number | null;
  retention_30d: number | null;
  llm_cost_eur: number;
  cost_per_pass_eur: number | null;
  drift_events: number;
  churn_rate: number | null;
  coach_usage_rate: number | null;
  active_subscriptions: number;
  new_signups: number;
  exam_sessions: number;
  avg_score: number | null;
  shares_total: number;
  shares_whatsapp: number;
  shares_linkedin: number;
  badge_share_rate: number;
  referral_claims: number;
  referral_conversion: number;
}

function KPICard({ icon, label, value, sub, trend, color = 'text-foreground' }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string;
  trend?: 'up' | 'down' | 'neutral'; color?: string;
}) {
  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-1.5 mb-1 text-muted-foreground">
          {icon}
          <span className="text-[10px] uppercase tracking-wider truncate">{label}</span>
          {trend === 'up' && <TrendingUp className="h-3 w-3 text-success ml-auto" />}
          {trend === 'down' && <TrendingDown className="h-3 w-3 text-destructive ml-auto" />}
        </div>
        <p className={cn("text-xl font-bold font-mono", color)}>{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function PassRateBar({ label, value }: { label: string; value: number | null }) {
  const pct = value ? Math.round(value * 100) : 0;
  const color = pct >= 70 ? 'bg-success' : pct >= 50 ? 'bg-warning' : 'bg-destructive';
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground w-8">{label}</span>
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono w-10 text-right">{pct}%</span>
    </div>
  );
}

export default function CEODailyKPIs() {
  const [kpis, setKpis] = useState<DailyKPI[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('ceo_daily_kpis')
        .select('*')
        .order('date', { ascending: false })
        .limit(7);
      if (!error && data) setKpis(data);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;

  const today = kpis[0];
  const yesterday = kpis[1];

  if (!today) return (
    <Card>
      <CardContent className="py-8 text-center text-sm text-muted-foreground">
        Noch keine CEO-KPIs. Der daily-test-runner erstellt diese automatisch.
      </CardContent>
    </Card>
  );

  const passTrend = today.pass_rate_7d && yesterday?.pass_rate_7d
    ? (today.pass_rate_7d > yesterday.pass_rate_7d ? 'up' : today.pass_rate_7d < yesterday.pass_rate_7d ? 'down' : 'neutral')
    : 'neutral';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">CEO Daily KPIs</h2>
          <Badge variant="outline" className="text-[10px]">{today.date}</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>

      {/* Primary Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPICard
          icon={<BarChart3 className="h-3.5 w-3.5" />}
          label="Exam Sessions"
          value={today.exam_sessions}
          sub="Heute"
        />
        <KPICard
          icon={<Target className="h-3.5 w-3.5" />}
          label="Ø Score"
          value={today.avg_score ? `${today.avg_score.toFixed(1)}%` : '—'}
          trend={passTrend as 'up' | 'down' | 'neutral'}
          color={today.avg_score && today.avg_score >= 60 ? 'text-success' : 'text-warning'}
        />
        <KPICard
          icon={<Euro className="h-3.5 w-3.5" />}
          label="LLM-Kosten"
          value={formatEurAmount(today.llm_cost_eur)}
          sub="Heute"
          color={today.llm_cost_eur > 50 ? 'text-destructive' : 'text-foreground'}
        />
        <KPICard
          icon={<Zap className="h-3.5 w-3.5" />}
          label="Kosten/Pass"
          value={today.cost_per_pass_eur ? formatEurAmount(today.cost_per_pass_eur) : '—'}
          sub="pro bestandener Prüfung"
        />
      </div>

      {/* Secondary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPICard
          icon={<Users className="h-3.5 w-3.5" />}
          label="Aktive Lizenzen"
          value={today.active_subscriptions}
        />
        <KPICard
          icon={<Brain className="h-3.5 w-3.5" />}
          label="Coach-Nutzung"
          value={today.coach_usage_rate ? `${(today.coach_usage_rate * 100).toFixed(0)}%` : '—'}
        />
        <KPICard
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          label="Drift-Events"
          value={today.drift_events}
          color={today.drift_events > 0 ? 'text-destructive' : 'text-success'}
        />
        <KPICard
          icon={<Shield className="h-3.5 w-3.5" />}
          label="Neue Signups"
          value={today.new_signups}
        />
      </div>

      {/* Pass Rate Bars */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4" /> Bestehensquoten
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <PassRateBar label="7d" value={today.pass_rate_7d} />
          <PassRateBar label="14d" value={today.pass_rate_14d} />
          <PassRateBar label="30d" value={today.pass_rate_30d} />
        </CardContent>
      </Card>

      {/* Growth Loop KPIs */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Growth Loop
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="text-center">
              <p className="text-2xl font-bold font-mono">{today.shares_total}</p>
              <p className="text-[10px] text-muted-foreground">Shares heute</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold font-mono">{today.referral_claims}</p>
              <p className="text-[10px] text-muted-foreground">Referral Claims</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold font-mono">
                {today.badge_share_rate ? `${(today.badge_share_rate * 100).toFixed(0)}%` : '—'}
              </p>
              <p className="text-[10px] text-muted-foreground">Badge→Share Rate</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 7-Day Trend */}
      {kpis.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">7-Tage Verlauf</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 h-16">
              {[...kpis].reverse().map((k, i) => {
                const maxSessions = Math.max(...kpis.map(kk => kk.exam_sessions || 1));
                const h = maxSessions > 0 ? (k.exam_sessions / maxSessions) * 100 : 0;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className="w-full bg-primary/30 rounded-t"
                      style={{ height: `${Math.max(4, h)}%` }}
                    />
                    <span className="text-[8px] text-muted-foreground">
                      {k.date.split('-').slice(1).join('.')}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
