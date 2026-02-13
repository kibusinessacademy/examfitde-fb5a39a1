import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  Clock, Play, RefreshCw, AlertTriangle, CheckCircle2,
  XCircle, Shield, Activity, Settings, Loader2, TrendingDown,
  Pause, BarChart3
} from 'lucide-react';
import { toast } from 'sonner';

interface AuditConfig {
  id: string;
  cycle_days: number;
  sample_pct: number;
  max_drift_delta: number;
  auto_hold_on_drift: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  is_active: boolean;
}

interface AuditResult {
  id: string;
  package_id: string;
  sampled_count: number;
  total_questions: number;
  confidence_before: number;
  confidence_after: number;
  confidence_drift: number;
  governance_before: number;
  governance_after: number;
  duplicate_rate_before: number;
  duplicate_rate_after: number;
  lf_coverage_before: number;
  lf_coverage_after: number;
  difficulty_drift: Record<string, { before: number; after: number }>;
  flags: string[];
  drift_detected: boolean;
  auto_held: boolean;
  findings: Array<{ flag: string; severity: string }>;
  created_at: string;
}

function DriftIndicator({ before, after, label, unit = '', invert = false }: {
  before: number; after: number; label: string; unit?: string; invert?: boolean;
}) {
  const delta = after - before;
  const absDelta = Math.abs(delta);
  const isWorse = invert ? delta > 0 : delta < 0;
  const color = absDelta < 2 ? 'text-success' : isWorse ? 'text-destructive' : 'text-warning';

  return (
    <div className="text-center p-2 rounded-lg bg-muted/30">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      <div className="flex items-center justify-center gap-1">
        <span className="text-xs font-mono text-muted-foreground">{before.toFixed(1)}{unit}</span>
        <span className="text-[10px] text-muted-foreground">→</span>
        <span className={cn("text-xs font-mono font-bold", color)}>{after.toFixed(1)}{unit}</span>
      </div>
      {absDelta > 0.1 && (
        <span className={cn("text-[10px] font-mono", color)}>
          {delta > 0 ? '+' : ''}{delta.toFixed(1)}{unit}
        </span>
      )}
    </div>
  );
}

export default function DeepAuditPanel() {
  const [config, setConfig] = useState<AuditConfig | null>(null);
  const [results, setResults] = useState<AuditResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editValues, setEditValues] = useState({ cycle_days: 3, sample_pct: 2, max_drift_delta: 5, auto_hold_on_drift: true });

  const load = async () => {
    const [cfgRes, resRes] = await Promise.all([
      (supabase as any).from('deep_audit_config').select('*').eq('is_active', true).limit(1).maybeSingle(),
      (supabase as any).from('deep_audit_results').select('*').order('created_at', { ascending: false }).limit(50),
    ]);
    setConfig(cfgRes.data);
    setResults(resRes.data || []);
    if (cfgRes.data) {
      setEditValues({
        cycle_days: cfgRes.data.cycle_days,
        sample_pct: cfgRes.data.sample_pct,
        max_drift_delta: cfgRes.data.max_drift_delta,
        auto_hold_on_drift: cfgRes.data.auto_hold_on_drift,
      });
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const runAudit = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('deep-audit-runner', { body: { force: true } });
      if (error) throw error;
      toast.success(`Deep Audit: ${data.audited} Pakete geprüft, ${data.drift_count} Drift erkannt`);
      load();
    } catch (e: any) {
      toast.error(e.message || 'Fehler beim Audit');
    } finally {
      setRunning(false);
    }
  };

  const saveConfig = async () => {
    if (!config) return;
    const nextRun = new Date();
    nextRun.setDate(nextRun.getDate() + editValues.cycle_days);
    await (supabase as any).from('deep_audit_config').update({
      ...editValues,
      next_run_at: nextRun.toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', config.id);
    toast.success('Audit-Konfiguration gespeichert');
    setEditMode(false);
    load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  const timeUntilNext = config?.next_run_at
    ? Math.max(0, Math.round((new Date(config.next_run_at).getTime() - Date.now()) / (1000 * 60 * 60)))
    : null;

  const driftResults = results.filter(r => r.drift_detected);
  const heldResults = results.filter(r => r.auto_held);

  // Group by audit run (by created_at date)
  const runDates = [...new Set(results.map(r => r.created_at.slice(0, 10)))].slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">Deep Audit</h2>
          <Badge variant="outline" className="text-[9px]">3-Tage-Zyklus</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setEditMode(!editMode)}>
            <Settings className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" onClick={runAudit} disabled={running}>
            {running ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}
            Jetzt ausführen
          </Button>
        </div>
      </div>

      {/* Config Panel */}
      {editMode && (
        <Card className="border-primary/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Settings className="h-4 w-4" /> Audit-Konfiguration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Zyklus (Tage)</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={editValues.cycle_days}
                  onChange={e => setEditValues(v => ({ ...v, cycle_days: parseInt(e.target.value) || 3 }))}
                  className="w-full mt-1 px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Sample %</label>
                <input
                  type="number"
                  min={0.5}
                  max={20}
                  step={0.5}
                  value={editValues.sample_pct}
                  onChange={e => setEditValues(v => ({ ...v, sample_pct: parseFloat(e.target.value) || 2 }))}
                  className="w-full mt-1 px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Max Drift Δ</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  step={0.5}
                  value={editValues.max_drift_delta}
                  onChange={e => setEditValues(v => ({ ...v, max_drift_delta: parseFloat(e.target.value) || 5 }))}
                  className="w-full mt-1 px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Auto-Hold bei Drift</label>
                <button
                  onClick={() => setEditValues(v => ({ ...v, auto_hold_on_drift: !v.auto_hold_on_drift }))}
                  className={cn(
                    "w-full mt-1 px-2 py-1.5 text-sm border rounded-md transition-colors",
                    editValues.auto_hold_on_drift
                      ? "bg-success/10 border-success text-success"
                      : "bg-muted border-border text-muted-foreground"
                  )}
                >
                  {editValues.auto_hold_on_drift ? 'Aktiv' : 'Inaktiv'}
                </button>
              </div>
            </div>
            <div className="flex justify-end mt-3">
              <Button size="sm" onClick={saveConfig}>Speichern</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status Bar */}
      <Card>
        <CardContent className="py-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-center">
            <div>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Zyklus</p>
              <p className="text-lg font-bold text-foreground">{config?.cycle_days || 3} Tage</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Nächster Run</p>
              <p className={cn("text-lg font-bold", timeUntilNext !== null && timeUntilNext < 12 ? 'text-warning' : 'text-foreground')}>
                {timeUntilNext !== null ? `${timeUntilNext}h` : '–'}
              </p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Geprüfte Pakete</p>
              <p className="text-lg font-bold text-foreground">{results.length}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Drift erkannt</p>
              <p className={cn("text-lg font-bold", driftResults.length > 0 ? 'text-destructive' : 'text-success')}>{driftResults.length}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Auto-gehalten</p>
              <p className={cn("text-lg font-bold", heldResults.length > 0 ? 'text-warning' : 'text-success')}>{heldResults.length}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Per-Run Results */}
      {runDates.map(date => {
        const runResults = results.filter(r => r.created_at.slice(0, 10) === date);
        const drifted = runResults.filter(r => r.drift_detected).length;
        return (
          <Card key={date} className={cn(drifted > 0 ? 'border-warning' : '')}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Audit {new Date(date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[9px]">{runResults.length} Pakete</Badge>
                  {drifted > 0 && <Badge variant="destructive" className="text-[9px]">{drifted} Drift</Badge>}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {runResults.map(r => (
                  <div key={r.id} className={cn(
                    "p-3 rounded-lg border",
                    r.drift_detected ? 'border-destructive/30 bg-destructive/5' : r.flags.length > 0 ? 'border-warning/30 bg-warning/5' : 'border-border bg-muted/20'
                  )}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {r.drift_detected ? <TrendingDown className="h-3.5 w-3.5 text-destructive" /> :
                          r.flags.length > 0 ? <AlertTriangle className="h-3.5 w-3.5 text-warning" /> :
                            <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
                        <span className="text-xs font-mono text-muted-foreground">{r.package_id.slice(0, 8)}</span>
                        <span className="text-xs text-foreground">{r.total_questions} Fragen</span>
                        <Badge variant="outline" className="text-[9px]">{r.sampled_count} geprüft</Badge>
                      </div>
                      <div className="flex items-center gap-1">
                        {r.auto_held && <Badge variant="destructive" className="text-[9px]">Auto-Hold</Badge>}
                        {r.flags.map(f => <Badge key={f} variant="outline" className="text-[9px] border-warning/50 text-warning">{f.replace(/_/g, ' ')}</Badge>)}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <DriftIndicator before={r.confidence_before} after={r.confidence_after} label="Confidence" />
                      <DriftIndicator before={r.duplicate_rate_before} after={r.duplicate_rate_after} label="Dup-Rate" unit="%" invert />
                      <DriftIndicator before={r.lf_coverage_before} after={r.lf_coverage_after} label="LF-Coverage" unit="%" />
                      <DriftIndicator
                        before={r.difficulty_drift?.hard?.before ?? 20}
                        after={r.difficulty_drift?.hard?.after ?? 20}
                        label="Hard %"
                        unit="%"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {results.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <Activity className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">Noch keine Audit-Ergebnisse. Starte den ersten Deep Audit.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
