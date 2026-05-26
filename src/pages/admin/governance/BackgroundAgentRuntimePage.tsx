/**
 * Background Agent Runtime — Unification Bridge (Pfad A)
 *
 * SSOT-Surface über 5 lebende Background-Quellen:
 *   • job_queue              — Worker-Execution
 *   • system_intents         — Event-Trigger
 *   • berufs_ki_agent_runs   — capability-scoped AI-Agents
 *   • runtime_action_results — Governance Safe-Actions
 *   • heal_permanent_fix_tasks — Human-tracked Follow-ups
 *
 * NO new tables. NO parallel runtime. Read-only Cockpit.
 * Capability-Gate kommt aus runtime_safe_actions + berufs_ki_agents.
 */
import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { Activity, Layers, ShieldCheck, RefreshCw, AlertTriangle, Sparkles, Play } from 'lucide-react';
import {
  resolveBackgroundAgentActions,
  dispatchBackgroundAgentAction,
  isNavigationAction,
  type BackgroundAgentAction,
  type BackgroundAgentSource,
} from '@/lib/governance/backgroundAgentActions';
import { groupTasksByWorkUnit, WORK_UNIT_REGISTRY, type WorkUnitGroup } from '@/lib/governance/backgroundAgentWorkUnits';
import {
  WORKFLOW_TRIGGER_REGISTRY,
  resolveWorkflowTrigger,
  dispatchWorkflowTrigger,
  type WorkflowTriggerType,
  type ResolvedWorkflowTrigger,
} from '@/lib/governance/backgroundAgentWorkflowTriggers';
import { ArtifactPreviewDrawer } from '@/components/governance/ArtifactPreviewDrawer';
import { FileText } from 'lucide-react';




type SummaryRow = {
  source_type: string;
  total: number;
  pending: number;
  running: number;
  awaiting_approval: number;
  completed: number;
  failed: number;
  high_risk: number;
  last_activity: string | null;
};

type TaskRow = {
  source_type: string;
  source_id: string;
  task_kind: string | null;
  status: string | null;
  risk_level: string | null;
  capability_summary: string | null;
  approval_state: string | null;
  cost_eur: number | null;
  budget_eur: number | null;
  artifact_count: number | null;
  last_event_at: string | null;
  created_at: string | null;
  package_id: string | null;
  actor: string | null;
  meta: Record<string, unknown> | null;
};

type CapabilityRow = {
  registry: string;
  key: string;
  label: string;
  severity: string;
  requires_approval: boolean;
  is_enabled: boolean;
  allowed_roles: string[] | null;
  details: Record<string, unknown> | null;
};

const SOURCE_LABEL: Record<string, string> = {
  job_queue: 'Job-Queue (Worker)',
  system_intents: 'System Intents (Events)',
  berufs_ki_agent_runs: 'Berufs-KI Agents',
  runtime_action_results: 'Runtime Safe-Actions',
  heal_permanent_fix_tasks: 'Human Follow-ups',
};

const RISK_TONE: Record<string, string> = {
  low: 'bg-surface-muted text-fg-muted',
  medium: 'bg-status-bg-subtle-warning text-status-fg-warning',
  high: 'bg-status-bg-subtle-danger text-status-fg-danger',
};

const SEVERITY_TONE: Record<string, string> = {
  ok: 'bg-status-bg-subtle-success text-status-fg-success',
  info: 'bg-surface-muted text-fg-muted',
  warn: 'bg-status-bg-subtle-warning text-status-fg-warning',
  error: 'bg-status-bg-subtle-danger text-status-fg-danger',
};

const APPROVAL_LABEL: Record<string, { label: string; tone: string }> = {
  not_required: { label: '—', tone: 'text-fg-muted' },
  pending: { label: 'offen', tone: 'text-status-fg-warning' },
  approved: { label: '✓ approved', tone: 'text-status-fg-success' },
  rejected: { label: '✗ rejected', tone: 'text-status-fg-danger' },
};

export default function BackgroundAgentRuntimePage() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSource, setFilterSource] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [approvalOnly, setApprovalOnly] = useState(false);
  const [pendingDispatch, setPendingDispatch] = useState<{
    task: TaskRow; action: BackgroundAgentAction; label: string;
  } | null>(null);
  const [pendingTrigger, setPendingTrigger] = useState<ResolvedWorkflowTrigger | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [previewTask, setPreviewTask] = useState<TaskRow | null>(null);


  function navigateToSource(t: TaskRow, kind: BackgroundAgentAction) {
    // P71: open_artifacts now opens the Artifact Preview Drawer (in-place, no nav).
    if (kind === 'open_artifacts') {
      setPreviewTask(t);
      return;
    }
    // P70.2: navigation only — never reads source tables directly.
    if (t.package_id && kind === 'open_source') {
      window.open(`/admin/packages/${t.package_id}`, '_blank', 'noopener');
      return;
    }
    if (kind === 'open_approval' && t.package_id) {
      window.open(`/admin/packages/${t.package_id}#approval`, '_blank', 'noopener');
      return;
    }
    toast({
      title: 'Keine Zielseite verfügbar',
      description: 'Diese Quelle hat aktuell keinen Detail-Link im Admin-UI.',
    });
  }

  async function performDispatch() {
    if (!pendingDispatch) return;
    const { task, action, label } = pendingDispatch;
    setDispatching(true);
    try {
      const res = await dispatchBackgroundAgentAction(
        task.source_type as BackgroundAgentSource,
        task.source_id,
        action as Exclude<BackgroundAgentAction, 'open_source' | 'open_artifacts' | 'open_approval'>,
        `cockpit_p70_2:${label}`,
      );
      toast({
        title: 'Action dispatched',
        description: `${label} → ${res.route}`,
      });
      setPendingDispatch(null);
      await loadAll();
    } catch (e) {
      toast({
        title: 'Dispatch fehlgeschlagen',
        description: e instanceof Error ? e.message : 'Unbekannter Fehler',
        variant: 'destructive',
      });
    } finally {
      setDispatching(false);
    }
  }

  async function performTrigger() {
    if (!pendingTrigger) return;
    setTriggering(true);
    try {
      const res = await dispatchWorkflowTrigger(
        pendingTrigger.type,
        `cockpit_p70_4:${pendingTrigger.type}`,
      );
      toast({
        title: 'Workflow gestartet',
        description: `${pendingTrigger.descriptor.startLabel} → ${res.route}`,
      });
      setPendingTrigger(null);
      await loadAll();
    } catch (e) {
      toast({
        title: 'Trigger fehlgeschlagen',
        description: e instanceof Error ? e.message : 'Unbekannter Fehler',
        variant: 'destructive',
      });
    } finally {
      setTriggering(false);
    }
  }


  async function loadAll() {
    setLoading(true);
    try {
      const [s, t, c] = await Promise.all([

        supabase.rpc('admin_get_background_agent_runtime_summary'),
        supabase.rpc('admin_get_background_agent_tasks', {
          _source_type: filterSource === 'all' ? undefined : filterSource,
          _status: filterStatus === 'all' ? undefined : filterStatus,
          _risk_level: undefined,
          _approval_only: approvalOnly,
          _limit: 200,
        }),
        supabase.rpc('admin_get_background_agent_capabilities'),
      ]);
      if (s.error) throw s.error;
      if (t.error) throw t.error;
      if (c.error) throw c.error;
      setSummary((s.data ?? []) as SummaryRow[]);
      setTasks((t.data ?? []) as TaskRow[]);
      setCapabilities((c.data ?? []) as CapabilityRow[]);
    } catch (e) {
      toast({
        title: 'Ladefehler',
        description: e instanceof Error ? e.message : 'Unbekannter Fehler',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSource, filterStatus, approvalOnly]);

  const totals = useMemo(() => {
    return summary.reduce(
      (acc, r) => ({
        total: acc.total + Number(r.total ?? 0),
        running: acc.running + Number(r.running ?? 0),
        pending: acc.pending + Number(r.pending ?? 0),
        awaiting_approval: acc.awaiting_approval + Number(r.awaiting_approval ?? 0),
        failed: acc.failed + Number(r.failed ?? 0),
      }),
      { total: 0, running: 0, pending: 0, awaiting_approval: 0, failed: 0 },
    );
  }, [summary]);

  return (
    <div className="container mx-auto space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-fg-muted text-xs uppercase tracking-wide">
            <Activity className="h-3.5 w-3.5" />
            Governance · Background Agent Runtime
          </div>
          <h1 className="text-2xl font-semibold mt-1">Background Agent Runtime</h1>
          <p className="text-sm text-fg-muted max-w-3xl mt-1">
            SSOT-Sicht auf alle Background-Arbeiten der Plattform.
            Vereinheitlicht 5 lebende Quellen ohne neue Tabellen oder parallele Runtime.
            Capability-Gate aus <code>runtime_safe_actions</code> und <code>berufs_ki_agents</code>.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadAll()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Aktualisieren
        </Button>
      </header>

      {/* KPI-Strip */}
      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Tasks gesamt" value={totals.total} />
        <KpiCard label="Pending" value={totals.pending} tone="info" />
        <KpiCard label="Running" value={totals.running} tone="info" />
        <KpiCard label="Approval offen" value={totals.awaiting_approval} tone="warn" icon={AlertTriangle} />
        <KpiCard label="Failed" value={totals.failed} tone={totals.failed > 0 ? 'error' : 'ok'} />
      </section>

      <Tabs defaultValue="workflows" className="w-full">
        <TabsList>
          <TabsTrigger value="workflows"><Sparkles className="h-4 w-4 mr-2" />Workflows</TabsTrigger>
          <TabsTrigger value="sources"><Layers className="h-4 w-4 mr-2" />Quellen</TabsTrigger>
          <TabsTrigger value="tasks"><Activity className="h-4 w-4 mr-2" />Tasks</TabsTrigger>
          <TabsTrigger value="capabilities"><ShieldCheck className="h-4 w-4 mr-2" />Capabilities</TabsTrigger>
        </TabsList>

        {/* P70.3 + P70.4 — Workflows: customer-facing outcomes + admin Start-Triggers */}
        <TabsContent value="workflows" className="space-y-3">
          {(() => {
            const groupsByType = new Map<WorkflowTriggerType, WorkUnitGroup<TaskRow>>();
            for (const g of groupTasksByWorkUnit(tasks)) {
              groupsByType.set(g.type, g);
            }
            const types: WorkflowTriggerType[] = ['seo_opportunity', 'compliance_drift', 'operational_quality'];
            return (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {types.map((type) => {
                  const descriptor = WORK_UNIT_REGISTRY[type];
                  const triggerDescriptor = WORKFLOW_TRIGGER_REGISTRY[type];
                  const trigger = resolveWorkflowTrigger(type, { isAdmin, capabilities });
                  const g = groupsByType.get(type);
                  return (
                    <Card key={type} className="shadow-elev-1">
                      <CardHeader>
                        <div className="flex items-center justify-between gap-2">
                          <CardTitle className="text-base">{descriptor.outcomeLabel}</CardTitle>
                          {descriptor.visibility === 'internal_only_quality' && (
                            <Badge variant="outline" className="text-[10px] uppercase">intern</Badge>
                          )}
                        </div>
                        <CardDescription className="text-xs">{descriptor.description}</CardDescription>
                        {descriptor.visibility === 'internal_only_quality' && (
                          <div className="text-[11px] text-fg-muted mt-1">
                            Kunden-Sicht: <span className="italic">„{descriptor.externalLabel}"</span>
                          </div>
                        )}
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {/* P70.4 — Start trigger CTA */}
                        {trigger.visible && (
                          <Button
                            size="sm"
                            variant={trigger.dangerous ? 'destructive' : 'default'}
                            disabled={!trigger.enabled || triggering}
                            title={trigger.reason}
                            data-workflow-trigger={type}
                            className="w-full justify-center"
                            onClick={() => setPendingTrigger(trigger)}
                          >
                            <Play className="h-3.5 w-3.5 mr-2" />
                            {triggerDescriptor.startLabel}
                          </Button>
                        )}
                        <div className="grid grid-cols-4 gap-2 text-center text-xs">
                          <div><div className="font-semibold tabular-nums text-base">{g?.total ?? 0}</div><div className="text-fg-muted">Gesamt</div></div>
                          <div><div className="font-semibold tabular-nums text-base">{(g?.pending ?? 0) + (g?.running ?? 0)}</div><div className="text-fg-muted">Aktiv</div></div>
                          <div><div className={`font-semibold tabular-nums text-base ${(g?.awaitingApproval ?? 0) > 0 ? 'text-status-fg-warning' : ''}`}>{g?.awaitingApproval ?? 0}</div><div className="text-fg-muted">Approval</div></div>
                          <div><div className={`font-semibold tabular-nums text-base ${(g?.failed ?? 0) > 0 ? 'text-status-fg-danger' : ''}`}>{g?.failed ?? 0}</div><div className="text-fg-muted">Failed</div></div>
                        </div>
                        <div className="flex flex-wrap gap-2 text-[11px] text-fg-muted">
                          <span>📎 {g?.artifactCount ?? 0} Artefakte</span>
                          {(g?.highRisk ?? 0) > 0 && <span className="text-status-fg-danger">⚠ {g!.highRisk} High-Risk</span>}
                        </div>
                        {g && g.sample.length > 0 && (
                          <div className="space-y-1.5 pt-2 border-t border-border">
                            <div className="text-[11px] text-fg-muted uppercase tracking-wide">Letzte Einheiten</div>
                            {g.sample.slice(0, 5).map((t) => {
                              const actions = resolveBackgroundAgentActions(t);
                              return (
                                <div
                                  key={`${t.source_type}-${t.source_id}`}
                                  className="flex items-center justify-between gap-2 text-xs"
                                >
                                  <div className="truncate flex-1">
                                    <span className="font-medium">{t.capability_summary ?? '—'}</span>
                                    <span className="text-fg-muted ml-1">· {t.status ?? '—'}</span>
                                  </div>
                                  <div className="flex gap-1">
                                    {actions.slice(0, 2).map((a) => (
                                      <Button
                                        key={a.action}
                                        size="sm"
                                        variant={a.dangerous ? 'destructive' : isNavigationAction(a.action) ? 'ghost' : 'outline'}
                                        disabled={!a.enabled}
                                        title={a.reason}
                                        className="h-6 px-2 text-[11px]"
                                        onClick={() => {
                                          if (isNavigationAction(a.action)) navigateToSource(t, a.action);
                                          else setPendingDispatch({ task: t, action: a.action, label: a.label });
                                        }}
                                      >
                                        {a.label}
                                      </Button>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            );
          })()}
        </TabsContent>



        {/* Sources Overview */}
        <TabsContent value="sources" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Quellen-Übersicht</CardTitle>
              <CardDescription>
                14-Tage-Fenster für Hochfrequenzquellen, all-time für Agent-Runs und Human-Follow-ups.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quelle</TableHead>
                    <TableHead className="text-right">Gesamt</TableHead>
                    <TableHead className="text-right">Pending</TableHead>
                    <TableHead className="text-right">Running</TableHead>
                    <TableHead className="text-right">Approval</TableHead>
                    <TableHead className="text-right">Completed</TableHead>
                    <TableHead className="text-right">Failed</TableHead>
                    <TableHead>Letzte Aktivität</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.map((r) => (
                    <TableRow key={r.source_type}>
                      <TableCell className="font-medium">{SOURCE_LABEL[r.source_type] ?? r.source_type}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.total}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.pending}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.running}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.awaiting_approval > 0 ? (
                          <Badge className={SEVERITY_TONE.warn}>{r.awaiting_approval}</Badge>
                        ) : (
                          0
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.completed}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.failed > 0 ? (
                          <Badge className={SEVERITY_TONE.error}>{r.failed}</Badge>
                        ) : (
                          0
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-fg-muted">
                        {r.last_activity ? new Date(r.last_activity).toLocaleString('de-DE') : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                  {summary.length === 0 && !loading && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-fg-muted py-6">
                        Keine Background-Tasks im Fenster.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tasks List */}
        <TabsContent value="tasks" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Letzte Tasks</CardTitle>
              <CardDescription>Max 200 Einträge, neueste zuerst.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-3 items-end">
                <div className="space-y-1">
                  <Label className="text-xs">Quelle</Label>
                  <Select value={filterSource} onValueChange={setFilterSource}>
                    <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Alle Quellen</SelectItem>
                      {Object.entries(SOURCE_LABEL).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Status</Label>
                  <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Alle</SelectItem>
                      <SelectItem value="pending">pending</SelectItem>
                      <SelectItem value="queued">queued</SelectItem>
                      <SelectItem value="processing">processing</SelectItem>
                      <SelectItem value="running">running</SelectItem>
                      <SelectItem value="awaiting_approval">awaiting_approval</SelectItem>
                      <SelectItem value="completed">completed</SelectItem>
                      <SelectItem value="failed">failed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2 pb-2">
                  <Switch id="approval-only" checked={approvalOnly} onCheckedChange={setApprovalOnly} />
                  <Label htmlFor="approval-only" className="text-sm">Nur Approval-pflichtige</Label>
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quelle</TableHead>
                    <TableHead>Arbeitseinheit</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Risiko</TableHead>
                    <TableHead>Approval</TableHead>
                    <TableHead className="text-right">Artefakte</TableHead>
                    <TableHead className="text-right">Kosten €</TableHead>
                    <TableHead>Letztes Ereignis</TableHead>
                    <TableHead>Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((t) => {
                    const risk = t.risk_level ?? 'low';
                    const approval = APPROVAL_LABEL[t.approval_state ?? 'not_required'] ?? APPROVAL_LABEL.not_required;
                    const actions = resolveBackgroundAgentActions(t);
                    return (
                      <TableRow key={`${t.source_type}-${t.source_id}`}>
                        <TableCell className="text-xs text-fg-muted">{SOURCE_LABEL[t.source_type] ?? t.source_type}</TableCell>
                        <TableCell className="font-medium text-sm">{t.capability_summary ?? t.task_kind ?? '—'}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{t.status ?? '—'}</Badge></TableCell>
                        <TableCell>
                          <Badge className={RISK_TONE[risk] ?? RISK_TONE.low}>{risk}</Badge>
                        </TableCell>
                        <TableCell className={`text-xs ${approval.tone}`}>{approval.label}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs">{t.artifact_count ?? 0}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {t.cost_eur != null ? Number(t.cost_eur).toFixed(2) : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-fg-muted whitespace-nowrap">
                          {t.last_event_at ? new Date(t.last_event_at).toLocaleString('de-DE') : '—'}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1" data-testid={`actions-${t.source_id}`}>
                            {actions.map((a) => (
                              <Button
                                key={a.action}
                                size="sm"
                                variant={a.dangerous ? 'destructive' : isNavigationAction(a.action) ? 'ghost' : 'outline'}
                                disabled={!a.enabled}
                                title={a.reason}
                                aria-label={`${a.label} — ${t.source_type}`}
                                onClick={() => {
                                  if (isNavigationAction(a.action)) {
                                    navigateToSource(t, a.action);
                                  } else {
                                    setPendingDispatch({ task: t, action: a.action, label: a.label });
                                  }
                                }}
                              >
                                {a.label}
                              </Button>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {tasks.length === 0 && !loading && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-fg-muted py-6">
                        Keine Arbeitseinheiten im aktuellen Filter.
                      </TableCell>
                    </TableRow>
                  )}

                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Capability Registry */}
        <TabsContent value="capabilities" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Capability-Registry</CardTitle>
              <CardDescription>
                Read-only Sicht auf die beiden bestehenden Gates: <code>runtime_safe_actions</code> (Plattform-Operationen)
                und <code>berufs_ki_agents</code> (capability-scoped AI-Agents). Hier wird sichtbar, was ein Agent darf — und was nicht.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Registry</TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Sev.</TableHead>
                    <TableHead>Approval</TableHead>
                    <TableHead>Aktiv</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {capabilities.map((c) => (
                    <TableRow key={`${c.registry}-${c.key}`}>
                      <TableCell className="text-xs text-fg-muted">{c.registry}</TableCell>
                      <TableCell className="font-mono text-xs">{c.key}</TableCell>
                      <TableCell className="text-sm">{c.label}</TableCell>
                      <TableCell><Badge className={SEVERITY_TONE[c.severity] ?? SEVERITY_TONE.info}>{c.severity}</Badge></TableCell>
                      <TableCell className="text-xs">
                        {c.requires_approval
                          ? <span className="text-status-fg-warning">Pflicht</span>
                          : <span className="text-fg-muted">auto</span>}
                      </TableCell>
                      <TableCell>
                        <Badge className={c.is_enabled ? SEVERITY_TONE.ok : SEVERITY_TONE.info}>
                          {c.is_enabled ? 'ja' : 'nein'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {capabilities.length === 0 && !loading && (
                    <TableRow><TableCell colSpan={6} className="text-center text-fg-muted py-6">Keine Capabilities registriert.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!pendingDispatch} onOpenChange={(o) => !o && setPendingDispatch(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingDispatch?.label} ausführen?</AlertDialogTitle>
            <AlertDialogDescription>
              Die Aktion läuft über die bestehende Dispatcher-Pipeline — kein paralleler
              Schreibpfad. Quelle <code>{pendingDispatch?.task.source_type}</code>,
              ID <code className="text-xs">{pendingDispatch?.task.source_id}</code>.
              Jeder Dispatch wird in <code>auto_heal_log</code> auditiert.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dispatching}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void performDispatch(); }} disabled={dispatching}>
              {dispatching ? 'Dispatcht…' : 'Bestätigen'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* P70.4 — Workflow trigger confirm dialog */}
      <AlertDialog open={!!pendingTrigger} onOpenChange={(o) => !o && setPendingTrigger(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingTrigger?.descriptor.startLabel}?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingTrigger?.descriptor.confirmDescription}
              <span className="block mt-2 text-xs text-fg-muted">
                Dispatch über bestehende Runtime — kein paralleler Schreibpfad.
                Wird in <code>auto_heal_log</code> als{' '}
                <code>background_agent_action_dispatched</code> auditiert.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={triggering}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void performTrigger(); }}
              disabled={triggering}
            >
              {triggering ? 'Startet…' : 'Workflow starten'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}


function KpiCard({
  label, value, tone = 'info', icon: Icon,
}: { label: string; value: number; tone?: keyof typeof SEVERITY_TONE; icon?: typeof AlertTriangle }) {
  return (
    <Card className="shadow-elev-1">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="text-xs text-fg-muted uppercase tracking-wide">{label}</div>
          {Icon && <Icon className="h-4 w-4 text-fg-muted" />}
        </div>
        <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === 'error' ? 'text-status-fg-danger' : tone === 'warn' ? 'text-status-fg-warning' : ''}`}>
          {value.toLocaleString('de-DE')}
        </div>
      </CardContent>
    </Card>
  );
}
