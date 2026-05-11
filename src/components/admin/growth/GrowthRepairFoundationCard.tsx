import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, RefreshCw, ShieldCheck, RotateCcw, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

type Module = {
  subscore: string;
  job_type: string;
  generator_kind: 'deterministic' | 'ai_generative' | 'audit_only';
  requires_council: boolean;
  requires_pre_post_score: boolean;
  enabled: boolean;
  description: string | null;
  updated_at: string;
};

type Run = {
  id: string;
  package_id: string;
  subscore: string;
  status: string;
  pre_score: number | null;
  post_score: number | null;
  score_delta: number | null;
  council_verdict: string | null;
  council_score: number | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
};

function statusTone(status: string): 'success' | 'warning' | 'error' | 'neutral' {
  if (status === 'completed') return 'success';
  if (status === 'failed' || status === 'rolled_back') return 'error';
  if (status === 'pending' || status === 'running' || status.startsWith('gate_') || status === 'generating' || status === 'council') return 'warning';
  return 'neutral';
}

export default function GrowthRepairFoundationCard() {
  const qc = useQueryClient();
  const [rollbackId, setRollbackId] = useState<string | null>(null);

  const modules = useQuery({
    queryKey: ['growth-repair-modules'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_get_growth_repair_modules' as any);
      if (error) throw error;
      return (data ?? []) as Module[];
    },
    staleTime: 60_000,
  });

  const runs = useQuery({
    queryKey: ['growth-repair-runs'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_get_growth_repair_runs' as any, { p_limit: 25 });
      if (error) throw error;
      return (data ?? []) as Run[];
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const toggle = useMutation({
    mutationFn: async ({ subscore, enabled }: { subscore: string; enabled: boolean }) => {
      const { data, error } = await supabase.rpc('admin_set_growth_repair_module_enabled' as any, {
        p_subscore: subscore, p_enabled: enabled,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_, v) => {
      toast.success(`Modul ${v.subscore}: ${v.enabled ? 'aktiviert' : 'deaktiviert'}`);
      qc.invalidateQueries({ queryKey: ['growth-repair-modules'] });
    },
    onError: (e: Error) => toast.error('Toggle fehlgeschlagen', { description: e.message }),
  });

  const rollback = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { data, error } = await supabase.rpc('admin_rollback_growth_repair_run' as any, {
        p_run_id: id, p_reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Run zurückgerollt');
      qc.invalidateQueries({ queryKey: ['growth-repair-runs'] });
      setRollbackId(null);
    },
    onError: (e: Error) => toast.error('Rollback fehlgeschlagen', { description: e.message }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Growth Repair Foundation
            <Badge variant="outline" className="text-[10px]">Welle 5 · Foundation</Badge>
          </CardTitle>
          <CardDescription>
            Modul-Registry + Pre/Post-Score Quality-Gate + Council-Gate (≥75). Module sind opt-in pro Subscore.
          </CardDescription>
        </div>
        <Button
          variant="outline" size="sm"
          onClick={() => { modules.refetch(); runs.refetch(); }}
          disabled={modules.isFetching || runs.isFetching}
        >
          <RefreshCw className={`h-3 w-3 mr-1 ${(modules.isFetching || runs.isFetching) ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Module Registry */}
        <div className="rounded-md border border-border-subtle">
          <div className="px-3 py-2 border-b border-border-subtle text-xs font-medium text-text-primary">
            Module Registry ({modules.data?.length ?? 0})
          </div>
          {modules.isLoading ? (
            <div className="p-3 text-xs text-text-secondary flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />Lade Module…
            </div>
          ) : (
            <table className="w-full text-[11px]">
              <thead className="text-text-secondary">
                <tr>
                  <th className="text-left px-3 py-1">Subscore</th>
                  <th className="text-left px-2 py-1">Job-Type</th>
                  <th className="text-left px-2 py-1">Kind</th>
                  <th className="text-center px-2 py-1" title="Council-Gate Pflicht">Council</th>
                  <th className="text-center px-2 py-1" title="Pre/Post-Score Pflicht">P/P</th>
                  <th className="text-center px-2 py-1">Enabled</th>
                </tr>
              </thead>
              <tbody>
                {modules.data?.map((m) => (
                  <tr key={m.subscore} className="border-t border-border-subtle">
                    <td className="px-3 py-1 font-mono text-text-primary">{m.subscore}</td>
                    <td className="px-2 py-1 font-mono text-text-secondary">{m.job_type}</td>
                    <td className="px-2 py-1">
                      <Badge variant="outline" className="text-[9px]">{m.generator_kind}</Badge>
                    </td>
                    <td className="text-center px-2 py-1">{m.requires_council ? '✓' : '–'}</td>
                    <td className="text-center px-2 py-1">{m.requires_pre_post_score ? '✓' : '–'}</td>
                    <td className="text-center px-2 py-1">
                      <Switch
                        checked={m.enabled}
                        disabled={toggle.isPending}
                        onCheckedChange={(v) => toggle.mutate({ subscore: m.subscore, enabled: v })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Recent Runs */}
        <div className="rounded-md border border-border-subtle">
          <div className="px-3 py-2 border-b border-border-subtle text-xs font-medium text-text-primary flex items-center gap-2">
            <Wrench className="h-3 w-3" /> Letzte Repair-Runs ({runs.data?.length ?? 0})
          </div>
          {runs.isLoading ? (
            <div className="p-3 text-xs text-text-secondary flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />Lade Runs…
            </div>
          ) : (runs.data?.length ?? 0) === 0 ? (
            <div className="p-3 text-xs text-text-secondary">
              Noch keine Repair-Runs. Module sind disabled — Worker muss Modul auf <code>enabled=true</code> setzen.
            </div>
          ) : (
            <ScrollArea className="max-h-[280px]">
              <table className="w-full text-[11px]">
                <thead className="text-text-secondary sticky top-0 bg-surface-elevated">
                  <tr>
                    <th className="text-left px-3 py-1">Subscore</th>
                    <th className="text-left px-2 py-1">Status</th>
                    <th className="text-right px-2 py-1">Pre</th>
                    <th className="text-right px-2 py-1">Post</th>
                    <th className="text-right px-2 py-1">Δ</th>
                    <th className="text-left px-2 py-1">Council</th>
                    <th className="text-left px-2 py-1">Created</th>
                    <th className="text-right px-2 py-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {runs.data?.map((r) => (
                    <tr key={r.id} className="border-t border-border-subtle">
                      <td className="px-3 py-1 font-mono text-text-primary">{r.subscore}</td>
                      <td className="px-2 py-1">
                        <span className={`font-mono text-status-${statusTone(r.status)}-text`}>{r.status}</span>
                      </td>
                      <td className="text-right px-2 py-1 font-mono">{r.pre_score?.toFixed(0) ?? '–'}</td>
                      <td className="text-right px-2 py-1 font-mono">{r.post_score?.toFixed(0) ?? '–'}</td>
                      <td className={`text-right px-2 py-1 font-mono ${
                        (r.score_delta ?? 0) > 0 ? 'text-status-success-text'
                        : (r.score_delta ?? 0) < 0 ? 'text-status-error-text' : 'text-text-secondary'
                      }`}>
                        {r.score_delta !== null ? (r.score_delta > 0 ? '+' : '') + r.score_delta.toFixed(0) : '–'}
                      </td>
                      <td className="px-2 py-1 text-text-secondary">
                        {r.council_verdict ? `${r.council_verdict}/${r.council_score ?? '–'}` : '–'}
                      </td>
                      <td className="px-2 py-1 text-text-secondary">{new Date(r.created_at).toLocaleString('de-DE')}</td>
                      <td className="text-right px-2 py-1">
                        {r.status === 'completed' && (
                          <Button
                            variant="ghost" size="sm"
                            className="h-6 text-[10px] px-2"
                            disabled={rollback.isPending && rollbackId === r.id}
                            onClick={() => {
                              const reason = window.prompt('Rollback-Grund (Pflicht, ≥3 Zeichen):');
                              if (!reason || reason.trim().length < 3) return;
                              setRollbackId(r.id);
                              rollback.mutate({ id: r.id, reason: reason.trim() });
                            }}
                          >
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          )}
        </div>

        <div className="text-[10px] text-text-secondary">
          Quality-Gate: Pre/Post-Score (post &lt; pre → Rollback) + Council ≥75 (für AI-Generative Module).
          Module-Worker fehlen noch — Foundation ist live, Module folgen pro Loop.
        </div>
      </CardContent>
    </Card>
  );
}
