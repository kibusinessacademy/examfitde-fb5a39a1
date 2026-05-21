/**
 * P6 Cut 5 — GSC Reconciliation Cockpit v2 (read-only, manual).
 *
 * - Paste-Box: URLs/Pfade je Zeile, optional `<TAB>` oder `,` + GSC-Status
 * - Aufruf admin_reconcile_gsc_urls (klassifiziert on-the-fly, keine
 *   Persistenz von URL-Funden außer dem Run-Audit `gsc_reconciliation_run`)
 * - 9 Decision-Tiles als klickbare Filter
 * - Drilldown-Tabelle mit expected_action
 * - CSV-Export der gefilterten Ansicht
 * - "In GSC prüfen" öffnet nur die Search-Console-URL-Inspection (manuell),
 *   KEIN Auto-Submit, KEINE Google-API-Abhängigkeit.
 * - KEINE Sitemap-/Policy-Mutationen aus dieser Komponente.
 */
import { useMemo, useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Loader2, Download, ExternalLink, AlertCircle, Info } from 'lucide-react';
import { toCsv, downloadCsv } from '@/lib/csv';
import { useToast } from '@/hooks/use-toast';

type Decision =
  | 'valid_indexable'
  | 'expected_noindex'
  | 'expected_redirect'
  | 'expected_gone'
  | 'missing_from_sitemap'
  | 'unexpected_404'
  | 'soft404_candidate'
  | 'canonical_mismatch'
  | 'blocked_by_policy'
  | 'unclassified_needs_fix'
  // Legacy decisions (v1 enum is still ADDITIVE; the v2 classifier doesn't emit them,
  // but the type system mirrors the database enum to avoid future drift).
  | 'valid'
  | 'gone_expected'
  | 'needs_fix';

interface ReconcileRow {
  input: string;
  path: string;
  gsc_status: string | null;
  decision: Decision;
  expected_action: string;
  matched_pattern: string | null;
  matched_state: string | null;
  redirect_to: string | null;
  in_sitemap: boolean;
}

interface ReconcileResult {
  input_count: number;
  summary: Partial<Record<Decision, number>>;
  rows: ReconcileRow[];
}

const DECISION_ORDER: Decision[] = [
  'unexpected_404',
  'soft404_candidate',
  'canonical_mismatch',
  'blocked_by_policy',
  'missing_from_sitemap',
  'unclassified_needs_fix',
  'valid_indexable',
  'expected_redirect',
  'expected_noindex',
];

const DECISION_LABEL: Record<Decision, string> = {
  valid_indexable: 'Valid (indexierbar)',
  expected_noindex: 'Erwartet: noindex',
  expected_redirect: 'Erwartet: Redirect',
  expected_gone: 'Erwartet: Gone',
  missing_from_sitemap: 'Fehlt in Sitemap',
  unexpected_404: 'Unerwartet 404',
  soft404_candidate: 'Soft-404 Kandidat',
  canonical_mismatch: 'Canonical-Mismatch',
  blocked_by_policy: 'Blockiert durch Policy',
  unclassified_needs_fix: 'Unklassifiziert',
  valid: 'Valid (legacy)',
  gone_expected: 'Erwartet: Gone (legacy)',
  needs_fix: 'Fehler (legacy)',
};

const DECISION_TONE: Record<Decision, string> = {
  valid_indexable: 'bg-status-success-bg-subtle text-status-success-text border-status-success-border',
  expected_noindex: 'bg-status-info-bg-subtle text-status-info-text border-status-info-border',
  expected_redirect: 'bg-status-info-bg-subtle text-status-info-text border-status-info-border',
  expected_gone: 'bg-status-info-bg-subtle text-status-info-text border-status-info-border',
  missing_from_sitemap: 'bg-status-warning-bg-subtle text-status-warning-text border-status-warning-border',
  unexpected_404: 'bg-status-error-bg-subtle text-status-error-text border-status-error-border',
  soft404_candidate: 'bg-status-error-bg-subtle text-status-error-text border-status-error-border',
  canonical_mismatch: 'bg-status-error-bg-subtle text-status-error-text border-status-error-border',
  blocked_by_policy: 'bg-status-error-bg-subtle text-status-error-text border-status-error-border',
  unclassified_needs_fix: 'bg-status-warning-bg-subtle text-status-warning-text border-status-warning-border',
  valid: 'bg-status-success-bg-subtle text-status-success-text border-status-success-border',
  gone_expected: 'bg-status-info-bg-subtle text-status-info-text border-status-info-border',
  needs_fix: 'bg-status-error-bg-subtle text-status-error-text border-status-error-border',
};

const PLACEHOLDER = `https://examfit.de/paket/fachinformatiker-anwendungsentwicklung\tindexed
/blog/lerntipps\tindexed
/product/test-alt\t404
/legal/impressum\tnoindex
/old-redirect-source\tredirect`;

function parsePaste(text: string): { path: string; gsc_status: string | null }[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[\t,;]\s*/);
      const path = parts[0]?.trim();
      const status = parts[1]?.trim() || null;
      return { path, gsc_status: status };
    })
    .filter((r) => !!r.path);
}

function gscInspectUrl(path: string): string {
  // Google Search Console URL-Inspection (manuell). Property-String muss in
  // der GSC bereits verifiziert sein. Kein Auto-Submit.
  const target = path.startsWith('http') ? path : `https://examfit.de${path}`;
  return `https://search.google.com/search-console/inspect?resource_id=${encodeURIComponent(
    'sc-domain:examfit.de',
  )}&id=${encodeURIComponent(target)}`;
}

export function GscReconciliationCard() {
  const [pasteText, setPasteText] = useState('');
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [filter, setFilter] = useState<Decision | 'all'>('all');
  const { toast } = useToast();

  const reconcileMutation = useMutation({
    mutationFn: async (inputs: { path: string; gsc_status: string | null }[]) => {
      const { data, error } = await supabase.rpc('admin_reconcile_gsc_urls' as any, {
        _inputs: inputs as any,
        _source: 'cockpit_paste',
      });
      if (error) throw error;
      return data as unknown as ReconcileResult;
    },
    onSuccess: (data) => {
      setResult(data);
      setFilter('all');
      toast({
        title: 'Reconciliation abgeschlossen',
        description: `${data.input_count} URLs klassifiziert.`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: 'Reconciliation fehlgeschlagen',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const handleRun = useCallback(() => {
    const inputs = parsePaste(pasteText);
    if (inputs.length === 0) {
      toast({
        title: 'Keine Eingabe',
        description: 'Bitte mindestens eine URL/Pfad einfügen.',
        variant: 'destructive',
      });
      return;
    }
    reconcileMutation.mutate(inputs);
  }, [pasteText, reconcileMutation, toast]);

  const filteredRows = useMemo(() => {
    if (!result) return [];
    if (filter === 'all') return result.rows;
    return result.rows.filter((r) => r.decision === filter);
  }, [result, filter]);

  const handleExport = useCallback(() => {
    if (filteredRows.length === 0) return;
    const csv = toCsv(
      filteredRows.map((r) => ({
        path: r.path,
        gsc_status: r.gsc_status ?? '',
        decision: r.decision,
        expected_action: r.expected_action,
        in_sitemap: r.in_sitemap ? 'yes' : 'no',
        matched_state: r.matched_state ?? '',
        matched_pattern: r.matched_pattern ?? '',
        redirect_to: r.redirect_to ?? '',
      })),
    );
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    downloadCsv(`gsc-reconciliation-${filter}-${ts}.csv`, csv);
  }, [filteredRows, filter]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>GSC Reconciliation Cockpit</CardTitle>
        <CardDescription>
          GSC-URLs gegen Sitemap-SSOT + <code>route_crawl_policy</code> klassifizieren.
          Read-only — keine automatische GSC-API-Validierung, keine Sitemap/Policy-Mutation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-2">
          <Label htmlFor="gsc-paste" className="text-sm font-medium">
            URLs einfügen (eine pro Zeile, optional <code>{'<TAB>'}</code> + GSC-Status)
          </Label>
          <Textarea
            id="gsc-paste"
            placeholder={PLACEHOLDER}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            className="font-mono text-xs min-h-[140px]"
            spellCheck={false}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3" /> Status-Hinweise: indexed, noindex, redirect, 404,
              soft_404, canonical
            </p>
            <Button
              onClick={handleRun}
              disabled={reconcileMutation.isPending || !pasteText.trim()}
              size="sm"
            >
              {reconcileMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Klassifiziere…
                </>
              ) : (
                'Reconcile starten'
              )}
            </Button>
          </div>
        </section>

        {result && (
          <>
            <section>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                <button
                  type="button"
                  onClick={() => setFilter('all')}
                  className={`px-3 py-2 rounded-md border text-left transition-colors ${
                    filter === 'all'
                      ? 'bg-surface-muted border-border-strong'
                      : 'bg-surface border-border hover:bg-surface-muted'
                  }`}
                >
                  <div className="text-xs text-muted-foreground">Alle</div>
                  <div className="text-lg font-semibold">{result.input_count}</div>
                </button>
                {DECISION_ORDER.map((d) => {
                  const count = result.summary[d] ?? 0;
                  const active = filter === d;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setFilter(active ? 'all' : d)}
                      className={`px-3 py-2 rounded-md border text-left transition-colors ${DECISION_TONE[d]} ${
                        active ? 'ring-2 ring-offset-1 ring-border-strong' : 'opacity-90 hover:opacity-100'
                      }`}
                    >
                      <div className="text-xs">{DECISION_LABEL[d]}</div>
                      <div className="text-lg font-semibold">{count}</div>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {filteredRows.length} von {result.input_count} Zeilen
                  {filter !== 'all' && (
                    <>
                      {' '}
                      · Filter: <Badge variant="outline">{DECISION_LABEL[filter]}</Badge>
                    </>
                  )}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExport}
                  disabled={filteredRows.length === 0}
                >
                  <Download className="h-4 w-4 mr-2" /> CSV-Export
                </Button>
              </div>

              <div className="border border-border rounded-md overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-surface-muted">
                    <tr className="text-left">
                      <th className="px-2 py-2 font-medium">Pfad</th>
                      <th className="px-2 py-2 font-medium">GSC</th>
                      <th className="px-2 py-2 font-medium">Decision</th>
                      <th className="px-2 py-2 font-medium">Expected Action</th>
                      <th className="px-2 py-2 font-medium">Policy</th>
                      <th className="px-2 py-2 font-medium">Sitemap</th>
                      <th className="px-2 py-2 font-medium text-right">Manuell</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-2 py-6 text-center text-muted-foreground">
                          Keine Zeilen für diesen Filter.
                        </td>
                      </tr>
                    ) : (
                      filteredRows.map((r, i) => (
                        <tr key={`${r.path}-${i}`} className="border-t border-border">
                          <td className="px-2 py-2 font-mono">{r.path}</td>
                          <td className="px-2 py-2">{r.gsc_status ?? '—'}</td>
                          <td className="px-2 py-2">
                            <Badge variant="outline" className={DECISION_TONE[r.decision]}>
                              {DECISION_LABEL[r.decision] ?? r.decision}
                            </Badge>
                          </td>
                          <td className="px-2 py-2 font-mono text-[11px]">{r.expected_action}</td>
                          <td className="px-2 py-2 text-[11px]">
                            {r.matched_state ?? '—'}
                            {r.matched_pattern && (
                              <div className="text-muted-foreground truncate max-w-[180px]">
                                {r.matched_pattern}
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-2">{r.in_sitemap ? 'ja' : 'nein'}</td>
                          <td className="px-2 py-2 text-right">
                            <a
                              href={gscInspectUrl(r.path)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-status-info-text hover:underline"
                              title="Öffnet Google Search Console URL-Inspection — kein Auto-Submit"
                            >
                              In GSC prüfen <ExternalLink className="h-3 w-3" />
                            </a>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-muted-foreground flex items-start gap-1 mt-2">
                <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                „In GSC prüfen" öffnet nur die URL-Inspection in der Search Console. Diese
                Karte verändert keine Sitemap und keine <code>route_crawl_policy</code>.
                Persistiert wird nur der Run-Audit (<code>gsc_reconciliation_run</code>).
              </p>
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default GscReconciliationCard;
