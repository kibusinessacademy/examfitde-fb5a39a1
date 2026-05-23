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
  type CollectorSourceRow,
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
