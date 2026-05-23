import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ARCHITECTURE_RULES,
  reviewArchitecture,
  type ArchitectureProposal,
  type ProposalKind,
  type ArchitectureReview,
} from '@/lib/governance/architecture-review';
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

const SEVERITY_ICON = {
  block: Ban,
  warn: AlertTriangle,
  info: Info,
} as const;

const SEVERITY_TONE = {
  block: 'text-status-fg-danger',
  warn: 'text-status-fg-warning',
  info: 'text-fg-muted',
} as const;

export default function ArchitecturePage() {
  const [kind, setKind] = useState<ProposalKind>('table');
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [tags, setTags] = useState('');
  const [touches, setTouches] = useState('');
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
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      touches: touches.split(',').map((t) => t.trim()).filter(Boolean),
      writesProductionAutonomously,
      hasAuditContract,
      hasStopCondition,
      hasEligibilityGate,
      rlsStatus,
      usesHasRole,
      hasHiddenState,
    }),
    [kind, name, purpose, tags, touches, writesProductionAutonomously, hasAuditContract, hasStopCondition, hasEligibilityGate, rlsStatus, usesHasRole, hasHiddenState],
  );

  const canRun = name.length > 1 && purpose.length > 5;

  const runReview = () => setReview(reviewArchitecture(proposal));

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-fg-default">Architectural Continuity Guard</h1>
        <p className="text-fg-muted mt-2 max-w-3xl">
          Pflichtcheck VOR neuen Tabellen, RPCs, Edge Functions, Queues oder Registries.
          Prinzipien: <strong>reuse vor rebuild · bridge vor duplicate · extend vor replace · consistency vor speed.</strong>
          {' '}Output ist immer ein Vorschlag — keine autonomen Production-Writes.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Rules-SSOT ──────────────────────────── */}
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

        {/* ── Proposal-Form ───────────────────────── */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Vorhaben prüfen</CardTitle>
            <CardDescription>Beschreibe, was du bauen willst — der Guard sucht Reuse-/Bridge-Targets.</CardDescription>
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
            <Button onClick={runReview} disabled={!canRun} className="w-full">
              Architecture Review ausführen
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ── Review-Output ─────────────────────────── */}
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
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base">Architecture Review</CardTitle>
          <div className={`flex items-center gap-2 px-3 py-1 rounded-md text-sm font-medium ${verdict.tone}`}>
            <VerdictIcon className="h-4 w-4" /> {verdict.label}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <Section title={`Reuse-Kandidaten (${review.reuse_candidates.length})`}>
          {review.reuse_candidates.length === 0 ? (
            <p className="text-sm text-fg-muted">Keine ähnlichen Systeme erkannt — Vorhaben darf wahrscheinlich neu entstehen.</p>
          ) : (
            <ul className="space-y-2">
              {review.reuse_candidates.map((c) => (
                <li key={c.name} className="text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{c.kind}</Badge>
                    <span className="font-mono">{c.name}</span>
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

        <Section title={`Findings (${review.findings.length})`}>
          {review.findings.length === 0 ? (
            <p className="text-sm text-fg-muted">Keine Verstöße erkannt.</p>
          ) : (
            <ul className="space-y-2">
              {review.findings.map((f, i) => {
                const Icon = SEVERITY_ICON[f.severity];
                return (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Icon className={`h-4 w-4 mt-0.5 ${SEVERITY_TONE[f.severity]}`} />
                    <div>
                      <div className="font-mono text-xs text-fg-muted">{f.rule} · {f.severity}</div>
                      <div className="text-fg-default">{f.message}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        {review.recommended_extension_points.length > 0 && (
          <Section title="Empfohlene Erweiterungspunkte">
            <ul className="list-disc list-inside text-sm space-y-1 text-fg-default">
              {review.recommended_extension_points.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          </Section>
        )}

        {review.migration_strategy.length > 0 && (
          <Section title="Migrationsstrategie">
            <ol className="list-decimal list-inside text-sm space-y-1 text-fg-default">
              {review.migration_strategy.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </Section>
        )}
      </CardContent>
    </Card>
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
