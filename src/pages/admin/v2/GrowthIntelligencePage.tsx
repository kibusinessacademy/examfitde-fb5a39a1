import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGilOverview,
  useGilBriefings,
  useGilSignals,
  useGilCompetitors,
  useGilInsights,
  useTriggerExecutiveBriefing,
} from '@/features/gil/useGrowthIntelligence';
import { GIL_AGENT_CONTRACTS, GIL_AGENT_KINDS } from '@/lib/gil/contracts';
import { createManualMarketSignal } from '@/lib/governance/p18-gil-bridge.client';
import CollectorIntakeTab from '@/features/gil/CollectorIntakeTab';


function severityVariant(s: string): 'default' | 'secondary' | 'destructive' {
  if (s === 'critical') return 'destructive';
  if (s === 'warning') return 'secondary';
  return 'default';
}

export default function GrowthIntelligencePage() {
  const [tab, setTab] = useState('briefing');
  const [reason, setReason] = useState('');
  const overview = useGilOverview();
  const briefings = useGilBriefings(5);
  const signals = useGilSignals(50);
  const competitors = useGilCompetitors();
  const insightsAll = useGilInsights(undefined, 30);
  const trigger = useTriggerExecutiveBriefing();

  const handleTrigger = async (dryRun: boolean) => {
    if (reason.trim().length < 8) {
      toast.error('Reason muss ≥ 8 Zeichen haben.');
      return;
    }
    try {
      const res = await trigger.mutateAsync({ reason, dryRun });
      toast.success(dryRun ? 'Dry-Run abgeschlossen' : `Briefing erstellt: ${res?.headline ?? 'ok'}`);
      setReason('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Fehler beim Briefing');
    }
  };

  return (
    <div className="container mx-auto p-4 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Growth Intelligence</h1>
          <p className="text-sm text-muted-foreground">
            P19 — 6 Agenten, ein Wissenskorpus, ein Executive-Briefing. Bounded healing — keine autonome Mutation.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <KpiPill label="Wettbewerber aktiv" value={overview.data?.competitors_total} />
          <KpiPill label="Signals 24h" value={overview.data?.signals_24h} />
          <KpiPill label="Critical offen" value={overview.data?.signals_critical_open} tone="destructive" />
          <KpiPill label="Insights offen" value={overview.data?.insights_open} />
          <KpiPill label="Briefings" value={overview.data?.briefings_total} />
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1 rounded-xl">
          <TabsTrigger value="briefing">Executive Briefing</TabsTrigger>
          <TabsTrigger value="signals">Signal-Feed</TabsTrigger>
          <TabsTrigger value="intake">Collector Intake</TabsTrigger>
          <TabsTrigger value="competitors">Competitor-Radar</TabsTrigger>
          <TabsTrigger value="agents">Agenten-Übersicht</TabsTrigger>
        </TabsList>

        {/* Executive Briefing */}
        <TabsContent value="briefing" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Neues Executive-Briefing anstoßen</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                placeholder={'Reason (≥ 8 Zeichen) — z.B. „Quartals-Briefing für Vertriebs-Sync".'}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
              />
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="outline"
                  disabled={trigger.isPending}
                  onClick={() => handleTrigger(true)}
                >
                  Dry-Run (kein Schreibvorgang)
                </Button>
                <Button disabled={trigger.isPending} onClick={() => handleTrigger(false)}>
                  Briefing erstellen
                </Button>
              </div>
            </CardContent>
          </Card>

          {briefings.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : briefings.data && briefings.data.length > 0 ? (
            briefings.data.map((b: any) => (
              <Card key={b.id}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">{b.headline}</CardTitle>
                    <span className="text-xs text-muted-foreground">
                      {new Date(b.created_at).toLocaleString()}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {b.narrative && <p className="text-sm whitespace-pre-wrap">{b.narrative}</p>}
                  <BriefingList title="Chancen" items={b.opportunities} />
                  <BriefingList title="Risiken" items={b.risks} />
                  <BriefingList title="Empfehlungen" items={b.recommendations} />
                  <p className="text-xs text-muted-foreground">
                    Modell: {b.model ?? 'n/a'} · Quellen-Insights: {Array.isArray(b.source_insight_ids) ? b.source_insight_ids.length : 0}
                  </p>
                </CardContent>
              </Card>
            ))
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Noch keine Briefings. Reason eingeben und „Briefing erstellen“ klicken.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Signal-Feed */}
        <TabsContent value="signals" className="space-y-3">
          <ManualSignalForm />
          {signals.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : signals.data && signals.data.length > 0 ? (
            <div className="space-y-2">
              {signals.data.map((s: any) => {
                const isP18 = s.source === 'p18' && s.signal_type === 'internal_drift';
                const driftType = s.payload?.drift_type as string | undefined;
                const idemKey = s.payload?.idempotency_key as string | undefined;
                return (
                  <Card key={s.id}>
                    <CardContent className="py-3 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={severityVariant(s.severity)}>{s.severity}</Badge>
                        <Badge variant="outline">{s.signal_type}</Badge>
                        <Badge variant="outline">{s.source}</Badge>
                        {isP18 && (
                          <Badge className="bg-status-bg-subtle-info text-status-fg-info">
                            P18 Drift{driftType ? ` · ${driftType}` : ''}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground ml-auto">
                          {new Date(s.observed_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm font-medium">{s.title}</p>
                      {s.summary && <p className="text-sm text-muted-foreground">{s.summary}</p>}
                      {isP18 && idemKey && (
                        <p className="text-[10px] font-mono text-muted-foreground truncate" title={idemKey}>
                          ledger: {idemKey}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Noch keine Signale. Manuell anlegen oder via P18-Forensik als GIL-Signal übernehmen.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Collector Intake (P20 Cut 1) */}
        <TabsContent value="intake" className="space-y-3">
          <CollectorIntakeTab />
        </TabsContent>

        {/* Competitor-Radar */}
        <TabsContent value="competitors" className="space-y-2">
          {competitors.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : competitors.data && competitors.data.length > 0 ? (
            <div className="grid gap-2 md:grid-cols-2">
              {competitors.data.map((c: any) => (
                <Card key={c.id}>
                  <CardContent className="py-3 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{c.name}</p>
                      <Badge variant="outline">P{c.priority}</Badge>
                    </div>
                    {c.domain && (
                      <p className="text-xs text-muted-foreground break-all">{c.domain}</p>
                    )}
                    {c.category && <Badge variant="secondary">{c.category}</Badge>}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Noch keine Wettbewerber registriert.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Agenten-Übersicht */}
        <TabsContent value="agents" className="space-y-2">
          <div className="grid gap-2 md:grid-cols-2">
            {GIL_AGENT_KINDS.map((kind) => {
              const c = GIL_AGENT_CONTRACTS[kind];
              const count = overview.data?.insights_by_agent?.[kind] ?? 0;
              return (
                <Card key={kind}>
                  <CardHeader>
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-base">{c.label}</CardTitle>
                      <Badge variant="outline">{count} insights · 7d</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-sm text-muted-foreground">{c.mission}</p>
                    <div className="flex flex-wrap gap-1">
                      {c.allowedInsightTypes.map((t) => (
                        <Badge key={t} variant="secondary" className="text-[10px]">
                          {t}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Layers: {c.growthLayers.join(', ')} · Briefings:{' '}
                      {c.canProduceBriefings ? 'ja' : 'nein'}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {insightsAll.data && insightsAll.data.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Letzte Agent-Insights</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {insightsAll.data.slice(0, 10).map((i: any) => (
                  <div key={i.id} className="flex items-center gap-2 flex-wrap text-sm">
                    <Badge variant={severityVariant(i.severity)}>{i.severity}</Badge>
                    <Badge variant="outline">{i.agent_kind}</Badge>
                    <span className="font-medium">{i.title}</span>
                    {typeof i.score === 'number' && (
                      <Badge variant="secondary">score {i.score}</Badge>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto">
                      {new Date(i.created_at).toLocaleString()}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KpiPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | undefined;
  tone?: 'destructive';
}) {
  return (
    <div className="flex flex-col items-end rounded-lg border px-3 py-1.5 bg-card">
      <span className="text-[10px] uppercase text-muted-foreground tracking-wider">{label}</span>
      <span
        className={`text-lg font-semibold tabular-nums ${
          tone === 'destructive' && (value ?? 0) > 0 ? 'text-destructive' : ''
        }`}
      >
        {value ?? '—'}
      </span>
    </div>
  );
}

function BriefingList({ title, items }: { title: string; items: any }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
        {title}
      </p>
      <ul className="space-y-1">
        {items.map((it: any, idx: number) => (
          <li key={idx} className="text-sm flex items-start gap-2">
            {typeof it.priority === 'number' && (
              <Badge variant="outline" className="text-[10px] mt-0.5">
                P{it.priority}
              </Badge>
            )}
            {it.severity && (
              <Badge variant={severityVariant(it.severity)} className="text-[10px] mt-0.5">
                {it.severity}
              </Badge>
            )}
            <span>
              <span className="font-medium">{it.title}</span>
              {it.rationale && <span className="text-muted-foreground"> — {it.rationale}</span>}
              {it.action && <span className="text-muted-foreground"> — {it.action}</span>}
              {it.impact_estimate && (
                <span className="text-xs text-muted-foreground"> ({it.impact_estimate})</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ManualSignalForm() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [signalType, setSignalType] = useState('manual_observation');
  const [severity, setSeverity] = useState<'info' | 'warning' | 'critical'>('info');
  const [source, setSource] = useState('manual');
  const [tags, setTags] = useState('');
  const [reason, setReason] = useState('');

  const submit = async () => {
    if (reason.trim().length < 8) {
      toast.error('Reason muss ≥ 8 Zeichen haben.');
      return;
    }
    setBusy(true);
    try {
      const tagList = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      await createManualMarketSignal({
        title,
        summary,
        signal_type: signalType,
        severity,
        source,
        tags: tagList,
        reason,
      });
      toast.success('Signal angelegt');
      setTitle('');
      setSummary('');
      setReason('');
      setTags('');
      qc.invalidateQueries({ queryKey: ['gil'] });
      setOpen(false);
    } catch (e) {
      toast.error('Fehler beim Anlegen', { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Card>
        <CardContent className="py-3 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Signal manuell anlegen (kein Auto-Collector — Reason ≥ 8 Zeichen Pflicht).
          </p>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Manuelles Signal
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Manuelles Signal anlegen</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Titel</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Kurztitel" />
          </div>
          <div>
            <Label className="text-xs">Quelle</Label>
            <Input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="manual / press / partner …"
            />
          </div>
          <div>
            <Label className="text-xs">Signal-Type</Label>
            <Input
              value={signalType}
              onChange={(e) => setSignalType(e.target.value)}
              placeholder="manual_observation"
            />
          </div>
          <div>
            <Label className="text-xs">Severity</Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as 'info' | 'warning' | 'critical')}
            >
              <option value="info">info</option>
              <option value="warning">warning</option>
              <option value="critical">critical</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Tags (Komma-getrennt)</Label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="z. B. b2b, partnership" />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Summary (optional)</Label>
            <Textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Reason (≥ 8 Zeichen, Pflicht)</Label>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Abbrechen
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || reason.trim().length < 8 || title.trim().length < 3}>
            {busy ? '…' : 'Signal anlegen'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

