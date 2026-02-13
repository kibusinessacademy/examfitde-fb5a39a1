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
  Target, Zap, Activity, Settings
} from 'lucide-react';
import { toast } from 'sonner';

interface RolloutControl {
  id: string;
  mode: string;
  min_confidence_avg: number;
  min_governance_avg: number;
  max_global_dup_rate: number;
  max_provider_risk: number;
  max_concurrent_builds: number;
  weekly_target: number;
  ship_level_config: { ship: number; optimize: number; authority: number };
  auto_upgrade_threshold: { min_sales: number; min_conversion: number; min_governance: number };
}

interface PortfolioEntry {
  id: string;
  beruf_id: string;
  occupation_slug: string | null;
  demand_score: number;
  revenue_potential_score: number;
  competition_score: number;
  completion_status: string;
  quality_status: string;
  confidence: number;
  governance_score: number;
  release_status: string;
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

function ModeIndicator({ mode }: { mode: string }) {
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

const SHIP_COLORS: Record<string, string> = {
  ship: 'bg-primary/20 text-primary',
  optimize: 'bg-warning/20 text-warning',
  authority: 'bg-success/20 text-success',
};

export default function MassRolloutDashboard() {
  const [control, setControl] = useState<RolloutControl | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioEntry[]>([]);
  const [readiness, setReadiness] = useState<ReadinessResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editValues, setEditValues] = useState<Partial<RolloutControl>>({});

  const load = async () => {
    const [ctrlRes, portRes] = await Promise.all([
      (supabase as any).from('rollout_control').select('*').eq('is_active', true).limit(1).maybeSingle(),
      (supabase as any).from('portfolio_priority').select('*').order('priority_index', { ascending: false }).limit(100),
    ]);
    setControl(ctrlRes.data);
    setPortfolio(portRes.data || []);
    if (ctrlRes.data) setEditValues(ctrlRes.data);
    setLoading(false);
  };

  const evaluateReadiness = async () => {
    setEvaluating(true);
    try {
      const { data, error } = await (supabase as any).rpc('evaluate_rollout_readiness');
      if (error) throw error;
      setReadiness(data);
      toast.success(`Rollout-Bereitschaft: ${data.ready ? 'BEREIT' : 'NICHT BEREIT'}`);
      load();
    } catch (e: any) {
      toast.error(e.message || 'Fehler');
    } finally {
      setEvaluating(false);
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
      updated_at: new Date().toISOString(),
    }).eq('id', control.id);
    toast.success('Rollout-Konfiguration gespeichert');
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

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }

  const shipLevels = control?.ship_level_config || { ship: 850, optimize: 1000, authority: 1200 };
  const byStatus: Record<string, number> = {};
  portfolio.forEach(p => { byStatus[p.completion_status] = (byStatus[p.completion_status] || 0) + 1; });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Rocket className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">Mass Rollout Engine</h2>
          {control && <ModeIndicator mode={control.mode} />}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setEditMode(!editMode)}>
            <Settings className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" onClick={evaluateReadiness} disabled={evaluating}>
            {evaluating ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Activity className="h-3.5 w-3.5 mr-1" />}
            Readiness Check
          </Button>
        </div>
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
            <CardTitle className="text-sm">Rollout-Parameter</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[
                { key: 'min_confidence_avg', label: 'Min Confidence Ø', min: 50, max: 100 },
                { key: 'min_governance_avg', label: 'Min Governance Ø', min: 50, max: 100 },
                { key: 'max_global_dup_rate', label: 'Max Dup-Rate %', min: 1, max: 10 },
                { key: 'max_provider_risk', label: 'Max Provider Risk', min: 20, max: 100 },
                { key: 'max_concurrent_builds', label: 'Max Concurrent', min: 1, max: 10 },
                { key: 'weekly_target', label: 'Wochenziel', min: 5, max: 100 },
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

      {/* Ship Level Strategy */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="h-4 w-4" /> Ship-Level Strategie
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            {Object.entries(shipLevels).map(([level, target]) => {
              const count = portfolio.filter(p => p.ship_level === level).length;
              return (
                <div key={level} className="text-center p-3 rounded-lg bg-muted/30">
                  <Badge className={cn("text-[9px] mb-2", SHIP_COLORS[level] || 'bg-muted text-muted-foreground')}>
                    {level.toUpperCase()}
                  </Badge>
                  <p className="text-xl font-bold text-foreground">{target}</p>
                  <p className="text-[9px] text-muted-foreground">Fragen-Target</p>
                  <p className="text-xs font-mono text-muted-foreground mt-1">{count} Berufe</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Portfolio Overview */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Portfolio ({portfolio.length} Berufe)</span>
            <div className="flex gap-1">
              {Object.entries(byStatus).map(([s, c]) => (
                <Badge key={s} variant="outline" className="text-[9px]">{s}: {c}</Badge>
              ))}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {portfolio.slice(0, 20).map(p => (
              <div key={p.id} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
                <div className="w-10 text-center">
                  <span className={cn("text-sm font-bold font-mono",
                    p.priority_index >= 70 ? 'text-success' : p.priority_index >= 40 ? 'text-warning' : 'text-muted-foreground'
                  )}>{Math.round(p.priority_index)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground truncate">{p.occupation_slug || p.beruf_id.slice(0, 8)}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Progress value={p.demand_score} className="h-1 max-w-16" />
                    <span className="text-[9px] text-muted-foreground">D:{p.demand_score}</span>
                    <span className="text-[9px] text-muted-foreground">R:{p.revenue_potential_score}</span>
                    <span className="text-[9px] text-muted-foreground">C:{p.competition_score}</span>
                  </div>
                </div>
                <Badge className={cn("text-[9px]", SHIP_COLORS[p.ship_level] || 'bg-muted text-muted-foreground')}>
                  {p.ship_level}
                </Badge>
                <Badge variant="outline" className="text-[9px]">{p.completion_status}</Badge>
                {p.confidence > 0 && (
                  <span className={cn("text-[10px] font-mono",
                    p.confidence >= 85 ? 'text-success' : p.confidence >= 50 ? 'text-warning' : 'text-destructive'
                  )}>C:{Math.round(p.confidence)}</span>
                )}
              </div>
            ))}
          </div>
          {portfolio.length > 20 && (
            <p className="text-xs text-muted-foreground mt-2 text-center">+ {portfolio.length - 20} weitere Berufe</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
