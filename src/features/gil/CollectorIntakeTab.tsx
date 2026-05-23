import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import {
  listCollectorSources,
  listIntake,
  submitCollectorBatch,
  decideIntake,
  parsePasteToRawItems,
  listRssFeeds,
  addRssFeed,
  setRssFeedEnabled,
  runGilRssCollector,
  type CollectorSourceRow,
  type RssFeedRow,
  type RssCollectorRunSummary,
} from '@/lib/gil/collectors/client';


function severityVariant(s: string): 'default' | 'secondary' | 'destructive' {
  if (s === 'critical') return 'destructive';
  if (s === 'warning') return 'secondary';
  return 'default';
}

export default function CollectorIntakeTab() {
  const qc = useQueryClient();
  const sourcesQ = useQuery({
    queryKey: ['gil', 'collector-sources'],
    queryFn: listCollectorSources,
  });
  const intakeQ = useQuery({
    queryKey: ['gil', 'intake', 'pending'],
    queryFn: () => listIntake('pending', 50),
  });

  const enabledSources = (sourcesQ.data ?? []).filter((s) => s.enabled);
  const [sourceKey, setSourceKey] = useState<string>('');
  useEffect(() => {
    if (!sourceKey && enabledSources[0]) setSourceKey(enabledSources[0].source_key);
  }, [enabledSources, sourceKey]);

  const [paste, setPaste] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const previewItems = parsePasteToRawItems(paste);
  const activeSource = enabledSources.find((s) => s.source_key === sourceKey);

  const handleSubmit = async () => {
    if (!activeSource) {
      toast.error('Quelle wählen');
      return;
    }
    if (reason.trim().length < 8) {
      toast.error('Reason muss ≥ 8 Zeichen haben.');
      return;
    }
    if (previewItems.length === 0) {
      toast.error('Keine Items im Paste-Feld.');
      return;
    }
    setBusy(true);
    try {
      const r = await submitCollectorBatch(sourceKey, previewItems, reason);
      toast.success(
        `Eingereicht: ${r.submitted} · Duplicates: ${r.duplicates + (r.client_duplicates_in_batch ?? 0)} · Rejected: ${r.rejected + (r.client_rejected?.length ?? 0)}`,
      );
      setPaste('');
      setReason('');
      qc.invalidateQueries({ queryKey: ['gil', 'intake'] });
    } catch (e) {
      toast.error('Fehler beim Einreichen', { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <RssCollectorCard />
      <Card>
        <CardHeader>

          <CardTitle className="text-base">Signal-Collector — Paste-Import (Review-First)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">Quelle</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {sourcesQ.isLoading && <Skeleton className="h-7 w-40" />}
              {enabledSources.map((s) => (
                <Button
                  key={s.source_key}
                  variant={s.source_key === sourceKey ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSourceKey(s.source_key)}
                >
                  {s.label}
                </Button>
              ))}
            </div>
            {activeSource && <SourceMeta source={activeSource} />}
          </div>

          <div>
            <Label className="text-xs">
              Paste — eine Beobachtung pro Zeile (Format: <code>Title</code> oder{' '}
              <code>Title | https://url | summary</code> oder JSON-Objekt). Kommentare
              beginnen mit <code>#</code>.
            </Label>
            <Textarea
              rows={6}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={'StudyFlix senkt Preis auf 19€ | https://example.com/news\nNeues Feature bei Wettbewerber X | https://x.io | Live-Quizze'}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Erkannt: {previewItems.length} Item(s) · Limit: 100/Batch
            </p>
          </div>

          <div>
            <Label className="text-xs">Reason (≥ 8 Zeichen, Pflicht)</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={'z.B. "Wettbewerbsbeobachtung KW21"'}
            />

          </div>

          <div className="flex justify-end">
            <Button disabled={busy || previewItems.length === 0} onClick={handleSubmit}>
              {busy ? 'Wird eingereicht…' : `Einreichen (${previewItems.length})`}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Pending Review {intakeQ.data ? `· ${intakeQ.data.length}` : ''}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {intakeQ.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : intakeQ.data && intakeQ.data.length > 0 ? (
            intakeQ.data.map((row) => (
              <PendingRow
                key={row.id}
                row={row}
                onDecided={() => qc.invalidateQueries({ queryKey: ['gil'] })}
              />
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              Keine Einträge in Review. Paste-Import oben erstellt neue Einträge.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SourceMeta({ source }: { source: CollectorSourceRow }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <Badge variant="outline">{source.kind}</Badge>
      <Badge variant="outline">default: {source.default_severity}</Badge>
      <span>signal_types:</span>
      {source.allowed_signal_types.map((t) => (
        <Badge key={t} variant="secondary" className="text-[10px]">
          {t}
        </Badge>
      ))}
      {source.notes && <span className="italic">· {source.notes}</span>}
    </div>
  );
}

function PendingRow({
  row,
  onDecided,
}: {
  row: import('@/lib/gil/collectors/client').IntakeRow;
  onDecided: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const decide = async (decision: 'approve' | 'reject') => {
    if (reason.trim().length < 8) {
      toast.error('Reason ≥ 8 Zeichen erforderlich');
      return;
    }
    setBusy(true);
    try {
      const r = await decideIntake(row.id, decision, reason);
      toast.success(
        decision === 'approve'
          ? `Approved → Signal ${r.signal_id?.slice(0, 8)}…`
          : 'Rejected',
      );
      setReason('');
      onDecided();
    } catch (e) {
      toast.error('Fehler', { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={severityVariant(row.severity)}>{row.severity}</Badge>
        <Badge variant="outline">{row.signal_type}</Badge>
        <Badge variant="outline">{row.source_key}</Badge>
        <span className="text-xs text-muted-foreground ml-auto">
          {new Date(row.created_at).toLocaleString()}
        </span>
      </div>
      <p className="text-sm font-medium">{row.title}</p>
      {row.summary && <p className="text-sm text-muted-foreground">{row.summary}</p>}
      {row.url && (
        <a
          href={row.url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-primary underline break-all"
        >
          {row.url}
        </a>
      )}
      <p className="text-[10px] text-muted-foreground font-mono">
        fingerprint: {row.fingerprint}
      </p>
      <div className="flex flex-wrap gap-2 items-center">
        <Input
          className="flex-1 min-w-[200px]"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (≥ 8 Zeichen) für Approve/Reject"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => decide('reject')}
        >
          Reject
        </Button>
        <Button size="sm" disabled={busy} onClick={() => decide('approve')}>
          Approve → Signal
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// P20 Cut 2 — RSS Collector card
// ---------------------------------------------------------------------------

function RssCollectorCard() {
  const qc = useQueryClient();
  const feedsQ = useQuery({ queryKey: ['gil', 'rss-feeds'], queryFn: listRssFeeds });

  const [reason, setReason] = useState('');
  const [busyFeedId, setBusyFeedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<RssCollectorRunSummary | null>(null);

  // Add-feed inline form
  const [showAdd, setShowAdd] = useState(false);
  const [feedUrl, setFeedUrl] = useState('');
  const [feedLabel, setFeedLabel] = useState('');
  const [feedCategory, setFeedCategory] = useState('');
  const [feedSignalType, setFeedSignalType] = useState('press_mention');
  const [feedTags, setFeedTags] = useState('');
  const [adding, setAdding] = useState(false);

  const handleRun = async (feedId?: string) => {
    if (reason.trim().length < 8) {
      toast.error('Reason muss ≥ 8 Zeichen haben.');
      return;
    }
    setRunning(true);
    if (feedId) setBusyFeedId(feedId);
    try {
      const summary = await runGilRssCollector(reason, feedId);
      setLastRun(summary);
      toast.success(
        `RSS-Run · scanned ${summary.scanned_sources} · inserted ${summary.inserted} · dup ${summary.skipped_duplicate} · failed ${summary.failed_sources}`,
      );
      qc.invalidateQueries({ queryKey: ['gil', 'rss-feeds'] });
      qc.invalidateQueries({ queryKey: ['gil', 'intake'] });
    } catch (e) {
      toast.error('RSS-Collector fehlgeschlagen', { description: (e as Error).message });
    } finally {
      setRunning(false);
      setBusyFeedId(null);
    }
  };

  const handleToggle = async (row: RssFeedRow) => {
    if (reason.trim().length < 8) {
      toast.error('Reason muss ≥ 8 Zeichen haben.');
      return;
    }
    setBusyFeedId(row.id);
    try {
      await setRssFeedEnabled(row.id, !row.enabled, reason);
      toast.success(row.enabled ? 'Feed deaktiviert' : 'Feed aktiviert');
      qc.invalidateQueries({ queryKey: ['gil', 'rss-feeds'] });
    } catch (e) {
      toast.error('Toggle fehlgeschlagen', { description: (e as Error).message });
    } finally {
      setBusyFeedId(null);
    }
  };

  const handleAdd = async () => {
    if (reason.trim().length < 8) {
      toast.error('Reason muss ≥ 8 Zeichen haben.');
      return;
    }
    if (!/^https?:\/\//i.test(feedUrl.trim())) {
      toast.error('Feed-URL muss http(s) sein.');
      return;
    }
    if (feedLabel.trim().length < 2) {
      toast.error('Label ≥ 2 Zeichen.');
      return;
    }
    setAdding(true);
    try {
      const tags = feedTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      await addRssFeed(
        {
          feed_url: feedUrl.trim(),
          label: feedLabel.trim(),
          category: feedCategory.trim() || undefined,
          default_signal_type: feedSignalType,
          tags,
        },
        reason,
      );
      toast.success('Feed angelegt');
      setFeedUrl('');
      setFeedLabel('');
      setFeedCategory('');
      setFeedTags('');
      setShowAdd(false);
      qc.invalidateQueries({ queryKey: ['gil', 'rss-feeds'] });
    } catch (e) {
      toast.error('Anlegen fehlgeschlagen', { description: (e as Error).message });
    } finally {
      setAdding(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">RSS / Atom Collector — review-first</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label className="text-xs">Reason (≥ 8 Zeichen, Pflicht für jeden Run / Feed-Toggle / Neuanlage)</Label>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder='z.B. "RSS-Sweep KW21"'
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={running || (feedsQ.data?.filter((f) => f.enabled).length ?? 0) === 0}
            onClick={() => handleRun()}
          >
            {running && !busyFeedId ? 'Läuft…' : 'RSS Collector starten (alle aktiven Feeds)'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)}>
            {showAdd ? 'Schließen' : 'Feed anlegen'}
          </Button>
        </div>

        {showAdd && (
          <div className="rounded-md border p-3 space-y-2 bg-muted/30">
            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <Label className="text-xs">Feed-URL (http/https, kein localhost/private IP)</Label>
                <Input value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} placeholder="https://example.com/feed.xml" />
              </div>
              <div>
                <Label className="text-xs">Label</Label>
                <Input value={feedLabel} onChange={(e) => setFeedLabel(e.target.value)} placeholder="z.B. Heise Bildung" />
              </div>
              <div>
                <Label className="text-xs">Category (optional)</Label>
                <Input value={feedCategory} onChange={(e) => setFeedCategory(e.target.value)} placeholder="z.B. edutech" />
              </div>
              <div>
                <Label className="text-xs">Default signal_type</Label>
                <select
                  className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                  value={feedSignalType}
                  onChange={(e) => setFeedSignalType(e.target.value)}
                >
                  <option value="press_mention">press_mention</option>
                  <option value="competitor_release">competitor_release</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">Tags (komma-separiert)</Label>
                <Input value={feedTags} onChange={(e) => setFeedTags(e.target.value)} placeholder="b2b, edtech" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="sm" disabled={adding} onClick={handleAdd}>
                {adding ? 'Speichern…' : 'Feed speichern'}
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {feedsQ.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : (feedsQ.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">
              Noch keine RSS-Feeds. Über „Feed anlegen" hinzufügen.
            </p>
          ) : (
            (feedsQ.data ?? []).map((row) => (
              <div key={row.id} className="rounded-md border p-3 text-sm space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={row.enabled ? 'default' : 'secondary'}>
                    {row.enabled ? 'enabled' : 'disabled'}
                  </Badge>
                  <Badge variant="outline">{row.default_signal_type}</Badge>
                  <Badge variant="outline">{row.default_severity}</Badge>
                  {row.category && <Badge variant="secondary">{row.category}</Badge>}
                  <span className="font-medium">{row.label}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {row.last_run_at ? `last: ${new Date(row.last_run_at).toLocaleString()}` : 'nie gelaufen'}
                  </span>
                </div>
                <a
                  href={row.feed_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary underline break-all"
                >
                  {row.feed_url}
                </a>
                {row.last_run_result && (
                  <pre className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 overflow-auto">
                    {JSON.stringify(row.last_run_result, null, 2)}
                  </pre>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!row.enabled || running}
                    onClick={() => handleRun(row.id)}
                  >
                    {busyFeedId === row.id && running ? 'Läuft…' : 'Nur diesen Feed laufen lassen'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyFeedId === row.id}
                    onClick={() => handleToggle(row)}
                  >
                    {row.enabled ? 'Deaktivieren' : 'Aktivieren'}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        {lastRun && (
          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <p className="font-medium mb-1">Letzter Run</p>
            <p>
              scanned: <strong>{lastRun.scanned_sources}</strong> · fetched:{' '}
              <strong>{lastRun.fetched_items}</strong> · inserted (pending):{' '}
              <strong>{lastRun.inserted}</strong> · duplicates:{' '}
              <strong>{lastRun.skipped_duplicate}</strong> · failed:{' '}
              <strong>{lastRun.failed_sources}</strong>
            </p>
            {lastRun.per_feed.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {lastRun.per_feed.map((f) => (
                  <li key={f.feed_id} className="font-mono">
                    {f.label}: fetched {f.fetched}, inserted {f.inserted}, dup {f.duplicates}
                    {f.error ? ` · error: ${f.error}` : ''}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-muted-foreground">
              Alle neuen Items landen <strong>pending</strong> in „Pending Review" — Promotion nach{' '}
              <code>gil_market_signals</code> nur via manuellem Approve.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

