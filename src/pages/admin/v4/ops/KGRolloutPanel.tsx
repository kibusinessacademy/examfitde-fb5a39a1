import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Shield, CheckCircle2, XCircle, Clock, AlertTriangle, Rocket } from 'lucide-react';
import { cn } from '@/lib/utils';

type DriftTone = 'green' | 'yellow' | 'red';

interface CurriculumReadiness {
  curriculum_id: string;
  curriculum_title: string;
  competencies_total: number;
  competencies_with_enough_errors: number;
  pct_ready: number;
  total_error_patterns: number;
  flag_status: boolean;
  is_ready: boolean;
  drift: DriftTone;
  driftHint: string;
}

function computeDrift(c: Omit<CurriculumReadiness, 'drift' | 'driftHint'>): { drift: DriftTone; driftHint: string } {
  // RED: flag=true but not actually ready → dangerous drift
  if (c.flag_status && !c.is_ready) {
    return { drift: 'red', driftHint: 'Flag aktiv, aber Readiness nicht erreicht — Drift!' };
  }
  // RED: ready but flag missing → missed activation
  if (c.is_ready && !c.flag_status) {
    return { drift: 'red', driftHint: 'Ready, aber Flag fehlt — Orchestrator-Problem?' };
  }
  // YELLOW: close to threshold (40-59%) and no flag
  if (!c.is_ready && c.pct_ready >= 40) {
    return { drift: 'yellow', driftHint: `Coverage ${c.pct_ready}% — knapp unter Schwelle` };
  }
  // GREEN: consistent state
  if (c.flag_status && c.is_ready) {
    return { drift: 'green', driftHint: 'Aktiv und ready — konsistent' };
  }
  return { drift: 'green', driftHint: '' };
}

const driftClasses: Record<DriftTone, string> = {
  green: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500',
  yellow: 'border-amber-500/30 bg-amber-500/10 text-amber-500',
  red: 'border-destructive/30 bg-destructive/10 text-destructive',
};

export default function KGRolloutPanel() {
  // Load all curricula readiness + flags
  const { data, isLoading } = useQuery({
    queryKey: ['kg-rollout-readiness'],
    queryFn: async () => {
      // 1. Get all curricula with competency counts + error coverage
      const { data: curricula } = await supabase
        .from('curricula')
        .select('id, title')
        .order('title');

      if (!curricula?.length) return { curricula: [], flags: {}, globalEnabled: false, rolloutPct: 10 };

      // 2. Get rollout flags from ops_pipeline_config
      const { data: configs } = await (supabase as any)
        .from('ops_pipeline_config')
        .select('key, value')
        .or('key.like.kg_rollout_curriculum_%,key.eq.kg_exam_pool_enabled,key.eq.kg_exam_pool_rollout_pct');

      const flags: Record<string, boolean> = {};
      let globalEnabled = false;
      let rolloutPct = 10;
      for (const c of configs || []) {
        if (c.key === 'kg_exam_pool_enabled') {
          globalEnabled = c.value === true || c.value === 'true' || c.value === '"true"';
        } else if (c.key === 'kg_exam_pool_rollout_pct') {
          rolloutPct = typeof c.value === 'number' ? c.value : parseInt(String(c.value).replace(/"/g, ''), 10) || 10;
        } else if (c.key.startsWith('kg_rollout_curriculum_')) {
          const cId = c.key.replace('kg_rollout_curriculum_', '');
          flags[cId] = c.value === true || c.value === 'true' || c.value === '"true"';
        }
      }

      // 3. For each curriculum, compute readiness
      const results: CurriculumReadiness[] = [];
      for (const curr of curricula) {
        const { data: lfs } = await supabase
          .from('learning_fields')
          .select('id')
          .eq('curriculum_id', curr.id);
        if (!lfs?.length) continue;

        const lfIds = lfs.map((l: any) => l.id);
        const { data: comps } = await supabase
          .from('competencies')
          .select('id')
          .in('learning_field_id', lfIds);
        if (!comps?.length) continue;

        const compIds = comps.map((c: any) => c.id);

        // Get competency nodes
        const { data: compNodes } = await supabase
          .from('knowledge_graph_nodes')
          .select('id, source_id')
          .eq('node_type', 'competency')
          .eq('is_active', true)
          .in('source_id', compIds);

        const nodeIds = (compNodes || []).map((n: any) => n.id);

        // Count error edges per competency node
        let withEnough = 0;
        let totalErrors = 0;
        if (nodeIds.length > 0) {
          const { data: errEdges } = await supabase
            .from('knowledge_graph_edges')
            .select('to_node_id')
            .eq('edge_type', 'causes_error')
            .eq('is_active', true)
            .in('to_node_id', nodeIds);

          const errMap = new Map<string, number>();
          for (const e of errEdges || []) {
            errMap.set(e.to_node_id, (errMap.get(e.to_node_id) || 0) + 1);
          }
          totalErrors = Array.from(errMap.values()).reduce((a, b) => a + b, 0);
          withEnough = Array.from(errMap.values()).filter(c => c >= 2).length;
        }

        const pctReady = compIds.length > 0 ? Math.round((withEnough / compIds.length) * 1000) / 10 : 0;
        const isReady = compIds.length >= 20 && pctReady >= 60;

        const base = {
          curriculum_id: curr.id,
          curriculum_title: curr.title,
          competencies_total: compIds.length,
          competencies_with_enough_errors: withEnough,
          pct_ready: pctReady,
          total_error_patterns: totalErrors,
          flag_status: flags[curr.id] || false,
          is_ready: isReady,
        };
        const { drift, driftHint } = computeDrift(base);
        results.push({ ...base, drift, driftHint });
      }

      results.sort((a, b) => b.pct_ready - a.pct_ready);

      return { curricula: results, flags, globalEnabled, rolloutPct };
    },
    refetchInterval: 60_000,
  });

  // Recent orchestrator runs from auto_heal_log
  const { data: recentRuns } = useQuery({
    queryKey: ['kg-rollout-recent-runs'],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('auto_heal_log')
        .select('id, action_type, target_id, target_type, result_status, result_detail, error_message, created_at, metadata')
        .eq('action_type', 'kg_rollout_orchestrator')
        .order('created_at', { ascending: false })
        .limit(10);
      return data || [];
    },
    refetchInterval: 30_000,
  });

  const readyCurricula = data?.curricula?.filter(c => c.is_ready) || [];
  const pendingCurricula = data?.curricula?.filter(c => !c.is_ready && c.pct_ready > 0) || [];
  const driftCurricula = data?.curricula?.filter(c => c.drift === 'red') || [];

  return (
    <div className="space-y-6">
      {/* Global Status */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className={cn(!data?.globalEnabled && 'border-destructive/50')}>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              <span className="text-sm text-muted-foreground">Global Switch</span>
            </div>
            {isLoading ? <Skeleton className="h-8 w-20 mt-1" /> : (
              <p className={cn('text-xl font-bold mt-1', data?.globalEnabled ? 'text-emerald-600' : 'text-destructive')}>
                {data?.globalEnabled ? 'AKTIV' : 'AUS'}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Rocket className="h-4 w-4 text-primary" />
              <span className="text-sm text-muted-foreground">Rollout %</span>
            </div>
            {isLoading ? <Skeleton className="h-8 w-20 mt-1" /> : (
              <p className="text-xl font-bold text-foreground mt-1">{data?.rolloutPct}%</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="text-sm text-muted-foreground">KG-Ready</span>
            </div>
            {isLoading ? <Skeleton className="h-8 w-20 mt-1" /> : (
              <p className="text-xl font-bold text-foreground mt-1">{readyCurricula.length}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-yellow-500" />
              <span className="text-sm text-muted-foreground">Pending</span>
            </div>
            {isLoading ? <Skeleton className="h-8 w-20 mt-1" /> : (
              <p className="text-xl font-bold text-foreground mt-1">{pendingCurricula.length}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Drift Alert Banner */}
      {driftCurricula.length > 0 && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="py-3 px-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-destructive">
                  {driftCurricula.length} Curriculum{driftCurricula.length > 1 ? 'a' : ''} mit Drift
                </p>
                <ul className="mt-1 space-y-0.5">
                  {driftCurricula.map(c => (
                    <li key={c.curriculum_id} className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{c.curriculum_title}</span> — {c.driftHint}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Curricula Readiness Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">KG Rollout Readiness — alle Curricula</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? <Skeleton className="h-48" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Curriculum</TableHead>
                  <TableHead className="w-20 text-right">Komp.</TableHead>
                  <TableHead className="w-20 text-right">≥2 Err</TableHead>
                  <TableHead className="w-24 text-right">Coverage</TableHead>
                  <TableHead className="w-20 text-right">Errors</TableHead>
                   <TableHead className="w-20 text-center">Flag</TableHead>
                   <TableHead className="w-20 text-center">Status</TableHead>
                   <TableHead className="w-20 text-center">Drift</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.curricula || []).map((c) => (
                  <TableRow key={c.curriculum_id} className={cn(c.is_ready && 'bg-emerald-500/5')}>
                    <TableCell className="text-sm max-w-xs truncate font-medium">{c.curriculum_title}</TableCell>
                    <TableCell className="text-right text-sm font-mono text-muted-foreground">{c.competencies_total}</TableCell>
                    <TableCell className="text-right text-sm font-mono text-muted-foreground">{c.competencies_with_enough_errors}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn('h-full rounded-full', c.pct_ready >= 60 ? 'bg-emerald-500' : c.pct_ready >= 40 ? 'bg-yellow-500' : 'bg-destructive')}
                            style={{ width: `${Math.min(c.pct_ready, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono w-12 text-right">{c.pct_ready}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm font-mono text-muted-foreground">{c.total_error_patterns}</TableCell>
                    <TableCell className="text-center">
                      {c.flag_status
                        ? <CheckCircle2 className="h-4 w-4 text-emerald-500 inline" />
                        : <XCircle className="h-4 w-4 text-muted-foreground inline" />}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={c.is_ready ? 'default' : c.pct_ready >= 40 ? 'secondary' : 'outline'} className="text-[10px]">
                        {c.is_ready ? 'READY' : c.pct_ready >= 40 ? 'BALD' : 'NIEDRIG'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Recent Orchestrator Runs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Letzte Orchestrator-Runs
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!recentRuns?.length ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Noch keine Orchestrator-Runs protokolliert</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Zeitpunkt</TableHead>
                  <TableHead>Ergebnis</TableHead>
                  <TableHead>Detail</TableHead>
                  <TableHead className="w-20 text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentRuns.map((run: any) => {
                  const meta = run.metadata as any;
                  return (
                    <TableRow key={run.id}>
                      <TableCell className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                        {new Date(run.created_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}
                      </TableCell>
                      <TableCell className="text-sm">
                        {meta?.newly_ready?.length > 0 && (
                          <Badge variant="default" className="text-[10px] mr-1">
                            +{meta.newly_ready.length} ready
                          </Badge>
                        )}
                        {meta?.newly_unready?.length > 0 && (
                          <Badge variant="destructive" className="text-[10px] mr-1">
                            -{meta.newly_unready.length} unready
                          </Badge>
                        )}
                        {meta?.processed_count != null && (
                          <span className="text-xs text-muted-foreground">{meta.processed_count} verarbeitet</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                        {run.result_detail || run.error_message || '—'}
                      </TableCell>
                      <TableCell className="text-center">
                        {run.result_status === 'success'
                          ? <CheckCircle2 className="h-4 w-4 text-emerald-500 inline" />
                          : run.result_status === 'error'
                          ? <AlertTriangle className="h-4 w-4 text-destructive inline" />
                          : <Clock className="h-4 w-4 text-muted-foreground inline" />}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
