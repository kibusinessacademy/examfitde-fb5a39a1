import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { Factory, Shield, Gem, DollarSign, Building2 } from 'lucide-react';

type Light = 'green' | 'yellow' | 'red';

interface Ampel {
  key: string;
  label: string;
  icon: React.ElementType;
  light: Light;
  score: number;
  detail: string;
}

const lightStyles: Record<Light, { bg: string; ring: string; text: string; dot: string }> = {
  green: { bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/30', text: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
  yellow: { bg: 'bg-yellow-500/10', ring: 'ring-yellow-500/30', text: 'text-yellow-600 dark:text-yellow-400', dot: 'bg-yellow-500' },
  red: { bg: 'bg-destructive/10', ring: 'ring-destructive/30', text: 'text-destructive', dot: 'bg-destructive' },
};

function toLight(score: number): Light {
  if (score >= 80) return 'green';
  if (score >= 50) return 'yellow';
  return 'red';
}

export default function CommandStatusBoard() {
  const [ampels, setAmpels] = useState<Ampel[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        // Fetch from multiple sources in parallel
        const [healthRes, kpiRes, riskRes, tenantRes] = await Promise.all([
          (supabase as any).from('ops_health_summary').select('*').single(),
          (supabase as any).from('kpi_daily_rollup').select('*').order('day', { ascending: false }).limit(1).single(),
          (supabase as any).from('platform_risk_scores').select('*').order('computed_at', { ascending: false }).limit(1).single(),
          (supabase as any).from('tenant_release_gates').select('status').eq('status', 'pending'),
        ]);

        const health = healthRes.data;
        const kpi = kpiRes.data;
        const risk = riskRes.data;
        const pendingTenants = tenantRes.data?.length ?? 0;

        // 1. Production
        const prodScore = health
          ? Math.max(0, 100 - (health.stuck_jobs ?? 0) * 15 - (health.failed_packages ?? 0) * 10 - Math.max(0, (health.failed_1h ?? 0) - 3) * 5)
          : 50;

        // 2. Quality  
        const qualityScore = health
          ? Math.max(0, 100 - (health.integrity_issues ?? 0) * 20)
          : 50;

        // 3. Security
        const secScore = risk?.overall_score != null
          ? Math.max(0, 100 - risk.overall_score)
          : 85;

        // 4. Budget
        const costToday = kpi?.cost_total_eur ?? 0;
        const budgetLimit = 50; // daily soft limit €
        const budgetScore = Math.max(0, Math.round(100 - (costToday / budgetLimit) * 100));

        // 5. Tenant Risk
        const tenantScore = pendingTenants === 0 ? 100 : pendingTenants <= 2 ? 70 : 40;

        setAmpels([
          {
            key: 'production',
            label: 'Produktion',
            icon: Factory,
            light: toLight(prodScore),
            score: Math.round(prodScore),
            detail: `${health?.active_builds ?? 0} Builds · ${health?.stuck_jobs ?? 0} Stuck · ${kpi?.jobs_completed ?? 0} Jobs/Tag`,
          },
          {
            key: 'quality',
            label: 'Qualität',
            icon: Gem,
            light: toLight(qualityScore),
            score: Math.round(qualityScore),
            detail: `${health?.integrity_issues ?? 0} Integrity Issues · ${health?.live_packages ?? 0} Live`,
          },
          {
            key: 'security',
            label: 'Security',
            icon: Shield,
            light: toLight(secScore),
            score: Math.round(secScore),
            detail: risk ? `Risk Score ${risk.overall_score ?? 0}` : 'Frozen ✓',
          },
          {
            key: 'budget',
            label: 'Budget',
            icon: DollarSign,
            light: toLight(budgetScore),
            score: Math.round(Math.max(0, budgetScore)),
            detail: `€${costToday.toFixed(1)} heute · Backlog ${kpi?.backlog_jobs ?? 0}`,
          },
          {
            key: 'tenant',
            label: 'Mandanten',
            icon: Building2,
            light: toLight(tenantScore),
            score: Math.round(tenantScore),
            detail: `${pendingTenants} pending Freigaben`,
          },
        ]);
      } catch (e) {
        console.error('[StatusBoard]', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
    );
  }

  if (!ampels) return null;

  const overallLight: Light = ampels.some(a => a.light === 'red')
    ? 'red'
    : ampels.some(a => a.light === 'yellow')
      ? 'yellow'
      : 'green';

  const overallLabel = { green: 'Alle Systeme operativ', yellow: 'Aufmerksamkeit erforderlich', red: 'Kritische Probleme' }[overallLight];

  return (
    <div className="space-y-3">
      {/* Overall Status Bar */}
      <div className={cn(
        'flex items-center gap-3 rounded-lg px-4 py-2 ring-1',
        lightStyles[overallLight].bg,
        lightStyles[overallLight].ring,
      )}>
        <div className={cn('h-3 w-3 rounded-full animate-pulse', lightStyles[overallLight].dot)} />
        <span className={cn('text-sm font-semibold', lightStyles[overallLight].text)}>{overallLabel}</span>
        <Badge variant="outline" className="ml-auto text-[10px]">
          Avg {Math.round(ampels.reduce((s, a) => s + a.score, 0) / ampels.length)}
        </Badge>
      </div>

      {/* 5 Ampel Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {ampels.map(a => {
          const style = lightStyles[a.light];
          const Icon = a.icon;
          return (
            <Card key={a.key} className={cn('ring-1', style.ring, style.bg)}>
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className={cn('h-2.5 w-2.5 rounded-full', style.dot)} />
                  <Icon className={cn('h-3.5 w-3.5', style.text)} />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{a.label}</span>
                </div>
                <p className={cn('text-2xl font-bold', style.text)}>{a.score}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{a.detail}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
