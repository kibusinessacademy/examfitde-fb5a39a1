import { useEffect, useState, useCallback } from 'react';
import { Shield, BarChart3, Brain, Target, AlertTriangle, RefreshCw, TrendingUp, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { Loading, MiniKPI } from './OpsShared';

export default function QualityCouncilDashboard() {
  const [reports, setReports] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [v2Data, setV2Data] = useState<any>(null);
  const [packages, setPackages] = useState<any[]>([]);
  const [selectedPkg, setSelectedPkg] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [v2Loading, setV2Loading] = useState(false);

  const load = useCallback(async () => {
    const [repRes, rulesRes, pkgRes] = await Promise.all([
      (supabase as any).from('package_quality_reports').select('*, course_packages(title)').order('created_at', { ascending: false }).limit(30),
      (supabase as any).from('quality_rules').select('*').order('rule_key'),
      (supabase as any).from('course_packages').select('id, title, curriculum_id').eq('status', 'building').order('created_at', { ascending: false }).limit(50),
    ]);
    setReports(repRes.data || []);
    setRules(rulesRes.data || []);
    setPackages(pkgRes.data || []);
    if (!selectedPkg && pkgRes.data?.length) setSelectedPkg(pkgRes.data[0].id);
    setLoading(false);
  }, []);

  const loadV2 = useCallback(async (pkgId: string) => {
    if (!pkgId) return;
    setV2Loading(true);
    try {
      const { data, error } = await supabase.functions.invoke('quality-report-v2', {
        body: {},
        headers: {},
      });
      // Use query params approach via direct fetch
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/quality-report-v2?package_id=${pkgId}`,
        { headers: { Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } }
      );
      const json = await res.json();
      if (json.ok) setV2Data(json);
      else toast.error(json.error || 'Fehler');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setV2Loading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (selectedPkg) loadV2(selectedPkg); }, [selectedPkg, loadV2]);

  if (loading) return <Loading />;

  const passed = reports.filter(r => r.status === 'pass').length;
  const warned = reports.filter(r => r.status === 'warn').length;
  const failed = reports.filter(r => r.status === 'fail').length;

  return (
    <div className="space-y-6">
      {/* Classic KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniKPI label="Reports" value={reports.length} />
        <MiniKPI label="Pass" value={passed} />
        <MiniKPI label="Warn" value={warned} alert={warned > 0} />
        <MiniKPI label="Fail" value={failed} alert={failed > 0} />
      </div>

      {/* V2 Quality Metrics */}
      <Card className="border-primary/20">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2"><Brain className="h-4 w-4" /> Quality Report v2 – Elite Metrics</CardTitle>
            <div className="flex items-center gap-2">
              <select
                className="text-xs border rounded px-2 py-1 bg-background"
                value={selectedPkg}
                onChange={e => setSelectedPkg(e.target.value)}
              >
                {packages.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.title || p.id.slice(0, 8)}</option>
                ))}
              </select>
              <Button variant="ghost" size="sm" onClick={() => loadV2(selectedPkg)}><RefreshCw className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {v2Loading ? (
            <div className="flex justify-center py-8"><Loading /></div>
          ) : v2Data ? (
            <V2MetricsDisplay data={v2Data} />
          ) : (
            <p className="text-xs text-muted-foreground py-4 text-center">Paket wählen um Metriken zu laden</p>
          )}
        </CardContent>
      </Card>

      {/* Classic Reports Table */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Shield className="h-4 w-4" /> Quality Reports</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-3">Paket</th>
                  <th className="text-left py-2 px-3">Status</th>
                  <th className="text-right py-2 px-3">Score</th>
                  <th className="text-left py-2 px-3">Erstellt</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r: any) => (
                  <tr key={r.package_id} className={cn("border-b border-border/30", r.status === 'fail' && 'bg-destructive/5')}>
                    <td className="py-2 px-3 font-medium truncate max-w-[200px]">{r.course_packages?.title || r.package_id?.slice(0, 8)}</td>
                    <td className="py-2 px-3">
                      <Badge variant="outline" className={cn("text-[10px]",
                        r.status === 'pass' ? 'bg-emerald-500/10 text-emerald-600' :
                        r.status === 'warn' ? 'bg-yellow-500/10 text-yellow-600' :
                        'bg-destructive/10 text-destructive'
                      )}>{r.status}</Badge>
                    </td>
                    <td className="py-2 px-3 text-right font-bold">{r.score}</td>
                    <td className="py-2 px-3 text-muted-foreground">
                      {new Date(r.created_at).toLocaleString('de-DE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Rules */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Quality Rules ({rules.length})</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-3">Rule</th>
                  <th className="text-left py-2 px-3">Severity</th>
                  <th className="text-center py-2 px-3">Aktiv</th>
                  <th className="text-center py-2 px-3">Aktion</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r: any) => (
                  <tr key={r.id} className="border-b border-border/30">
                    <td className="py-2 px-3 font-mono">{r.rule_key}</td>
                    <td className="py-2 px-3">
                      <Button size="sm" variant="ghost" className="h-6 p-1 text-[10px]" onClick={async () => {
                        const newSev = r.severity === 'block' ? 'warn' : 'block';
                        await (supabase as any).from('quality_rules').update({ severity: newSev }).eq('id', r.id);
                        toast.success(`${r.rule_key} → ${newSev}`);
                        load();
                      }}>
                        <Badge variant="outline" className={cn("text-[10px]",
                          r.severity === 'block' ? 'bg-destructive/10 text-destructive' : 'bg-yellow-500/10 text-yellow-600'
                        )}>{r.severity}</Badge>
                      </Button>
                    </td>
                    <td className="py-2 px-3 text-center">
                      <Button size="sm" variant="ghost" className="h-6 w-8 p-0 text-xs" onClick={async () => {
                        await (supabase as any).from('quality_rules').update({ enabled: !r.enabled }).eq('id', r.id);
                        load();
                      }}>
                        {r.enabled ? '✅' : '❌'}
                      </Button>
                    </td>
                    <td className="py-2 px-3 text-center text-muted-foreground text-[10px]">Klick zum Ändern</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── V2 Metrics Display ──

function V2MetricsDisplay({ data }: { data: any }) {
  const m = data.metrics;
  const scoreColor = (s: number) => s >= 80 ? 'text-emerald-600' : s >= 60 ? 'text-yellow-600' : 'text-destructive';
  const scoreBg = (s: number) => s >= 80 ? 'bg-emerald-500/10' : s >= 60 ? 'bg-yellow-500/10' : 'bg-destructive/10';

  return (
    <div className="space-y-4">
      {/* Overall Score */}
      <div className="flex items-center gap-4">
        <div className={cn("text-3xl font-black font-mono", scoreColor(data.overall_score))}>
          {data.overall_score}
        </div>
        <div>
          <p className="text-sm font-semibold">Overall Health Score</p>
          <p className="text-xs text-muted-foreground">{data.approved_questions} approved / {data.total_questions} total questions</p>
        </div>
      </div>

      {/* 7 Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        <MetricCard icon={<Brain className="h-3 w-3" />} label="Bloom" score={m.bloom_score?.score} sub={`Drift: ${m.bloom_score?.avg_drift}`} />
        <MetricCard icon={<Layers className="h-3 w-3" />} label="Transfer" score={m.transfer_score?.score} sub={`${m.transfer_score?.case_based_pct}% case`} />
        <MetricCard icon={<AlertTriangle className="h-3 w-3" />} label="Fehler" score={m.error_density?.score} sub={`Ø ${m.error_density?.avg_errors}`} />
        <MetricCard icon={<Target className="h-3 w-3" />} label="Redundanz" score={100 - (m.redundancy_score?.redundancy_pct || 0)} sub={`${m.redundancy_score?.duplicates || 0} dup`} />
        <MetricCard icon={<BarChart3 className="h-3 w-3" />} label="Difficulty" score={m.difficulty_drift?.score} sub={`Drift: ${m.difficulty_drift?.drift}`} />
        <MetricCard icon={<TrendingUp className="h-3 w-3" />} label="Discrim." score={m.discrimination_index?.score} sub={`Ø ${m.discrimination_index?.avg}`} />
        <MetricCard icon={<Shield className="h-3 w-3" />} label="AP-Balance" score={m.exam_part_balance?.score} sub={m.exam_part_balance?.note || `Drift: ${m.exam_part_balance?.drift}`} />
      </div>

      {/* Per-LF Breakdown */}
      {data.per_lf?.length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-2">Per Lernfeld</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-1.5 px-2">Lernfeld</th>
                  <th className="text-center py-1.5 px-2">AP</th>
                  <th className="text-right py-1.5 px-2">Fragen</th>
                  <th className="text-right py-1.5 px-2">Case %</th>
                  <th className="text-right py-1.5 px-2">Ø Disc.</th>
                  <th className="text-right py-1.5 px-2">Fehler/BP</th>
                  <th className="py-1.5 px-2">Bloom</th>
                </tr>
              </thead>
              <tbody>
                {data.per_lf.map((lf: any) => (
                  <tr key={lf.lf_id} className="border-b border-border/20">
                    <td className="py-1.5 px-2 font-medium truncate max-w-[180px]">{lf.lf_title}</td>
                    <td className="py-1.5 px-2 text-center">
                      <Badge variant="outline" className="text-[9px]">{lf.exam_part || '–'}</Badge>
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono">
                      {lf.question_count}{lf.question_target ? `/${lf.question_target}` : ''}
                    </td>
                    <td className={cn("py-1.5 px-2 text-right font-mono", lf.case_based_pct >= 30 ? 'text-emerald-600' : 'text-yellow-600')}>
                      {lf.case_based_pct}%
                    </td>
                    <td className={cn("py-1.5 px-2 text-right font-mono",
                      lf.avg_discrimination != null && lf.avg_discrimination >= 0.3 ? 'text-emerald-600' : lf.avg_discrimination != null && lf.avg_discrimination < 0.2 ? 'text-destructive' : ''
                    )}>
                      {lf.avg_discrimination ?? '–'}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono">{lf.blueprint_error_density}</td>
                    <td className="py-1.5 px-2">
                      <BloomBar bloom={lf.bloom} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ icon, label, score, sub }: { icon: React.ReactNode; label: string; score: number; sub?: string }) {
  const color = score >= 80 ? 'text-emerald-600' : score >= 60 ? 'text-yellow-600' : 'text-destructive';
  return (
    <div className="rounded-lg border p-2">
      <div className="flex items-center gap-1 text-muted-foreground mb-1">{icon}<span className="text-[9px] uppercase">{label}</span></div>
      <p className={cn("text-lg font-bold font-mono", color)}>{score ?? '–'}</p>
      {sub && <p className="text-[9px] text-muted-foreground truncate">{sub}</p>}
      <Progress value={score ?? 0} className="h-1 mt-1" />
    </div>
  );
}

function BloomBar({ bloom }: { bloom: Record<string, number> }) {
  if (!bloom) return <span className="text-muted-foreground">–</span>;
  const colors: Record<string, string> = {
    remember: 'bg-blue-400', understand: 'bg-cyan-400', apply: 'bg-emerald-400', analyze: 'bg-amber-400', evaluate: 'bg-rose-400',
  };
  return (
    <div className="flex h-2.5 w-full rounded-sm overflow-hidden gap-px">
      {Object.entries(bloom).map(([k, v]) => (
        v > 0 ? <div key={k} className={cn("h-full", colors[k] || 'bg-muted')} style={{ width: `${Math.round(v * 100)}%` }} title={`${k}: ${Math.round(v * 100)}%`} /> : null
      ))}
    </div>
  );
}
