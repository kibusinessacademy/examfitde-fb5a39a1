import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Shield, AlertTriangle, CheckCircle2, XCircle,
  Activity, Zap, BarChart3, Copy, Play, RefreshCw, TrendingUp,
  FileText, ShieldAlert, Clock, Ban
} from 'lucide-react';
import { toast } from 'sonner';

/* ── Types ── */
interface Snapshot {
  id: string;
  package_id: string;
  total_questions: number;
  duplicate_rate: number;
  lf_coverage_pct: number;
  difficulty_easy_pct: number;
  difficulty_medium_pct: number;
  difficulty_hard_pct: number;
  low_confidence_count: number;
  confidence_score: number;
  governance_score: number;
  lf_detail: Record<string, { count: number; pct: number; target_pct: number; deviation: number }>;
  flags: string[];
  auto_paused: boolean;
  pause_reason: string | null;
  snapshot_at: string;
}

interface ProviderPerf {
  provider: string;
  total_calls: number;
  success_count: number;
  error_count: number;
  avg_latency_ms: number;
  avg_tokens_out: number;
  total_cost_eur: number;
  near_duplicate_rate: number;
  low_confidence_rate: number;
  blocked_question_count: number;
  stability_index: number;
  hallucination_flag_rate: number;
  risk_score: number;
  auto_disabled: boolean;
}

interface AuditEntry {
  id: string;
  package_id: string;
  event_type: string;
  triggered_by: string;
  trigger_reason: string | null;
  question_count: number;
  confidence_score: number;
  governance_score: number;
  duplicate_rate: number;
  lf_coverage_pct: number;
  hard_ratio: number;
  created_at: string;
}

/* ── Dual Score Gauge ── */
function DualScoreGauge({ confidence, governance }: { confidence: number; governance: number }) {
  const confColor = confidence >= 85 ? 'text-success' : confidence >= 50 ? 'text-warning' : 'text-destructive';
  const govColor = governance >= 80 ? 'text-success' : governance >= 50 ? 'text-warning' : 'text-destructive';

  return (
    <div className="grid grid-cols-2 gap-3">
      <Card className={cn("border-l-4", confidence >= 85 ? 'border-l-success' : confidence >= 50 ? 'border-l-warning' : 'border-l-destructive')}>
        <CardContent className="py-4 text-center">
          <TrendingUp className={cn("h-5 w-5 mx-auto mb-1", confColor)} />
          <p className={cn("text-3xl font-bold", confColor)}>{confidence}</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Confidence</p>
          <p className="text-[9px] text-muted-foreground mt-1">35% Cov · 25% Dup · 20% Diff · 10% Prov · 10% Conf</p>
        </CardContent>
      </Card>
      <Card className={cn("border-l-4", governance >= 80 ? 'border-l-success' : governance >= 50 ? 'border-l-warning' : 'border-l-destructive')}>
        <CardContent className="py-4 text-center">
          <ShieldAlert className={cn("h-5 w-5 mx-auto mb-1", govColor)} />
          <p className={cn("text-3xl font-bold", govColor)}>{governance}</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Governance</p>
          <p className="text-[9px] text-muted-foreground mt-1">Force Resumes · Audit-Alter · Provider Drift</p>
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Status Badge ── */
function StatusBadge({ flags, paused }: { flags: string[]; paused: boolean }) {
  if (paused) return <Badge variant="destructive" className="text-xs">⏸ PAUSED</Badge>;
  if (flags.length > 0) return <Badge variant="outline" className="text-xs border-warning text-warning">⚠ {flags.length} Flags</Badge>;
  return <Badge variant="outline" className="text-xs border-success text-success">✔ Clean</Badge>;
}

/* ── LF Heatmap ── */
function LFHeatmap({ detail }: { detail: Record<string, { count: number; pct: number; target_pct: number; deviation: number }> }) {
  if (!detail || Object.keys(detail).length === 0) return <p className="text-xs text-muted-foreground">Keine LF-Daten</p>;
  const entries = Object.entries(detail).sort((a, b) => b[1].deviation - a[1].deviation);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_60px_60px_60px_40px] gap-1 text-[9px] uppercase tracking-wider text-muted-foreground pb-1 border-b border-border">
        <span>Lernfeld</span><span className="text-right">Ist %</span><span className="text-right">Soll %</span><span className="text-right">Δ</span><span className="text-right">n</span>
      </div>
      {entries.map(([lf, data]) => {
        const devColor = data.deviation > 10 ? 'text-destructive' : data.deviation > 5 ? 'text-warning' : 'text-success';
        const barWidth = Math.min((data.pct / Math.max(data.target_pct, 1)) * 100, 150);
        return (
          <div key={lf} className="grid grid-cols-[1fr_60px_60px_60px_40px] gap-1 items-center">
            <div className="min-w-0">
              <span className="text-[10px] font-medium text-foreground truncate block" title={lf}>{lf.length > 20 ? lf.slice(0, 20) + '…' : lf}</span>
              <Progress value={Math.min(barWidth, 100)} className="h-1 mt-0.5" />
            </div>
            <span className="text-[10px] font-mono text-right text-foreground">{data.pct}%</span>
            <span className="text-[10px] font-mono text-right text-muted-foreground">{data.target_pct}%</span>
            <span className={cn("text-[10px] font-mono text-right font-bold", devColor)}>{data.deviation > 0 ? '±' : ''}{data.deviation}%</span>
            <span className="text-[10px] font-mono text-right text-muted-foreground">{data.count}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Provider Card v3 ── */
function ProviderCard({ p }: { p: ProviderPerf }) {
  const errRate = p.total_calls > 0 ? Math.round(100 * p.error_count / p.total_calls) : 0;
  const riskColor = (p.risk_score ?? 0) > 50 ? 'border-l-destructive' : (p.risk_score ?? 0) > 25 ? 'border-l-warning' : 'border-l-success';

  return (
    <Card className={cn("border-l-4", riskColor, p.auto_disabled && 'opacity-60')}>
      <CardContent className="py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-foreground capitalize">{p.provider}</span>
          <div className="flex items-center gap-1">
            {p.auto_disabled && <Ban className="h-3 w-3 text-destructive" />}
            <Badge variant="outline" className="text-[10px]">{p.total_calls} calls</Badge>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-[10px]">
          <div>
            <span className="text-muted-foreground">Erfolg</span>
            <span className={cn("ml-1 font-mono", errRate > 10 ? 'text-destructive' : 'text-success')}>{100 - errRate}%</span>
          </div>
          <div>
            <span className="text-muted-foreground">Latenz</span>
            <span className="ml-1 font-mono text-foreground">{Math.round(p.avg_latency_ms)}ms</span>
          </div>
          <div>
            <span className="text-muted-foreground">Kosten</span>
            <span className="ml-1 font-mono text-foreground">€{p.total_cost_eur.toFixed(2)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Dup-Rate</span>
            <span className={cn("ml-1 font-mono", (p.near_duplicate_rate || 0) > 3 ? 'text-warning' : 'text-success')}>{(p.near_duplicate_rate || 0).toFixed(1)}%</span>
          </div>
          <div>
            <span className="text-muted-foreground">Halluz.</span>
            <span className={cn("ml-1 font-mono", (p.hallucination_flag_rate || 0) > 5 ? 'text-destructive' : 'text-foreground')}>{(p.hallucination_flag_rate || 0).toFixed(1)}%</span>
          </div>
          <div>
            <span className="text-muted-foreground">Risk</span>
            <span className={cn("ml-1 font-mono font-bold",
              (p.risk_score ?? 0) > 50 ? 'text-destructive' : (p.risk_score ?? 0) > 25 ? 'text-warning' : 'text-success'
            )}>{p.risk_score ?? 0}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Stabilität</span>
            <span className={cn("ml-1 font-mono", (p.stability_index ?? 100) < 70 ? 'text-warning' : 'text-foreground')}>{(p.stability_index ?? 100).toFixed(0)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Blocked</span>
            <span className="ml-1 font-mono text-foreground">{p.blocked_question_count || 0}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Low-Conf</span>
            <span className={cn("ml-1 font-mono", (p.low_confidence_rate || 0) > 10 ? 'text-warning' : 'text-foreground')}>{(p.low_confidence_rate || 0).toFixed(1)}%</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Recovery Panel ── */
function RecoveryPanel({ packageId, onResume }: { packageId: string; onResume: () => void }) {
  const [loading, setLoading] = useState(false);
  const handleResume = async (action: 'admin_resume' | 'auto_recheck') => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any).rpc('quality_hold_resume', { p_package_id: packageId, p_action: action });
      if (error) throw error;
      if (data?.resumed) { toast.success('Pipeline wird fortgesetzt'); onResume(); }
      else toast.warning(`Noch nicht bereit: ${data?.reason || 'Qualität ungenügend'}`);
    } catch (e: any) { toast.error(e.message || 'Fehler'); }
    finally { setLoading(false); }
  };
  return (
    <Card className="border-warning bg-warning/5">
      <CardContent className="py-3">
        <p className="text-sm font-medium text-foreground mb-2">Recovery-Optionen</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={loading} onClick={() => handleResume('auto_recheck')}>
            <RefreshCw className="h-3 w-3 mr-1" />Recheck & Resume
          </Button>
          <Button size="sm" disabled={loading} onClick={() => handleResume('admin_resume')}>
            <Play className="h-3 w-3 mr-1" />Admin Force Resume
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">⚠ Force Resume wird im Audit-Log protokolliert und reduziert den Governance Score.</p>
      </CardContent>
    </Card>
  );
}

/* ── Audit Trail ── */
function AuditTrail({ entries }: { entries: AuditEntry[] }) {
  if (!entries.length) return null;
  const eventIcons: Record<string, React.ReactNode> = {
    quality_hold: <XCircle className="h-3 w-3 text-destructive" />,
    force_resume: <Play className="h-3 w-3 text-warning" />,
    confidence_pass: <CheckCircle2 className="h-3 w-3 text-success" />,
    periodic_audit: <Clock className="h-3 w-3 text-muted-foreground" />,
    publish: <FileText className="h-3 w-3 text-primary" />,
  };
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileText className="h-4 w-4" /> Audit Trail (revisionssicher)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {entries.map(e => (
            <div key={e.id} className="flex items-center gap-2 text-xs py-1.5 border-b border-border/50 last:border-0">
              {eventIcons[e.event_type] || <Activity className="h-3 w-3 text-muted-foreground" />}
              <span className="text-muted-foreground font-mono w-28 shrink-0">
                {new Date(e.created_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </span>
              <Badge variant="outline" className="text-[9px] shrink-0">{e.event_type.replace(/_/g, ' ')}</Badge>
              <span className="text-foreground truncate flex-1" title={e.trigger_reason || ''}>{e.trigger_reason || '–'}</span>
              <span className="font-mono text-foreground shrink-0">C:{e.confidence_score}</span>
              <span className="font-mono text-foreground shrink-0">G:{e.governance_score}</span>
              <span className="text-muted-foreground shrink-0">{e.triggered_by === 'system' ? '🤖' : '👤'}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Publish Readiness Gate ── */
function PublishReadiness({ confidence, governance }: { confidence: number; governance: number }) {
  const confOk = confidence >= 85;
  const govOk = governance >= 80;
  const ready = confOk && govOk;

  return (
    <Card className={cn("border-l-4", ready ? 'border-l-success' : 'border-l-warning')}>
      <CardContent className="py-3">
        <p className="text-sm font-medium text-foreground mb-2">Dual-Approval Publish Gate</p>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="flex items-center gap-2">
            {confOk ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-destructive" />}
            <span>Confidence ≥ 85 <span className="font-mono">({confidence})</span></span>
          </div>
          <div className="flex items-center gap-2">
            {govOk ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-destructive" />}
            <span>Governance ≥ 80 <span className="font-mono">({governance})</span></span>
          </div>
        </div>
        <p className={cn("text-[10px] mt-2 font-medium", ready ? 'text-success' : 'text-warning')}>
          {ready ? '✔ Publish-Freigabe möglich' : '⚠ Mindestens ein Gate nicht erfüllt – Publish blockiert'}
        </p>
      </CardContent>
    </Card>
  );
}

/* ── Main Dashboard ── */
export default function QualityShieldDashboard() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [providers, setProviders] = useState<ProviderPerf[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    const [snapRes, provRes, auditRes] = await Promise.all([
      (supabase as any).from('production_quality_snapshots').select('*').order('snapshot_at', { ascending: false }).limit(20),
      (supabase as any).from('provider_performance').select('*').order('date', { ascending: false }).limit(10),
      (supabase as any).from('quality_audit_snapshots').select('*').order('created_at', { ascending: false }).limit(20),
    ]);
    setSnapshots(snapRes.data || []);
    setProviders(provRes.data || []);
    setAuditEntries(auditRes.data || []);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Activity className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  const latest = snapshots[0];
  const hasPaused = snapshots.some(s => s.auto_paused);
  const pausedPkg = snapshots.find(s => s.auto_paused);
  const allFlags = [...new Set(snapshots.flatMap(s => s.flags))];
  const riskyProviders = providers.filter(p => (p.risk_score ?? 0) > 40);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">Quality Shield v3</h2>
          <Badge variant="outline" className="text-[9px]">ISO/AZAV-ready</Badge>
        </div>
        {latest ? <StatusBadge flags={latest.flags} paused={latest.auto_paused} /> : <Badge variant="outline" className="text-xs text-muted-foreground">Keine Daten</Badge>}
      </div>

      {/* Alert + Recovery */}
      {hasPaused && pausedPkg && (
        <div className="space-y-3">
          <Card className="border-destructive bg-destructive/5">
            <CardContent className="py-3 flex items-center gap-3">
              <XCircle className="h-5 w-5 text-destructive shrink-0" />
              <div>
                <p className="text-sm font-medium text-destructive">Pipeline automatisch pausiert</p>
                <p className="text-xs text-muted-foreground">{pausedPkg.pause_reason || 'Qualitäts-Schwelle überschritten'}</p>
              </div>
            </CardContent>
          </Card>
          <RecoveryPanel packageId={pausedPkg.package_id} onResume={loadData} />
        </div>
      )}

      {/* Risky Providers Alert */}
      {riskyProviders.length > 0 && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="py-3 flex items-center gap-3">
            <Ban className="h-5 w-5 text-destructive shrink-0" />
            <div>
              <p className="text-sm font-medium text-destructive">{riskyProviders.length} Provider mit erhöhtem Risiko</p>
              <p className="text-xs text-muted-foreground">{riskyProviders.map(p => p.provider).join(', ')} – Risk Score &gt; 40</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dual Scores + Publish Gate */}
      {latest && (
        <>
          <DualScoreGauge confidence={latest.confidence_score ?? 100} governance={latest.governance_score ?? 100} />
          <PublishReadiness confidence={latest.confidence_score ?? 100} governance={latest.governance_score ?? 100} />
        </>
      )}

      {/* KPIs */}
      {latest && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card>
            <CardContent className="py-3 text-center">
              <BarChart3 className="h-4 w-4 mx-auto text-primary mb-1" />
              <p className="text-xl font-bold text-foreground">{latest.total_questions}</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Fragen</p>
            </CardContent>
          </Card>
          <Card className={cn(latest.duplicate_rate > 3 ? 'border-warning' : '', latest.duplicate_rate > 4.5 ? 'border-destructive' : '')}>
            <CardContent className="py-3 text-center">
              <Copy className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
              <p className={cn("text-xl font-bold", latest.duplicate_rate > 4.5 ? 'text-destructive' : latest.duplicate_rate > 3 ? 'text-warning' : 'text-success')}>{latest.duplicate_rate}%</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Duplikate</p>
            </CardContent>
          </Card>
          <Card className={cn(latest.lf_coverage_pct < 80 ? 'border-warning' : '')}>
            <CardContent className="py-3 text-center">
              <Zap className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
              <p className={cn("text-xl font-bold", latest.lf_coverage_pct < 70 ? 'text-destructive' : latest.lf_coverage_pct < 80 ? 'text-warning' : 'text-success')}>{latest.lf_coverage_pct}%</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">LF-Coverage</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 text-center">
              <AlertTriangle className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
              <p className={cn("text-xl font-bold", latest.low_confidence_count > 10 ? 'text-warning' : 'text-foreground')}>{latest.low_confidence_count}</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Low Conf.</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Difficulty Distribution */}
      {latest && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Schwierigkeitsverteilung</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-2 h-6 rounded-lg overflow-hidden">
              <div className="bg-success/70 flex items-center justify-center" style={{ width: `${latest.difficulty_easy_pct}%` }}>
                <span className="text-[9px] font-mono text-white">{latest.difficulty_easy_pct}%</span>
              </div>
              <div className="bg-warning/70 flex items-center justify-center" style={{ width: `${latest.difficulty_medium_pct}%` }}>
                <span className="text-[9px] font-mono text-white">{latest.difficulty_medium_pct}%</span>
              </div>
              <div className="bg-destructive/70 flex items-center justify-center" style={{ width: `${latest.difficulty_hard_pct}%` }}>
                <span className="text-[9px] font-mono text-white">{latest.difficulty_hard_pct}%</span>
              </div>
            </div>
            <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
              <span>Leicht (40%)</span><span>Mittel (40%)</span><span>Schwer (20%)</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* LF Heatmap */}
      {latest?.lf_detail && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Lernfeld-Abdeckung (Soll vs. Ist)</CardTitle>
          </CardHeader>
          <CardContent><LFHeatmap detail={latest.lf_detail} /></CardContent>
        </Card>
      )}

      {/* Provider Performance v3 */}
      {providers.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Activity className="h-4 w-4" /> Provider Performance + Risk Rating
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {providers.slice(0, 6).map(p => <ProviderCard key={`${p.provider}-${(p as any).date}`} p={p} />)}
          </div>
        </div>
      )}

      {/* Active Flags */}
      {allFlags.length > 0 && (
        <Card className="border-warning/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-warning" /> Aktive Flags</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {allFlags.map(f => <Badge key={f} variant="outline" className="text-xs border-warning/50 text-warning">{f.replace(/_/g, ' ')}</Badge>)}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Audit Trail */}
      <AuditTrail entries={auditEntries} />

      {/* Snapshot History */}
      {snapshots.length > 1 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Snapshot-Verlauf</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1">
              {snapshots.slice(0, 10).map(s => (
                <div key={s.id} className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0">
                  <span className="text-muted-foreground font-mono">
                    {new Date(s.snapshot_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="font-mono text-foreground">{s.total_questions} Q</span>
                  <span className={cn("font-mono", s.duplicate_rate > 4.5 ? 'text-destructive' : s.duplicate_rate > 3 ? 'text-warning' : 'text-success')}>{s.duplicate_rate}% dup</span>
                  <span className={cn("font-mono", s.lf_coverage_pct < 80 ? 'text-warning' : 'text-success')}>{s.lf_coverage_pct}% LF</span>
                  <span className={cn("font-mono font-bold", (s.confidence_score ?? 100) >= 85 ? 'text-success' : (s.confidence_score ?? 100) >= 50 ? 'text-warning' : 'text-destructive')}>C:{s.confidence_score ?? '–'}</span>
                  <span className={cn("font-mono", (s.governance_score ?? 100) >= 80 ? 'text-success' : 'text-warning')}>G:{s.governance_score ?? '–'}</span>
                  {s.auto_paused ? <XCircle className="h-3 w-3 text-destructive" /> : s.flags.length > 0 ? <AlertTriangle className="h-3 w-3 text-warning" /> : <CheckCircle2 className="h-3 w-3 text-success" />}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
