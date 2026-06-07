/**
 * P18 UX-Gap Detail Panel — admin Leitstelle for drift_type='ux_gap' rows.
 *
 * Bridge over the EXISTING ledger (admin_get_p18_ledger). No new tables, no
 * parallel store. Groups ledger rows by surface (target_fingerprint) and by
 * policy_version, so the operator sees per-surface:
 *
 *   - escalated rule (status + verdict + severity)
 *   - allowed bounded actions
 *   - matched system ids (evidence)
 *   - first / latest detection + how often the same key was seen
 *   - source classification (pre-customer / learner / static / runtime)
 *
 * Pure read panel. Mutations stay in P18BoundedHealPanel (Reason-Pflicht).
 */
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { listP18Ledger, type LedgerRow } from '@/lib/governance/p18-heal-executor.functions';

const STATUS_TONE: Record<LedgerRow['status'], string> = {
  detected: 'bg-status-bg-subtle-info text-status-fg-info',
  escalated: 'bg-status-bg-subtle-danger text-status-fg-danger',
  heal_requested: 'bg-status-bg-subtle-warning text-status-fg-warning',
  healed: 'bg-status-bg-subtle-success text-status-fg-success',
  rejected: 'bg-status-bg-subtle-danger text-status-fg-danger',
  suppressed: 'bg-muted text-fg-muted',
};

const SEV_TONE: Record<LedgerRow['severity'], string> = {
  block: 'bg-status-bg-subtle-danger text-status-fg-danger',
  warn: 'bg-status-bg-subtle-warning text-status-fg-warning',
  info: 'bg-status-bg-subtle-info text-status-fg-info',
};

function sourceFromTrigger(trigger: string): string {
  switch (trigger) {
    case 'static-guard-failed': return 'static-surface-scan';
    case 'runtime-anomaly-detected': return 'entry-fallback-signal';
    case 'architecture-review-done': return 'reality (pre-customer | learner)';
    default: return trigger;
  }
}

function shortSurface(fp: string): string {
  // ux:<surface>:<id>  → surface
  const m = /^ux:(.+):[^:]+$/.exec(fp);
  return m ? m[1] : fp;
}

interface SurfaceGroup {
  surface: string;
  rows: LedgerRow[];
  worstSeverity: LedgerRow['severity'];
  latestUpdated: string;
  totalFindings: number;
  policyVersions: Set<string>;
  statuses: Set<LedgerRow['status']>;
  systemIds: Set<string>;
}

function groupBySurface(rows: LedgerRow[]): SurfaceGroup[] {
  const map = new Map<string, SurfaceGroup>();
  const sevRank: Record<LedgerRow['severity'], number> = { block: 3, warn: 2, info: 1 };
  for (const r of rows) {
    const surface = shortSurface(r.target_fingerprint);
    const g = map.get(surface) ?? {
      surface,
      rows: [],
      worstSeverity: r.severity,
      latestUpdated: r.updated_at,
      totalFindings: 0,
      policyVersions: new Set<string>(),
      statuses: new Set<LedgerRow['status']>(),
      systemIds: new Set<string>(),
    };
    g.rows.push(r);
    g.totalFindings += r.finding_count ?? 1;
    g.policyVersions.add(r.policy_version);
    g.statuses.add(r.status);
    for (const id of r.matched_system_ids ?? []) g.systemIds.add(id);
    if (sevRank[r.severity] > sevRank[g.worstSeverity]) g.worstSeverity = r.severity;
    if (r.updated_at > g.latestUpdated) g.latestUpdated = r.updated_at;
    map.set(surface, g);
  }
  const sevRankSort: Record<LedgerRow['severity'], number> = { block: 0, warn: 1, info: 2 };
  return Array.from(map.values()).sort((a, b) => {
    const s = sevRankSort[a.worstSeverity] - sevRankSort[b.worstSeverity];
    if (s !== 0) return s;
    return b.latestUpdated.localeCompare(a.latestUpdated);
  });
}

export default function P18UxGapDetailPanel() {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [openSurface, setOpenSurface] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const data = await listP18Ledger({ limit: 200, drift_type: 'ux_gap' });
      setRows(data);
    } catch (e) {
      toast.error('UX-Gap Ledger laden fehlgeschlagen', { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const groups = useMemo(() => groupBySurface(rows), [rows]);
  const filtered = useMemo(() => {
    if (!query.trim()) return groups;
    const q = query.trim().toLowerCase();
    return groups.filter((g) =>
      g.surface.toLowerCase().includes(q) ||
      Array.from(g.systemIds).some((id) => id.toLowerCase().includes(q)) ||
      Array.from(g.policyVersions).some((p) => p.toLowerCase().includes(q)),
    );
  }, [groups, query]);

  const blockCount = groups.filter((g) => g.worstSeverity === 'block').length;
  const warnCount = groups.filter((g) => g.worstSeverity === 'warn').length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">UX-Gap Findings (drift_type=ux_gap)</CardTitle>
          <CardDescription>
            Pro Surface aggregierte Ergebnisse aus dem P18-Ledger. <strong>{groups.length}</strong> Surfaces ·{' '}
            <span className="text-status-fg-danger font-medium">{blockCount} block</span> ·{' '}
            <span className="text-status-fg-warning font-medium">{warnCount} warn</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Surface, system-id oder policy_version filtern…"
            className="max-w-md"
          />
          <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
            {loading ? 'Lade…' : 'Neu laden'}
          </Button>
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-fg-muted">
          {loading ? 'Lade UX-Gap Ledger…' : 'Keine ux_gap-Findings im Ledger.'}
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((g) => {
            const isOpen = openSurface === g.surface;
            return (
              <Card key={g.surface}>
                <CardHeader className="pb-2 cursor-pointer" onClick={() => setOpenSurface(isOpen ? null : g.surface)}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={SEV_TONE[g.worstSeverity]}>{g.worstSeverity}</Badge>
                    <code className="text-sm font-medium">{g.surface}</code>
                    <span className="text-xs text-fg-muted">· {g.rows.length} ledger-row(s) · {g.totalFindings} finding(s)</span>
                    <span className="ml-auto text-xs text-fg-muted">
                      latest {new Date(g.latestUpdated).toISOString().slice(0, 16).replace('T', ' ')} UTC
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                    {Array.from(g.statuses).map((s) => (
                      <Badge key={s} variant="outline" className={STATUS_TONE[s]}>{s}</Badge>
                    ))}
                    {Array.from(g.policyVersions).map((p) => (
                      <Badge key={p} variant="outline">{p}</Badge>
                    ))}
                  </div>
                </CardHeader>
                {isOpen && (
                  <CardContent className="pt-0">
                    <div className="mb-2 text-xs text-fg-muted">
                      <span className="font-medium">Matched systems:</span>{' '}
                      {Array.from(g.systemIds).length === 0 ? '—' : Array.from(g.systemIds).join(', ')}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="text-fg-muted">
                          <tr className="border-b border-border-default">
                            <th className="text-left py-1 px-2">Status</th>
                            <th className="text-left py-1 px-2">Severity</th>
                            <th className="text-left py-1 px-2">Verdict</th>
                            <th className="text-left py-1 px-2">Source (trigger)</th>
                            <th className="text-left py-1 px-2">Allowed actions</th>
                            <th className="text-left py-1 px-2">Findings</th>
                            <th className="text-left py-1 px-2">Last action</th>
                            <th className="text-left py-1 px-2">Bucket</th>
                            <th className="text-left py-1 px-2">Updated</th>
                            <th className="text-left py-1 px-2">Key</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.rows.map((r) => (
                            <tr key={r.idempotency_key} className="border-b border-border-default/50">
                              <td className="py-1 px-2"><Badge className={STATUS_TONE[r.status]}>{r.status}</Badge></td>
                              <td className="py-1 px-2"><Badge className={SEV_TONE[r.severity]}>{r.severity}</Badge></td>
                              <td className="py-1 px-2 font-mono">{r.verdict}</td>
                              <td className="py-1 px-2">{sourceFromTrigger(r.trigger_source)}</td>
                              <td className="py-1 px-2 font-mono text-[10px]">{(r.allowed_actions ?? []).join(', ') || '—'}</td>
                              <td className="py-1 px-2 text-right">{r.finding_count}</td>
                              <td className="py-1 px-2 font-mono text-[10px]">{r.last_action ?? '—'}</td>
                              <td className="py-1 px-2">{r.time_bucket}</td>
                              <td className="py-1 px-2">{new Date(r.updated_at).toISOString().slice(0, 16).replace('T', ' ')}</td>
                              <td className="py-1 px-2 font-mono text-[10px] truncate max-w-[260px]" title={r.idempotency_key}>{r.idempotency_key}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
