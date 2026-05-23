import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CopyButton } from '@/components/admin/shared/CopyButton';
import {
  ARCHITECTURE_RULES,
  reviewArchitecture,
  type ArchitectureProposal,
  type ProposalKind,
  type ArchitectureReview,
  type RuleFinding,
} from '@/lib/governance/architecture-review';
import { runtimePlanToProposal, type RuntimeActionPlan } from '@/lib/governance/runtime-proposal-adapter';
import { ShieldCheck, AlertTriangle, Ban, Info } from 'lucide-react';

const KIND_OPTIONS: { value: ProposalKind; label: string }[] = [
  { value: 'table', label: 'Neue Tabelle' },
  { value: 'view', label: 'Neue View' },
  { value: 'rpc', label: 'Neue RPC / Funktion' },
  { value: 'edge_function', label: 'Neue Edge Function' },
  { value: 'queue', label: 'Neue Queue / Worker' },
  { value: 'registry', label: 'Neue Registry' },
  { value: 'cron', label: 'Neuer Cron-Job' },
  { value: 'audit_log', label: 'Neuer Audit-Log-Stream' },
];

const VERDICT_STYLE: Record<ArchitectureReview['verdict'], { label: string; tone: string; icon: typeof ShieldCheck }> = {
  approved: { label: 'Approved', tone: 'bg-status-bg-subtle-success text-status-fg-success', icon: ShieldCheck },
  review_required: { label: 'Review erforderlich', tone: 'bg-status-bg-subtle-warning text-status-fg-warning', icon: AlertTriangle },
  blocked: { label: 'Blockiert', tone: 'bg-status-bg-subtle-danger text-status-fg-danger', icon: Ban },
};

const SEVERITY_ICON = { block: Ban, warn: AlertTriangle, info: Info } as const;
const SEVERITY_TONE = {
  block: 'text-status-fg-danger',
  warn: 'text-status-fg-warning',
  info: 'text-fg-muted',
} as const;

function csv(s: string): string[] {
  return s.split(',').map((t) => t.trim()).filter(Boolean);
}

export default function ArchitecturePage() {
  const [kind, setKind] = useState<ProposalKind>('table');
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [tags, setTags] = useState('');
  const [touches, setTouches] = useState('');
  // v1.1 inventory
  const [proposedTables, setProposedTables] = useState('');
  const [proposedJobs, setProposedJobs] = useState('');
  const [proposedEvents, setProposedEvents] = useState('');
  const [proposedAuditActions, setProposedAuditActions] = useState('');
  const [proposedRoutes, setProposedRoutes] = useState('');
  const [proposedEdgeFns, setProposedEdgeFns] = useState('');
  // governance flags
  const [writesProductionAutonomously, setWritesAutonomous] = useState(false);
  const [hasAuditContract, setHasAudit] = useState(false);
  const [hasStopCondition, setHasStop] = useState(false);
  const [hasEligibilityGate, setHasGate] = useState(false);
  const [rlsStatus, setRls] = useState<'on' | 'not_applicable' | 'off'>('on');
  const [usesHasRole, setHasRole] = useState(true);
  const [hasHiddenState, setHidden] = useState(false);
  const [review, setReview] = useState<ArchitectureReview | null>(null);

  const proposal = useMemo<ArchitectureProposal>(
    () => ({
      kind,
      name: name.trim(),
      purpose: purpose.trim(),
      tags: csv(tags),
      touches: csv(touches),
      proposed_tables: csv(proposedTables),
      proposed_jobs: csv(proposedJobs),
      proposed_events: csv(proposedEvents),
      proposed_audit_actions: csv(proposedAuditActions),
      proposed_routes: csv(proposedRoutes),
      proposed_edge_functions: csv(proposedEdgeFns),
      writesProductionAutonomously,
      hasAuditContract,
      hasStopCondition,
      hasEligibilityGate,
      rlsStatus,
      usesHasRole,
      hasHiddenState,
    }),
    [
      kind, name, purpose, tags, touches,
      proposedTables, proposedJobs, proposedEvents, proposedAuditActions, proposedRoutes, proposedEdgeFns,
      writesProductionAutonomously, hasAuditContract, hasStopCondition, hasEligibilityGate, rlsStatus, usesHasRole, hasHiddenState,
    ],
  );

  const canRun = name.length > 1 && purpose.length > 5;
  const runReview = () => setReview(reviewArchitecture(proposal));

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-fg-default">Architectural Continuity Guard <span className="text-base text-fg-muted font-normal">v1.1</span></h1>
        <p className="text-fg-muted mt-2 max-w-3xl">
          Pflichtcheck VOR neuen Tabellen, RPCs, Edge Functions, Queues oder Registries.
          Prinzipien: <strong>reuse vor rebuild · bridge vor duplicate · extend vor replace · consistency vor speed.</strong>
          {' '}Output ist immer ein Vorschlag — keine autonomen Production-Writes.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">10 Architekturprinzipien</CardTitle>
            <CardDescription>SSOT — gilt plattformweit.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {ARCHITECTURE_RULES.map((r) => (
              <div key={r.id} className="border-l-2 border-border-default pl-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-fg-muted">{r.id}</span>
                  <Badge variant={r.severity === 'hard' ? 'destructive' : 'secondary'} className="text-[10px]">
                    {r.severity}
                  </Badge>
                </div>
                <div className="text-sm font-medium text-fg-default">{r.name}</div>
                <div className="text-xs text-fg-muted mt-1">{r.description}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Vorhaben prüfen</CardTitle>
            <CardDescription>Beschreibe was gebaut werden soll — Guard sucht Reuse-/Bridge-Targets und erzeugt Evidence Chain.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Art</Label>
                <Select value={kind} onValueChange={(v) => setKind(v as ProposalKind)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {KIND_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Geplanter Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. v_new_metric" />
              </div>
            </div>
            <div>
              <Label>Zweck</Label>
              <Textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={3}
                placeholder="Was soll das Ding tun? Welches Problem löst es?" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Tags (komma-getrennt)</Label>
                <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="audit, heal, queue" />
              </div>
              <div>
                <Label>Berührt (komma-getrennt)</Label>
                <Input value={touches} onChange={(e) => setTouches(e.target.value)} placeholder="course_packages, job_queue" />
              </div>
            </div>

            {/* v1.1: Proposal-Inventar */}
            <details className="border border-border-default rounded-md p-3">
              <summary className="text-sm font-medium cursor-pointer text-fg-default">Proposal-Inventar (was wird konkret erzeugt?)</summary>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div><Label className="text-xs">proposed_tables</Label>
                  <Input value={proposedTables} onChange={(e) => setProposedTables(e.target.value)} placeholder="email_outbox, …" /></div>
                <div><Label className="text-xs">proposed_jobs</Label>
                  <Input value={proposedJobs} onChange={(e) => setProposedJobs(e.target.value)} placeholder="email_outbox_dispatch" /></div>
                <div><Label className="text-xs">proposed_events</Label>
                  <Input value={proposedEvents} onChange={(e) => setProposedEvents(e.target.value)} placeholder="my_funnel_step" /></div>
                <div><Label className="text-xs">proposed_audit_actions</Label>
                  <Input value={proposedAuditActions} onChange={(e) => setProposedAuditActions(e.target.value)} placeholder="campaign_started" /></div>
                <div><Label className="text-xs">proposed_routes</Label>
                  <Input value={proposedRoutes} onChange={(e) => setProposedRoutes(e.target.value)} placeholder="/admin/foo" /></div>
                <div><Label className="text-xs">proposed_edge_functions</Label>
                  <Input value={proposedEdgeFns} onChange={(e) => setProposedEdgeFns(e.target.value)} placeholder="my-new-fn" /></div>
              </div>
            </details>

            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border-default">
              <ToggleRow label="Schreibt autonom in Produktion" checked={writesProductionAutonomously} onChange={setWritesAutonomous} />
              <ToggleRow label="Audit-Contract registriert" checked={hasAuditContract} onChange={setHasAudit} />
              <ToggleRow label="Stop-Condition / WIP-Cap definiert" checked={hasStopCondition} onChange={setHasStop} />
              <ToggleRow label="Eligibility-Gate vorhanden" checked={hasEligibilityGate} onChange={setHasGate} />
              <ToggleRow label="has_role()-Gate" checked={usesHasRole} onChange={setHasRole} />
              <ToggleRow label="Hat verborgenen State" checked={hasHiddenState} onChange={setHidden} />
            </div>
            <div>
              <Label>RLS-Status</Label>
              <Select value={rlsStatus} onValueChange={(v) => setRls(v as typeof rlsStatus)}>
                <SelectTrigger className="w-60"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="on">aktiv</SelectItem>
                  <SelectItem value="not_applicable">nicht relevant</SelectItem>
                  <SelectItem value="off">aus</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button onClick={runReview} disabled={!canRun} className="flex-1">
                Architecture Review ausführen
              </Button>
              <CopyButton
                value={() => JSON.stringify(proposal, null, 2)}
                variant="button"
                label="Proposal als JSON"
                toastLabel="Proposal-JSON kopiert"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {review && <ReviewResult review={review} />}
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-fg-default">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function ReviewResult({ review }: { review: ArchitectureReview }) {
  const verdict = VERDICT_STYLE[review.verdict];
  const VerdictIcon = verdict.icon;

  const grouped = {
    blocked: review.findings.filter((f) => f.severity === 'block'),
    review_required: review.findings.filter((f) => f.severity === 'warn'),
    approved: review.findings.filter((f) => f.severity === 'info'),
  };

  const strategyText = [
    `# Architecture Review — ${review.proposal.kind} "${review.proposal.name}"`,
    `Verdict: ${review.verdict}`,
    '',
    '## Recommended Implementation Strategy',
    ...review.migration_strategy.map((s) => `- ${s}`),
    '',
    '## Reuse Candidates',
    ...review.reuse_candidates.map((r) => `- ${r.name} (${r.kind}): ${r.extensionHint ?? r.purpose}`),
  ].join('\n');

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base">Architecture Review</CardTitle>
          <div className="flex items-center gap-2">
            <CopyButton
              value={strategyText}
              variant="chip"
              label="Strategy"
              toastLabel="Strategy kopiert"
              title="Recommended Implementation Strategy kopieren"
            />
            <div className={`flex items-center gap-2 px-3 py-1 rounded-md text-sm font-medium ${verdict.tone}`}>
              <VerdictIcon className="h-4 w-4" /> {verdict.label}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <Section title={`Reuse-Kandidaten (${review.reuse_candidates.length})`}>
          {review.reuse_candidates.length === 0 ? (
            <p className="text-sm text-fg-muted">Keine ähnlichen Systeme erkannt.</p>
          ) : (
            <ul className="space-y-2">
              {review.reuse_candidates.map((c) => (
                <li key={c.name} className="text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{c.kind}</Badge>
                    <span className="font-mono">{c.name}</span>
                    <CopyButton value={c.name} toastLabel={`${c.name} kopiert`} />
                  </div>
                  <div className="text-fg-muted text-xs mt-0.5">{c.purpose}</div>
                  {c.extensionHint && (
                    <div className="text-fg-default text-xs mt-1">→ {c.extensionHint}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {review.bridge_targets.length >= 2 && (
          <Section title={`Bridge-Targets (${review.bridge_targets.length})`}>
            <p className="text-xs text-fg-muted mb-2">
              Bevorzuge View/Trigger/Adapter zwischen diesen Systemen statt Fork:
            </p>
            <div className="flex flex-wrap gap-2">
              {review.bridge_targets.map((b) => (
                <Badge key={b.name} variant="secondary" className="font-mono">{b.name}</Badge>
              ))}
            </div>
          </Section>
        )}

        {grouped.blocked.length > 0 && (
          <FindingGroup title={`Blocked (${grouped.blocked.length})`} items={grouped.blocked} />
        )}
        {grouped.review_required.length > 0 && (
          <FindingGroup title={`Review Required (${grouped.review_required.length})`} items={grouped.review_required} />
        )}
        {grouped.approved.length > 0 && (
          <FindingGroup title={`Info (${grouped.approved.length})`} items={grouped.approved} />
        )}
        {review.findings.length === 0 && (
          <p className="text-sm text-fg-muted">Keine Verstöße erkannt.</p>
        )}

        {review.recommended_extension_points.length > 0 && (
          <Section title="Empfohlene Erweiterungspunkte">
            <ul className="list-disc list-inside text-sm space-y-1 text-fg-default">
              {review.recommended_extension_points.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          </Section>
        )}

        {review.migration_strategy.length > 0 && (
          <Section title="Migrationsstrategie (verdichtet)">
            <ol className="list-decimal list-inside text-sm space-y-1 text-fg-default">
              {review.migration_strategy.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </Section>
        )}
      </CardContent>
    </Card>
  );
}

function FindingGroup({ title, items }: { title: string; items: RuleFinding[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-fg-default mb-2">{title}</h3>
      <ul className="space-y-3">
        {items.map((f, i) => {
          const Icon = SEVERITY_ICON[f.severity];
          return (
            <li key={i} className="border border-border-default rounded-md p-3 space-y-1.5">
              <div className="flex items-start gap-2">
                <Icon className={`h-4 w-4 mt-0.5 ${SEVERITY_TONE[f.severity]}`} />
                <div className="flex-1">
                  <div className="font-mono text-xs text-fg-muted">{f.rule} · {f.severity}</div>
                  <div className="text-fg-default text-sm">{f.message}</div>
                </div>
              </div>
              {f.evidence && (
                <div className="text-xs text-fg-muted pl-6">
                  <span className="font-semibold">Evidence:</span> {f.evidence}
                </div>
              )}
              {f.matched_known_systems.length > 0 && (
                <div className="flex flex-wrap gap-1 pl-6">
                  {f.matched_known_systems.map((s) => (
                    <Badge key={s.name} variant="outline" className="text-[10px] font-mono">{s.name}</Badge>
                  ))}
                </div>
              )}
              {f.recommended_reuse_path && (
                <div className="text-xs text-fg-default pl-6 flex items-start gap-1">
                  <span>→ <span className="font-semibold">Reuse:</span> {f.recommended_reuse_path}</span>
                  <CopyButton value={f.recommended_reuse_path} toastLabel="Reuse-Path kopiert" />
                </div>
              )}
              {f.required_bridge_target && (
                <div className="text-xs text-fg-default pl-6">
                  <span className="font-semibold">Bridge-Target:</span>{' '}
                  <span className="font-mono">{f.required_bridge_target}</span>
                </div>
              )}
              {f.migration_strategy && f.migration_strategy.length > 0 && (
                <ol className="text-xs text-fg-muted pl-10 list-decimal space-y-0.5">
                  {f.migration_strategy.map((s, j) => <li key={j}>{s}</li>)}
                </ol>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-fg-default mb-2">{title}</h3>
      {children}
    </div>
  );
}
