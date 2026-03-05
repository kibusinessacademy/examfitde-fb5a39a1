import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Play, RefreshCw, CheckCircle2, AlertTriangle, XCircle, Shield, Activity, Database, BookOpen, Brain, Lock, Users } from 'lucide-react';
import { formatDateTime } from '@/lib/timezone';
import { toast } from 'sonner';

type AuditRun = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  scope: string;
  mode: string;
  health_score: number | null;
  infra_score: number | null;
  pipeline_score: number | null;
  data_score: number | null;
  content_score: number | null;
  didactic_score: number | null;
  security_score: number | null;
  total_checks: number | null;
  passed_checks: number | null;
  warning_checks: number | null;
  critical_checks: number | null;
  autofix_attempted: number | null;
  autofix_applied: number | null;
  autofix_failed: number | null;
};

type AuditFinding = {
  id: string;
  layer: string;
  check_id: string;
  check_name: string;
  severity: string;
  passed: boolean;
  metric_value: number | null;
  threshold: number | null;
  root_cause_category: string | null;
  root_cause_detail: string | null;
  recommended_action: string | null;
  action_risk: string | null;
  sample_rows: unknown;
};

const LAYER_ICONS: Record<string, typeof Activity> = {
  infra: Activity,
  pipeline: RefreshCw,
  data: Database,
  content: BookOpen,
  didactic: Brain,
  security: Lock,
  e2e: Users,
};

const LAYER_LABELS: Record<string, string> = {
  infra: 'Infrastruktur',
  pipeline: 'Pipeline',
  data: 'Datenintegrität',
  content: 'Content',
  didactic: 'Didaktik',
  security: 'Sicherheit',
  e2e: 'E2E / UX',
};

function scoreColor(score: number | null) {
  if (score === null) return 'text-muted-foreground';
  if (score >= 90) return 'text-green-500';
  if (score >= 70) return 'text-yellow-500';
  return 'text-destructive';
}

function scoreBg(score: number | null) {
  if (score === null) return 'bg-muted';
  if (score >= 90) return 'bg-green-500/10';
  if (score >= 70) return 'bg-yellow-500/10';
  return 'bg-destructive/10';
}

function SeverityBadge({ severity }: { severity: string }) {
  if (severity === 'critical') return <Badge variant="destructive" className="text-[10px]">Critical</Badge>;
  if (severity === 'warning') return <Badge className="bg-yellow-500/20 text-yellow-700 border-yellow-500/30 text-[10px]">Warning</Badge>;
  return <Badge variant="outline" className="text-[10px]">Info</Badge>;
}

function ScoreRing({ score, label, icon: Icon }: { score: number | null; label: string; icon: typeof Activity }) {
  return (
    <div className={`flex flex-col items-center gap-1 p-3 rounded-xl ${scoreBg(score)}`}>
      <Icon className={`h-5 w-5 ${scoreColor(score)}`} />
      <span className={`text-2xl font-bold tabular-nums ${scoreColor(score)}`}>
        {score ?? '—'}%
      </span>
      <span className="text-[11px] text-muted-foreground font-medium">{label}</span>
    </div>
  );
}

export default function AuditDashboardPage() {
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // Fetch recent audit runs
  const { data: runs, isLoading: runsLoading } = useQuery({
    queryKey: ['audit-runs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_audit_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return data as AuditRun[];
    },
    refetchInterval: 15000,
  });

  // effectiveRunId computed after runs load
  const latestRun = runs?.[0];
  const effectiveRunId = selectedRunId ?? latestRun?.id ?? null;
  const selectedRun = runs?.find((r) => r.id === effectiveRunId) ?? latestRun;

  // Fetch findings for selected run
  const { data: findings, isLoading: findingsLoading } = useQuery({
    queryKey: ['audit-findings', effectiveRunId],
    queryFn: async () => {
      if (!effectiveRunId) return [];
      const { data, error } = await supabase
        .from('system_audit_findings')
        .select('*')
        .eq('run_id', effectiveRunId)
        .order('severity', { ascending: true });
      if (error) throw error;
      return data as AuditFinding[];
    },
    enabled: !!effectiveRunId,
  });

  // Manual audit trigger
  const triggerAudit = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('unified-audit-runner', {
        body: { scope: 'daily', mode: 'safe_autofix' },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Audit abgeschlossen — Health Score: ${data.health_score}%`);
      queryClient.invalidateQueries({ queryKey: ['audit-runs'] });
      if (data.run_id) setSelectedRunId(data.run_id);
    },
    onError: (err) => toast.error(`Audit fehlgeschlagen: ${err.message}`),
  });

  // (effectiveRunId/selectedRun computed above, before findings query)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">System Audit</h1>
          <p className="text-sm text-muted-foreground">
            Autonomes Audit-System · Level 2 Safe AutoFix
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['audit-runs'] })}
          >
            <RefreshCw className="h-4 w-4 mr-1" /> Aktualisieren
          </Button>
          <Button
            size="sm"
            onClick={() => triggerAudit.mutate()}
            disabled={triggerAudit.isPending}
          >
            {triggerAudit.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-1" />
            )}
            Manuelles Audit
          </Button>
        </div>
      </div>

      {/* Health Score Overview */}
      {selectedRun && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                Health Score
                <span className={`ml-3 text-3xl font-black tabular-nums ${scoreColor(selectedRun.health_score)}`}>
                  {selectedRun.health_score ?? '—'}%
                </span>
              </CardTitle>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{selectedRun.scope}</Badge>
                <Badge variant="outline">{selectedRun.mode}</Badge>
                <span>{formatDateTime(selectedRun.started_at)}</span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 sm:grid-cols-7 gap-2">
              {(['infra', 'pipeline', 'data', 'content', 'didactic', 'security', 'e2e'] as const).map((layer) => {
                const scoreKey = `${layer}_score` as keyof AuditRun;
                const score = selectedRun[scoreKey] as number | null;
                const Icon = LAYER_ICONS[layer] ?? Shield;
                return (
                  <ScoreRing key={layer} score={score} label={LAYER_LABELS[layer] ?? layer} icon={Icon} />
                );
              })}
            </div>
            {/* Stats row */}
            <div className="flex items-center gap-4 mt-4 text-sm">
              <div className="flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span>{selectedRun.passed_checks ?? 0} bestanden</span>
              </div>
              <div className="flex items-center gap-1">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                <span>{selectedRun.warning_checks ?? 0} Warnungen</span>
              </div>
              <div className="flex items-center gap-1">
                <XCircle className="h-4 w-4 text-destructive" />
                <span>{selectedRun.critical_checks ?? 0} Kritisch</span>
              </div>
              {(selectedRun.autofix_applied ?? 0) > 0 && (
                <div className="flex items-center gap-1 text-primary">
                  <RefreshCw className="h-4 w-4" />
                  <span>{selectedRun.autofix_applied} AutoFix angewandt</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Run History */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Audit-Verlauf</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[500px] overflow-y-auto space-y-1 p-3">
            {runsLoading && <Loader2 className="h-5 w-5 animate-spin mx-auto" />}
            {runs?.map((run) => (
              <button
                key={run.id}
                onClick={() => setSelectedRunId(run.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                  effectiveRunId === run.id
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-muted/50 text-muted-foreground'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`font-bold tabular-nums text-sm ${scoreColor(run.health_score)}`}>
                    {run.health_score ?? '—'}%
                  </span>
                  <Badge variant="outline" className="text-[9px]">{run.scope}</Badge>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span>{formatDateTime(run.started_at)}</span>
                  {run.status === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}
                </div>
                {(run.critical_checks ?? 0) > 0 && (
                  <span className="text-destructive">{run.critical_checks} critical</span>
                )}
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Findings Detail */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Findings {selectedRun && <span className="text-muted-foreground font-normal">· {findings?.length ?? 0} Checks</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[500px] overflow-y-auto space-y-2 p-3">
            {findingsLoading && <Loader2 className="h-5 w-5 animate-spin mx-auto" />}
            {findings?.map((f) => {
              const Icon = LAYER_ICONS[f.layer] ?? Shield;
              return (
                <div
                  key={f.id}
                  className={`px-3 py-2.5 rounded-lg border text-sm ${
                    !f.passed
                      ? f.severity === 'critical'
                        ? 'border-destructive/30 bg-destructive/5'
                        : f.severity === 'warning'
                        ? 'border-yellow-500/30 bg-yellow-500/5'
                        : 'border-border'
                      : 'border-border/50 bg-muted/20'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-medium flex-1">{f.check_name}</span>
                    <SeverityBadge severity={f.passed ? 'info' : f.severity} />
                    {f.passed ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive" />
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span className="font-mono">{f.check_id}</span>
                    {f.metric_value !== null && (
                      <span>Wert: <strong className="text-foreground">{f.metric_value}</strong>{f.threshold !== null && ` / Schwelle: ${f.threshold}`}</span>
                    )}
                    {f.action_risk && !f.passed && (
                      <Badge variant="outline" className="text-[9px]">{f.action_risk}</Badge>
                    )}
                  </div>
                  {f.root_cause_detail && !f.passed && (
                    <p className="text-xs text-muted-foreground mt-1 italic">{f.root_cause_detail}</p>
                  )}
                  {f.recommended_action && !f.passed && (
                    <p className="text-xs mt-1">→ {f.recommended_action}</p>
                  )}
                </div>
              );
            })}
            {findings?.length === 0 && !findingsLoading && (
              <p className="text-sm text-muted-foreground text-center py-8">Keine Findings für diesen Run.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
