import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  Rocket, TrendingUp, Shield, AlertTriangle, CheckCircle2,
  XCircle, RefreshCw, Loader2, Play, Pause, BarChart3,
  Target, Zap, Activity, Settings, Crown, Globe, Layers
} from 'lucide-react';
import { toast } from 'sonner';

interface RolloutControl {
  id: string;
  mode: string;
  strategy: string;
  min_confidence_avg: number;
  min_governance_avg: number;
  max_global_dup_rate: number;
  max_provider_risk: number;
  max_concurrent_builds: number;
  weekly_target: number;
  base_exam_target: number;
  min_lf_coverage_base: number;
  coverage_target_pct: number;
  max_authority_slots: number;
  ship_level_config: Record<string, number>;
}

interface CoverageStats {
  total_berufe: number;
  base_covered: number;
  optimize_covered: number;
  authority_covered: number;
  not_started: number;
  coverage_pct: number;
  target_pct: number;
  base_exam_target: number;
  max_authority_slots: number;
  strategy: string;
  levels: Record<string, { exam_target: number; min_confidence: number; count: number }>;
}

interface PortfolioEntry {
  id: string;
  beruf_id: string;
  occupation_slug: string | null;
  demand_score: number;
  revenue_potential_score: number;
  competition_score: number;
  completion_status: string;
  confidence: number;
  governance_score: number;
  coverage_level: string;
  coverage_priority: number;
  priority_index: number;
  ship_level: string;
  exam_target: number;
}

interface ReadinessResult {
  ready: boolean;
  mode: string;
  avg_confidence: number;
  avg_governance: number;
  global_dup_rate: number;
  max_provider_risk: number;
  issues: string[];
}

function ModeIndicator({ mode, strategy }: { mode: string; strategy: string }) {
  const cfg: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
    mass_production: { icon: <Rocket className="h-4 w-4" />, color: 'text-success', label: 'Mass Production' },
    controlled: { icon: <Shield className="h-4 w-4" />, color: 'text-warning', label: 'Controlled' },
    paused: { icon: <Pause className="h-4 w-4" />, color: 'text-destructive', label: 'Paused' },
  };
  const c = cfg[mode] || cfg.controlled;
  return (
    <div className="flex items-center gap-2">
      <span className={c.color}>{c.icon}</span>
      <span className={cn("text-sm font-bold", c.color)}>{c.label}</span>
      <Badge variant="outline" className="text-[9px]">TCS</Badge>
    </div>
  );
}

function ReadinessGate({ label, ok, value, threshold, unit = '' }: {
  label: string; ok: boolean; value: number; threshold: number; unit?: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <XCircle className="h-3.5 w-3.5 text-destructive" />}
      <span className="text-foreground">{label}</span>
      <span className="font-mono text-muted-foreground">{value.toFixed(1)}{unit}</span>
      <span className="text-muted-foreground">/ {threshold}{unit}</span>
    </div>
  );
}

const LEVEL_STYLES: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
  authority: { color: 'text-success', bg: 'bg-success/10', icon: <Crown className="h-4 w-4" /> },
  optimize: { color: 'text-primary', bg: 'bg-primary/10', icon: <TrendingUp className="h-4 w-4" /> },
  base: { color: 'text-warning', bg: 'bg-warning/10', icon: <Layers className="h-4 w-4" /> },
};

export default function MassRolloutDashboard() {
  const [control, setControl] = useState<RolloutControl | null>(null);
  const [coverage, setCoverage] = useState<CoverageStats | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioEntry[]>([]);
  const [readiness, setReadiness] = useState<ReadinessResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editValues, setEditValues] = useState<Partial<RolloutControl>>({});

  const load = async () => {
    const [ctrlRes, portRes] = await Promise.all([
      (supabase as any).from('rollout_control').select('*').eq('is_active', true).limit(1).maybeSingle(),
      (supabase as any).from('portfolio_priority').select('*').order('coverage_priority', { ascending: false }).limit(100),
    ]);
    setControl(ctrlRes.data);
    setPortfolio(portRes.data || []);
    if (ctrlRes.data) setEditValues(ctrlRes.data);

    // Load coverage stats
    try {
      const { data: stats } = await (supabase as any).rpc('get_coverage_stats');
      setCoverage(stats);
    } catch {}

    setLoading(false);
  };

  const evaluateReadiness = async () => {
    setEvaluating(true);
    try {
      const { data, error } = await (supabase as any).rpc('evaluate_rollout_readiness');
      if (error) throw error;
      setReadiness(data);
      toast.success(`Rollout-Bereitschaft: ${data.ready ? 'BEREIT' : 'NICHT BEREIT'}`);
    } catch (e: any) {
      toast.error(e.message || 'Fehler');
    } finally {
      setEvaluating(false);
    }
  };

  const recalcPriorities = async () => {
    setRecalculating(true);
    try {
      const { data, error } = await (supabase as any).rpc('recalculate_coverage_priorities');
      if (error) throw error;
      toast.success(`${data.updated} Berufe neu priorisiert`);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRecalculating(false);
    }
  };

  const saveControl = async () => {
    if (!control) return;
    await (supabase as any).from('rollout_control').update({
      min_confidence_avg: editValues.min_confidence_avg,
      min_governance_avg: editValues.min_governance_avg,
      max_global_dup_rate: editValues.max_global_dup_rate,
      max_provider_risk: editValues.max_provider_risk,
      max_concurrent_builds: editValues.max_concurrent_builds,
      weekly_target: editValues.weekly_target,
      base_exam_target: editValues.base_exam_target,
      coverage_target_pct: editValues.coverage_target_pct,
      max_authority_slots: editValues.max_authority_slots,
      min_lf_coverage_base: editValues.min_lf_coverage_base,
      updated_at: new Date().toISOString(),
    }).eq('id', control.id);
    toast.success('Konfiguration gespeichert');
    setEditMode(false);
    load();
  };

  const setMode = async (mode: string) => {
    if (!control) return;
    await (supabase as any).from('rollout_control').update({ mode, updated_at: new Date().toISOString() }).eq('id', control.id);
    toast.success(`Modus → ${mode}`);
    load();
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;

  const totalBerufe = coverage?.total_berufe || 0;
  const covPct = coverage?.coverage_pct || 0;
  const targetPct = coverage?.target_pct || 95;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">Total Coverage Engine</h2>
          {control && <ModeIndicator mode={control.mode} strategy={control.strategy || 'total_coverage'} />}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setEditMode(!editMode)}><Settings className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5" /></Button>
          <Button size="sm" variant="outline" onClick={recalcPriorities} disabled={recalculating}>
            {recalculating ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Zap className="h-3.5 w-3.5 mr-1" />}
            Prioritäten neu berechnen
          </Button>
          <Button size="sm" onClick={evaluateReadiness} disabled={evaluating}>
            {evaluating ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Activity className="h-3.5 w-3.5 mr-1" />}
            Readiness
          </Button>
        </div>
      </div>

      {/* Coverage Progress */}
      <Card className={cn("border-l-4", covPct >= targetPct ? 'border-l-success' : covPct >= 50 ? 'border-l-warning' : 'border-l-destructive')}>
        <CardContent className="py-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm font-bold text-foreground">Marktabdeckung: {covPct}%</p>
              <p className="text-xs text-muted-foreground">Ziel: {targetPct}% aller {totalBerufe} Ausbildungsberufe ≥ Base-Level</p>
            </div>
            <span className={cn("text-2xl font-black font-mono",
              covPct >= targetPct ? 'text-success' : covPct >= 50 ? 'text-warning' : 'text-destructive'
            )}>{covPct}%</span>
          </div>
          <Progress value={covPct} className="h-3" />
        </CardContent>
      </Card>

      {/* Three-Tier Strategy */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {(['base', 'optimize', 'authority'] as const).map(level => {
          const style = LEVEL_STYLES[level];
          const lvl = coverage?.levels?.[level];
          const count = lvl?.count || 0;
          return (
            <Card key={level} className={cn("border", style.bg)}>
              <CardContent className="py-4 text-center">
                <div className="flex items-center justify-center gap-1.5 mb-2">
                  <span className={style.color}>{style.icon}</span>
                  <span className={cn("text-xs font-bold uppercase tracking-wider", style.color)}>{level}</span>
                </div>
                <p className="text-3xl font-black font-mono text-foreground">{count}</p>
                <p className="text-[10px] text-muted-foreground mt-1">Berufe</p>
                <div className="mt-2 space-y-0.5">
                  <p className="text-[10px] text-muted-foreground">≥ {lvl?.exam_target || '—'} Fragen</p>
                  <p className="text-[10px] text-muted-foreground">Confidence ≥ {lvl?.min_confidence || '—'}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Mode Controls */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground mr-2">Modus:</span>
            {['controlled', 'mass_production', 'paused'].map(m => (
              <Button
                key={m}
                size="sm"
                variant={control?.mode === m ? 'default' : 'outline'}
                className="text-xs h-7"
                onClick={() => setMode(m)}
              >
                {m === 'controlled' ? '🛡 Controlled' : m === 'mass_production' ? '🚀 Mass Production' : '⏸ Paused'}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Edit Panel */}
      {editMode && control && (
        <Card className="border-primary/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">TCS-Parameter</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[
                { key: 'min_confidence_avg', label: 'Min Confidence Ø', min: 50, max: 100 },
                { key: 'min_governance_avg', label: 'Min Governance Ø', min: 50, max: 100 },
                { key: 'max_global_dup_rate', label: 'Max Dup-Rate %', min: 1, max: 10 },
                { key: 'max_provider_risk', label: 'Max Provider Risk', min: 20, max: 100 },
                { key: 'max_concurrent_builds', label: 'Max Concurrent', min: 1, max: 20 },
                { key: 'weekly_target', label: 'Wochenziel', min: 5, max: 100 },
                { key: 'base_exam_target', label: 'Base Fragen-Min', min: 400, max: 1000 },
                { key: 'coverage_target_pct', label: 'Coverage-Ziel %', min: 80, max: 100 },
                { key: 'max_authority_slots', label: 'Max Authority', min: 5, max: 50 },
              ].map(f => (
                <div key={f.key}>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">{f.label}</label>
                  <input
                    type="number"
                    min={f.min}
                    max={f.max}
                    value={(editValues as any)[f.key] ?? 0}
                    onChange={e => setEditValues(v => ({ ...v, [f.key]: parseFloat(e.target.value) }))}
                    className="w-full mt-1 px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-3">
              <Button size="sm" onClick={saveControl}>Speichern</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Readiness */}
      {readiness && (
        <Card className={cn("border-l-4", readiness.ready ? 'border-l-success' : 'border-l-destructive')}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              {readiness.ready ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertTriangle className="h-4 w-4 text-destructive" />}
              Rollout-Bereitschaft: {readiness.ready ? 'BEREIT' : 'NICHT BEREIT'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <ReadinessGate label="Confidence Ø" ok={readiness.avg_confidence >= (control?.min_confidence_avg || 82)} value={readiness.avg_confidence} threshold={control?.min_confidence_avg || 82} />
              <ReadinessGate label="Governance Ø" ok={readiness.avg_governance >= (control?.min_governance_avg || 78)} value={readiness.avg_governance} threshold={control?.min_governance_avg || 78} />
              <ReadinessGate label="Dup-Rate global" ok={readiness.global_dup_rate <= (control?.max_global_dup_rate || 3)} value={readiness.global_dup_rate} threshold={control?.max_global_dup_rate || 3} unit="%" />
              <ReadinessGate label="Provider Risk" ok={readiness.max_provider_risk <= (control?.max_provider_risk || 60)} value={readiness.max_provider_risk} threshold={control?.max_provider_risk || 60} />
            </div>
            {readiness.issues.length > 0 && (
              <div className="mt-3 space-y-1">
                {readiness.issues.map((issue, i) => (
                  <p key={i} className="text-xs text-destructive flex items-center gap-1">
                    <XCircle className="h-3 w-3 shrink-0" /> {issue}
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Coverage Queue */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Coverage-Priorität ({portfolio.length} Berufe)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {portfolio.slice(0, 25).map(p => {
              const style = LEVEL_STYLES[p.coverage_level] || LEVEL_STYLES.base;
              return (
                <div key={p.id} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
                  <div className="w-10 text-center">
                    <span className={cn("text-sm font-bold font-mono",
                      p.coverage_priority >= 70 ? 'text-success' : p.coverage_priority >= 40 ? 'text-warning' : 'text-muted-foreground'
                    )}>{Math.round(p.coverage_priority)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground truncate">{p.occupation_slug || p.beruf_id.slice(0, 8)}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[9px] text-muted-foreground">D:{p.demand_score}</span>
                      <span className="text-[9px] text-muted-foreground">R:{p.revenue_potential_score}</span>
                      <span className="text-[9px] text-muted-foreground">C:{p.competition_score}</span>
                    </div>
                  </div>
                  <Badge className={cn("text-[9px]", style.color, style.bg)}>
                    {p.coverage_level.toUpperCase()}
                  </Badge>
                  <span className="text-[10px] font-mono text-muted-foreground">{p.exam_target}Q</span>
                  <Badge variant="outline" className="text-[9px]">{p.completion_status}</Badge>
                </div>
              );
            })}
          </div>
          {portfolio.length > 25 && (
            <p className="text-xs text-muted-foreground mt-2 text-center">+ {portfolio.length - 25} weitere</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
