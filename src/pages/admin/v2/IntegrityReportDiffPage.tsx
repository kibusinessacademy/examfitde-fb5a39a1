/**
 * Integrity report version-diff view.
 * Calls `admin_integrity_report_diff(package_id, vA, vB)` and renders
 * a side-by-side comparison + plain-language explanation.
 */
import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { GitCompare, ArrowRight, CheckCircle2, XCircle } from 'lucide-react';

interface DiffSnapshot {
  id: string;
  created_at: string;
  score: number | null;
  passed: boolean;
  hard_fail_count: number | null;
  hard_fail_reasons: string[];
}

interface DiffResult {
  ok: boolean;
  error?: string;
  package_id?: string;
  a?: DiffSnapshot;
  b?: DiffSnapshot;
  diff?: {
    score_delta: number;
    reasons_added: string[];
    reasons_removed: string[];
    passed_changed: boolean;
  };
  explanation?: string;
  have_versions?: number;
}

function Snapshot({ label, snap }: { label: string; snap: DiffSnapshot }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span>{label}</span>
          {snap.passed ? (
            <Badge className="bg-success text-success-foreground">
              <CheckCircle2 className="h-3 w-3 mr-1" /> passed
            </Badge>
          ) : (
            <Badge variant="destructive">
              <XCircle className="h-3 w-3 mr-1" /> failed
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-xs space-y-1.5">
        <div className="text-muted-foreground">{new Date(snap.created_at).toLocaleString('de-DE')}</div>
        <div>Score: <span className="font-mono font-medium">{snap.score ?? '—'}</span></div>
        <div>Hard-fail count: <span className="font-mono">{snap.hard_fail_count ?? 0}</span></div>
        {snap.hard_fail_reasons.length > 0 && (
          <div>
            <div className="text-muted-foreground mt-1">Reasons:</div>
            <ul className="list-disc ml-4 space-y-0.5">
              {snap.hard_fail_reasons.map((r) => <li key={r} className="font-mono text-[11px]">{r}</li>)}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function IntegrityReportDiffPage() {
  const { packageId: routePkg } = useParams<{ packageId?: string }>();
  const [params] = useSearchParams();
  const [pkg, setPkg] = useState(routePkg ?? params.get('package') ?? '');
  const [vA, setVA] = useState<string>('');
  const [vB, setVB] = useState<string>('');

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['integrity-diff', pkg, vA, vB],
    enabled: !!pkg,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_integrity_report_diff', {
        p_package_id: pkg,
        p_version_a: vA ? parseInt(vA, 10) : null,
        p_version_b: vB ? parseInt(vB, 10) : null,
      });
      if (error) throw error;
      return data as unknown as DiffResult;
    },
  });

  return (
    <div className="container mx-auto py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <GitCompare className="h-6 w-6" />
          Integrity Report Diff
        </h1>
        <p className="text-sm text-muted-foreground">
          Compare two integrity-check runs for one package and see why it
          passed or was marked <code>quality_failed</code>.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Selection</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div className="md:col-span-2">
              <Label className="text-xs">Package ID</Label>
              <Input value={pkg} onChange={(e) => setPkg(e.target.value)} placeholder="uuid…" />
            </div>
            <div>
              <Label className="text-xs">Version A (older)</Label>
              <Input value={vA} onChange={(e) => setVA(e.target.value)} placeholder="auto" />
            </div>
            <div>
              <Label className="text-xs">Version B (newer)</Label>
              <Input value={vB} onChange={(e) => setVB(e.target.value)} placeholder="auto" />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => refetch()} disabled={!pkg || isFetching}>
              {isFetching ? 'Loading…' : 'Compare'}
            </Button>
            <span className="text-xs text-muted-foreground self-center">
              Leave versions empty to compare the two newest runs.
            </span>
          </div>
        </CardContent>
      </Card>

      {isLoading && <div className="text-sm text-muted-foreground">Loading diff…</div>}

      {data && !data.ok && (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            {data.error === 'insufficient_history'
              ? `Not enough history to diff (have ${data.have_versions ?? 0} run(s)). At least 2 are required.`
              : `Error: ${data.error}`}
          </CardContent>
        </Card>
      )}

      {data && data.ok && data.a && data.b && data.diff && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-stretch">
            <Snapshot label="Version A" snap={data.a} />
            <div className="flex items-center justify-center">
              <ArrowRight className="h-6 w-6 text-muted-foreground" />
            </div>
            <Snapshot label="Version B" snap={data.b} />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Diff Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">
                  Score Δ {data.diff.score_delta > 0 ? '+' : ''}{data.diff.score_delta}
                </Badge>
                {data.diff.passed_changed && (
                  <Badge variant="default" className="bg-warning text-warning-foreground">
                    Pass state changed
                  </Badge>
                )}
                <Badge variant="secondary">
                  +{data.diff.reasons_added.length} added · −{data.diff.reasons_removed.length} removed
                </Badge>
              </div>

              {(data.diff.reasons_added.length > 0 || data.diff.reasons_removed.length > 0) && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs font-medium text-destructive mb-1">New hard-fails</div>
                    {data.diff.reasons_added.length === 0 ? (
                      <div className="text-xs text-muted-foreground">none</div>
                    ) : (
                      <ul className="list-disc ml-4 text-xs">
                        {data.diff.reasons_added.map((r) => <li key={r} className="font-mono">{r}</li>)}
                      </ul>
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-medium text-success mb-1">Resolved hard-fails</div>
                    {data.diff.reasons_removed.length === 0 ? (
                      <div className="text-xs text-muted-foreground">none</div>
                    ) : (
                      <ul className="list-disc ml-4 text-xs">
                        {data.diff.reasons_removed.map((r) => <li key={r} className="font-mono">{r}</li>)}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              <div className="border-l-2 border-primary pl-3 py-1 text-sm">
                <div className="text-xs uppercase text-muted-foreground mb-0.5">Explanation</div>
                {data.explanation}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
