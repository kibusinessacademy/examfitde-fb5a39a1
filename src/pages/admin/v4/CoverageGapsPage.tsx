import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Zap, Target, TrendingUp, AlertTriangle, Sprout } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface CurriculumOption {
  id: string;
  title: string;
  status: string;
}

interface Gap {
  competency_id: string;
  competency_title: string;
  learning_field_title: string;
  gap_total: number;
  gap_recall: number;
  gap_application: number;
  gap_scenario: number;
  gap_transfer: number;
  gap_error_patterns: number;
  priority: number;
}

interface DashboardRow {
  curriculum_id: string;
  curriculum_title: string;
  approved_questions: number;
  blueprint_approval_rate_pct: number;
  avg_total_score: number;
  packages_qg_failed: number;
  enrichment_v2_pct: number;
}

type SeedMode = 'default' | 'light' | 'heavy';

export default function CoverageGapsPage() {
  const [curricula, setCurricula] = useState<CurriculumOption[]>([]);
  const [selectedCurriculum, setSelectedCurriculum] = useState<string>('');
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [dashboard, setDashboard] = useState<DashboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [gapsLoading, setGapsLoading] = useState(false);
  const [filling, setFilling] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seedMode, setSeedMode] = useState<SeedMode>('default');

  useEffect(() => {
    (async () => {
      const [currRes, dashRes] = await Promise.all([
        (supabase as any).from('curricula').select('id, title, status').order('title'),
        (supabase as any).from('ops_curriculum_quality_dashboard_mv')
          .select('curriculum_id, curriculum_title, approved_questions, blueprint_approval_rate_pct, avg_total_score, packages_qg_failed, enrichment_v2_pct')
          .order('packages_qg_failed', { ascending: false }),
      ]);
      setCurricula(currRes.data || []);
      setDashboard(dashRes.data || []);
      setLoading(false);
    })();
  }, []);

  const loadGaps = useCallback(async (currId: string) => {
    setGapsLoading(true);
    const { data } = await supabase.functions.invoke('admin-ops', {
      body: { action: 'get_coverage_gaps', curriculum_id: currId },
    });
    setGaps((data as any)?.gaps || []);
    setGapsLoading(false);
  }, []);

  const handleSelectCurriculum = (id: string) => {
    setSelectedCurriculum(id);
    loadGaps(id);
  };

  const handleSeedTargets = async () => {
    if (!selectedCurriculum) return;
    setSeeding(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-ops', {
        body: { action: 'seed_blueprint_targets', curriculum_id: selectedCurriculum, mode: seedMode },
      });
      if (error) throw error;
      const result = (data as any)?.result;
      toast.success(`${result?.upserts ?? 0} Targets gesetzt (${result?.track}/${result?.mode})`);
      loadGaps(selectedCurriculum);
    } catch (e: any) {
      toast.error(e.message || 'Fehler beim Seeden');
    } finally {
      setSeeding(false);
    }
  };

  const handleFillGaps = async () => {
    if (!selectedCurriculum) return;
    setFilling(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-ops', {
        body: { action: 'enqueue_blueprint_gap_fill', curriculum_id: selectedCurriculum, cap: 50 },
      });
      if (error) throw error;
      const result = (data as any)?.result;
      toast.success(`${result?.enqueued ?? 0} Gap-Fill Jobs enqueued`);
      loadGaps(selectedCurriculum);
    } catch (e: any) {
      toast.error(e.message || 'Fehler beim Enqueue');
    } finally {
      setFilling(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );

  const totalGap = gaps.reduce((s, g) => s + Math.max(g.gap_total, 0), 0);

  return (
    <div className="space-y-6">
      {/* Dashboard Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Curricula', value: dashboard.length, icon: Target },
          { label: 'Ø Score', value: dashboard.length ? Math.round(dashboard.reduce((s, d) => s + (d.avg_total_score || 0), 0) / dashboard.length) : 0, icon: TrendingUp },
          { label: 'QG Failed', value: dashboard.reduce((s, d) => s + (d.packages_qg_failed || 0), 0), icon: AlertTriangle, danger: true },
          { label: 'Approved Qs', value: dashboard.reduce((s, d) => s + (d.approved_questions || 0), 0), icon: Zap },
        ].map(kpi => (
          <Card key={kpi.label}>
            <CardContent className="py-3 text-center">
              <kpi.icon className={cn("h-4 w-4 mx-auto mb-1", kpi.danger && (kpi.value as number) > 0 ? 'text-destructive' : 'text-muted-foreground')} />
              <p className={cn("text-xl font-bold", kpi.danger && (kpi.value as number) > 0 ? 'text-destructive' : 'text-foreground')}>{kpi.value}</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{kpi.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Curriculum Selector + Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Coverage Gap Analyse</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={selectedCurriculum} onValueChange={handleSelectCurriculum}>
              <SelectTrigger className="flex-1 min-w-48">
                <SelectValue placeholder="Curriculum wählen…" />
              </SelectTrigger>
              <SelectContent>
                {curricula.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.title} <span className="text-muted-foreground ml-1">({c.status})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Seed Targets */}
            <div className="flex items-center gap-1.5">
              <Select value={seedMode} onValueChange={(v) => setSeedMode(v as SeedMode)}>
                <SelectTrigger className="w-24 h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="default">Default</SelectItem>
                  <SelectItem value="heavy">Heavy</SelectItem>
                </SelectContent>
              </Select>
              <Button
                onClick={handleSeedTargets}
                disabled={!selectedCurriculum || seeding}
                size="sm"
                variant="outline"
                className="shrink-0"
              >
                {seeding ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sprout className="h-3 w-3 mr-1" />}
                Targets setzen
              </Button>
            </div>

            {/* Fill Gaps */}
            <Button
              onClick={handleFillGaps}
              disabled={!selectedCurriculum || filling || totalGap === 0}
              size="sm"
              className="shrink-0"
            >
              {filling ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Zap className="h-3 w-3 mr-1" />}
              Gaps füllen ({totalGap})
            </Button>
          </div>

          {/* Gaps Table */}
          {gapsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : gaps.length > 0 ? (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Kompetenz</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Lernfeld</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground text-center">Gap</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground text-center">Recall</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground text-center">Anwendung</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground text-center">Szenario</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground text-center">Transfer</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground text-center">Fehler</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {gaps.map(g => (
                    <tr key={g.competency_id} className="hover:bg-muted/20">
                      <td className="px-3 py-2 max-w-48 truncate text-foreground">{g.competency_title}</td>
                      <td className="px-3 py-2 text-muted-foreground">{g.learning_field_title}</td>
                      <td className="px-2 py-2 text-center">
                        <Badge variant={g.gap_total > 5 ? 'destructive' : 'secondary'} className="text-[10px]">
                          {g.gap_total}
                        </Badge>
                      </td>
                      {[g.gap_recall, g.gap_application, g.gap_scenario, g.gap_transfer, g.gap_error_patterns].map((v, i) => (
                        <td key={i} className={cn("px-2 py-2 text-center font-mono",
                          v > 0 ? 'text-destructive' : 'text-muted-foreground'
                        )}>
                          {v > 0 ? `+${v}` : '✓'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : selectedCurriculum ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Keine Coverage-Gaps gefunden — alle Targets erfüllt ✓
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Quality Dashboard Table */}
      {dashboard.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Curriculum Quality Dashboard</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Curriculum</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground text-center">Approved Qs</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground text-center">BP Rate</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground text-center">Ø Score</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground text-center">QG Failed</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground text-center">Enrichment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {dashboard.slice(0, 20).map(d => (
                    <tr
                      key={d.curriculum_id}
                      className={cn("hover:bg-muted/20 cursor-pointer", selectedCurriculum === d.curriculum_id && 'bg-primary/5')}
                      onClick={() => handleSelectCurriculum(d.curriculum_id)}
                    >
                      <td className="px-3 py-2 max-w-56 truncate text-foreground">{d.curriculum_title}</td>
                      <td className="px-2 py-2 text-center font-mono text-foreground">{d.approved_questions ?? '–'}</td>
                      <td className="px-2 py-2 text-center">
                        <Progress value={d.blueprint_approval_rate_pct ?? 0} className="h-1.5 w-16 mx-auto" />
                      </td>
                      <td className={cn("px-2 py-2 text-center font-mono",
                        (d.avg_total_score ?? 0) >= 80 ? 'text-success' : (d.avg_total_score ?? 0) >= 60 ? 'text-warning' : 'text-destructive'
                      )}>
                        {d.avg_total_score ? Math.round(d.avg_total_score) : '–'}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <Badge variant={(d.packages_qg_failed ?? 0) > 0 ? 'destructive' : 'secondary'} className="text-[10px]">
                          {d.packages_qg_failed ?? 0}
                        </Badge>
                      </td>
                      <td className="px-2 py-2 text-center font-mono text-muted-foreground">
                        {d.enrichment_v2_pct != null ? `${d.enrichment_v2_pct}%` : '–'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
