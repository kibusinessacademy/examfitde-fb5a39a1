/**
 * P18 Bounded Heal Panel — UI für Cut 2 + Cut 3.
 *
 * - Listet aktuelle Drift-Signale (aus Cut 1 runP18Cut1)
 * - zeigt für jeden Drift die deterministisch erlaubten Aktionen
 * - bietet "Record Detection" → schreibt ins p18_idempotency_ledger
 * - bietet "Request Heal" pro allowed action (Reason-Pflicht ≥ 8 Zeichen)
 * - zeigt Ledger-History (read-only via admin_get_p18_ledger)
 *
 * Kein Bulk-Heal. Kein Direkteditieren. Keine unbekannte Aktion.
 */

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CopyButton } from '@/components/admin/shared/CopyButton';
import { toast } from 'sonner';
import { runP18Cut1, type DriftSignal } from '@/lib/governance/p18-orchestrator';
import {
  deriveAllowedHealActions,
  buildKnownSystemSuggestion,
  type HealAction,
} from '@/lib/governance/p18-heal-policy';
import {
  listP18Ledger,
  recordP18Detection,
  requestP18Heal,
  type LedgerRow,
} from '@/lib/governance/p18-heal-executor.functions';
import { bridgeP18DriftToGil } from '@/lib/governance/p18-gil-bridge.client';



const SEV_TONE: Record<DriftSignal['severity'], string> = {
  block: 'bg-status-bg-subtle-danger text-status-fg-danger',
  warn: 'bg-status-bg-subtle-warning text-status-fg-warning',
  info: 'bg-status-bg-subtle-info text-status-fg-info',
};

const STATUS_TONE: Record<LedgerRow['status'], string> = {
  detected: 'bg-status-bg-subtle-info text-status-fg-info',
  escalated: 'bg-status-bg-subtle-danger text-status-fg-danger',
  heal_requested: 'bg-status-bg-subtle-warning text-status-fg-warning',
  healed: 'bg-status-bg-subtle-success text-status-fg-success',
  rejected: 'bg-status-bg-subtle-danger text-status-fg-danger',
  suppressed: 'bg-muted text-fg-muted',
};

export default function P18BoundedHealPanel() {
  const result = useMemo(() => runP18Cut1({ knownSystemsChange: {}, now: new Date() }), []);
  const signals = result.signals;

  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterDrift, setFilterDrift] = useState<string>('all');

  async function refreshLedger() {
    setLoading(true);
    try {
      const rows = await listP18Ledger({
        limit: 100,
        status: filterStatus === 'all' ? null : (filterStatus as LedgerRow['status']),
        drift_type: filterDrift === 'all' ? null : filterDrift,
      });
      setLedger(rows);
    } catch (e) {
      toast.error('Ledger laden fehlgeschlagen', { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshLedger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, filterDrift]);

  const ledgerByKey = useMemo(() => {
    const m = new Map<string, LedgerRow>();
    for (const r of ledger) m.set(r.idempotency_key, r);
    return m;
  }, [ledger]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="text-base">P18 Cut 2/3 — Bounded Heal</CardTitle>
          <CardDescription>
            <strong className="text-fg-default">Whitelist: 3 Aktionen.</strong> Kein
            Auto-Heal. Kein Bulk. Jede Aktion idempotent + auditiert.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <Label className="text-xs">Erlaubte Heal-Aktionen</Label>
            <ul className="mt-1 space-y-1 text-xs">
              <li><code>SUGGEST_KNOWN_SYSTEM_ENTRY</code> — Vorschlag, kein Write</li>
              <li><code>EMIT_GOVERNANCE_AUDIT</code> — bounded Audit-Eintrag</li>
              <li><code>TRIGGER_QUALITY_GATE_RERUN</code> — nur bei quality_gate_relevant</li>
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Filter Status</Label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle</SelectItem>
                  {(['detected','escalated','heal_requested','healed','rejected','suppressed'] as const).map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Filter Drift</Label>
              <Select value={filterDrift} onValueChange={setFilterDrift}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle</SelectItem>
                  {['ssot_conflict','healability_missing','cross_domain_unbridged','orphan_node','rule_violation','reuse_recommendation','duplicate_registration'].map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={refreshLedger} disabled={loading}>
            {loading ? 'Lade…' : 'Ledger neu laden'}
          </Button>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Drift-Signale ({signals.length})</CardTitle>
          <CardDescription>
            Pro Signal: deterministisch erlaubte Aktionen + Ledger-Status. Reason-Pflicht ≥ 8 Zeichen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {signals.length === 0 ? (
            <p className="text-sm text-fg-muted">Keine Drift-Signale.</p>
          ) : (
            <ul className="space-y-3">
              {signals.slice(0, 50).map((s) => (
                <BoundedHealRow
                  key={s.idempotency_key}
                  signal={s}
                  ledgerRow={ledgerByKey.get(s.idempotency_key) ?? null}
                  onChanged={refreshLedger}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle className="text-base">Ledger-History ({ledger.length})</CardTitle>
          <CardDescription>Read-only via admin_get_p18_ledger. Kein Bulk-Heal. Kein Direkteditieren.</CardDescription>
        </CardHeader>
        <CardContent>
          {ledger.length === 0 ? (
            <p className="text-sm text-fg-muted">Noch keine Einträge.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-fg-muted">
                  <tr className="border-b border-border-default">
                    <th className="text-left py-1 px-2">Status</th>
                    <th className="text-left py-1 px-2">Drift</th>
                    <th className="text-left py-1 px-2">Severity</th>
                    <th className="text-left py-1 px-2">Last Action</th>
                    <th className="text-left py-1 px-2">Bucket</th>
                    <th className="text-left py-1 px-2">Updated</th>
                    <th className="text-left py-1 px-2">Key</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((r) => (
                    <tr key={r.idempotency_key} className="border-b border-border-default/50">
                      <td className="py-1 px-2"><Badge className={STATUS_TONE[r.status]}>{r.status}</Badge></td>
                      <td className="py-1 px-2 font-mono">{r.drift_type}</td>
                      <td className="py-1 px-2">{r.severity}</td>
                      <td className="py-1 px-2 font-mono text-[10px]">{r.last_action ?? '—'}</td>
                      <td className="py-1 px-2">{r.time_bucket}</td>
                      <td className="py-1 px-2">{new Date(r.updated_at).toISOString().slice(0,16).replace('T',' ')}</td>
                      <td className="py-1 px-2 font-mono text-[10px] truncate max-w-[280px]" title={r.idempotency_key}>{r.idempotency_key}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BoundedHealRow({
  signal,
  ledgerRow,
  onChanged,
}: {
  signal: DriftSignal;
  ledgerRow: LedgerRow | null;
  onChanged: () => void;
}) {
  const allowed = deriveAllowedHealActions(signal);
  const suggestion = useMemo(() => buildKnownSystemSuggestion(signal), [signal]);
  const [reason, setReason] = useState('');
  const [pendingAction, setPendingAction] = useState<HealAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [bridgeReason, setBridgeReason] = useState('');
  const [bridgeBusy, setBridgeBusy] = useState(false);
  const canBridge =
    !!ledgerRow &&
    ['detected', 'escalated', 'heal_requested', 'healed', 'rejected'].includes(ledgerRow.status);


  async function handleRecord() {
    setBusy(true);
    try {
      await recordP18Detection(signal);
      toast.success('Detection im Ledger erfasst');
      onChanged();
    } catch (e) {
      toast.error('Record fehlgeschlagen', { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function handleRequest(action: HealAction) {
    if (reason.trim().length < 8) {
      toast.error('Reason ≥ 8 Zeichen erforderlich');
      return;
    }
    setBusy(true);
    setPendingAction(action);
    try {
      await requestP18Heal({
        idempotency_key: signal.idempotency_key,
        action,
        reason,
        drift: signal,
      });
      toast.success(`Heal angefordert: ${action}`);
      setReason('');
      onChanged();
    } catch (e) {
      toast.error('Request fehlgeschlagen', { description: (e as Error).message });
    } finally {
      setBusy(false);
      setPendingAction(null);
    }
  }

  return (
    <li className="border border-border-default rounded-md p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={SEV_TONE[signal.severity]}>{signal.severity}</Badge>
        <code className="text-xs">{signal.drift_type}</code>
        {ledgerRow && (
          <Badge className={STATUS_TONE[ledgerRow.status]}>{ledgerRow.status}</Badge>
        )}
        <span className="text-xs text-fg-muted ml-auto truncate max-w-[300px]" title={signal.idempotency_key}>
          {signal.idempotency_key}
        </span>
      </div>
      <p className="text-sm">{signal.message}</p>

      {!ledgerRow && (
        <Button size="sm" variant="outline" onClick={handleRecord} disabled={busy}>
          Record Detection
        </Button>
      )}

      {ledgerRow && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-1">
            <div className="md:col-span-2">
              <Label className="text-xs">Reason (≥ 8 Zeichen, Pflicht für Heal-Request)</Label>
              <Textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Warum soll diese bounded Aktion ausgelöst werden?"
              />
            </div>
            <div className="flex flex-col gap-1 justify-end">
              {allowed.map((a) => (
                <Button
                  key={a}
                  size="sm"
                  variant={a === 'EMIT_GOVERNANCE_AUDIT' ? 'default' : 'outline'}
                  disabled={busy || reason.trim().length < 8}
                  onClick={() => handleRequest(a)}
                >
                  {pendingAction === a ? '…' : a}
                </Button>
              ))}
            </div>
          </div>

          {allowed.includes('SUGGEST_KNOWN_SYSTEM_ENTRY') && (
            <details className="text-xs">
              <summary className="cursor-pointer text-fg-muted">Known-System-Suggestion (kopierbar, kein Write)</summary>
              <div className="mt-2 space-y-2">
                <pre className="bg-muted rounded p-2 overflow-x-auto whitespace-pre-wrap">{suggestion.copyable_markdown}</pre>
                <CopyButton
                  value={suggestion.copyable_markdown}
                  variant="chip"
                  label="Markdown kopieren"
                  toastLabel="Suggestion kopiert"
                />
              </div>
            </details>
          )}

          {canBridge && (
            <details className="text-xs border-t border-border-default pt-2">
              <summary className="cursor-pointer text-fg-muted">
                Als GIL-Signal übernehmen (P18 → Growth Intelligence)
              </summary>
              <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="md:col-span-2">
                  <Label className="text-xs">Reason (≥ 8 Zeichen)</Label>
                  <Textarea
                    rows={2}
                    value={bridgeReason}
                    onChange={(e) => setBridgeReason(e.target.value)}
                    placeholder="z. B. „Strategischer Kontext für nächstes Executive-Briefing"."
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={bridgeBusy || bridgeReason.trim().length < 8}
                    onClick={async () => {
                      setBridgeBusy(true);
                      try {
                        const res = await bridgeP18DriftToGil(
                          signal.idempotency_key,
                          bridgeReason,
                        );
                        toast.success(
                          res.result === 'created'
                            ? 'GIL-Signal erstellt'
                            : 'GIL-Signal existierte bereits (idempotent)',
                        );
                        setBridgeReason('');
                      } catch (e) {
                        toast.error('Bridge fehlgeschlagen', {
                          description: (e as Error).message,
                        });
                      } finally {
                        setBridgeBusy(false);
                      }
                    }}
                  >
                    {bridgeBusy ? '…' : 'Als GIL-Signal übernehmen'}
                  </Button>
                </div>
              </div>
            </details>
          )}
        </>
      )}

    </li>
  );
}
