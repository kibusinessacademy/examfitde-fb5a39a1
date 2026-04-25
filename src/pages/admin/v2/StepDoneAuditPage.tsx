/**
 * Audit log page for auto-heal actions affecting `package_steps`.
 * Reads from `step_done_meta_audit` (added by the meta.ok hardening migration).
 *
 * Filters: package_id, step_key, source_fn, blocked-only.
 * Export: CSV of currently-filtered rows.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { CheckCircle2, ShieldAlert, Download, Search } from 'lucide-react';
import { AuditReasonDrilldown } from '@/components/admin/heal/AuditReasonDrilldown';

interface AuditRow {
  id: string;
  package_id: string;
  step_key: string;
  prev_status: string | null;
  meta_ok: boolean;
  meta_executed: boolean | null;
  source_fn: string | null;
  trigger_op: string | null;
  blocked: boolean;
  created_at: string;
  prev_meta: Record<string, unknown> | null;
  new_meta: Record<string, unknown> | null;
}

function toCsv(rows: AuditRow[]): string {
  const header = [
    'created_at', 'package_id', 'step_key', 'prev_status',
    'meta_ok', 'meta_executed', 'source_fn', 'trigger_op', 'blocked',
  ];
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      r.created_at, r.package_id, r.step_key, r.prev_status,
      r.meta_ok, r.meta_executed, r.source_fn, r.trigger_op, r.blocked,
    ].map(escape).join(','),
  );
  return [header.join(','), ...lines].join('\n');
}

export default function StepDoneAuditPage() {
  const [packageId, setPackageId] = useState('');
  const [stepKey, setStepKey] = useState('');
  const [sourceFn, setSourceFn] = useState('');
  const [blockedOnly, setBlockedOnly] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['step-done-meta-audit', { packageId, stepKey, sourceFn, blockedOnly }],
    queryFn: async () => {
      let q = supabase
        .from('step_done_meta_audit')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);
      if (packageId.trim()) q = q.eq('package_id', packageId.trim());
      if (stepKey.trim()) q = q.ilike('step_key', `%${stepKey.trim()}%`);
      if (sourceFn.trim()) q = q.ilike('source_fn', `%${sourceFn.trim()}%`);
      if (blockedOnly) q = q.eq('blocked', true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as AuditRow[];
    },
    refetchInterval: 30_000,
  });

  const csv = useMemo(() => (data ? toCsv(data) : ''), [data]);

  const downloadCsv = () => {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `step-done-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container mx-auto py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Step-Done Meta Audit</h1>
        <p className="text-sm text-muted-foreground">
          Protokoll aller <code>package_steps → done</code> Übergänge mit
          Invariant-Check (<code>meta.ok = 'true'</code>). Letzte 500 Einträge.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <Label htmlFor="f-pkg">package_id</Label>
              <Input id="f-pkg" placeholder="UUID exakt"
                value={packageId} onChange={(e) => setPackageId(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="f-step">step_key</Label>
              <Input id="f-step" placeholder="z. B. validate_exam_pool"
                value={stepKey} onChange={(e) => setStepKey(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="f-src">source_fn</Label>
              <Input id="f-src" placeholder="z. B. fn_heal_"
                value={sourceFn} onChange={(e) => setSourceFn(e.target.value)} />
            </div>
            <div className="flex items-end gap-3">
              <div className="flex items-center gap-2">
                <Switch id="f-blocked" checked={blockedOnly} onCheckedChange={setBlockedOnly} />
                <Label htmlFor="f-blocked">nur blockiert</Label>
              </div>
              <Button size="sm" variant="outline" onClick={downloadCsv} disabled={!data?.length}>
                <Download className="w-3 h-3 mr-1" /> CSV
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Recent Transitions {data && <span className="text-muted-foreground text-sm">({data.length})</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="text-sm text-muted-foreground">Lade …</div>}
          {data && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Zeit</TableHead>
                  <TableHead>Step</TableHead>
                  <TableHead>OK</TableHead>
                  <TableHead>Blocked</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Package</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {new Date(r.created_at).toLocaleString('de-DE')}
                    </TableCell>
                    <TableCell><code className="text-xs">{r.step_key}</code></TableCell>
                    <TableCell>
                      {r.meta_ok ? (
                        <Badge variant="default" className="bg-success text-success-foreground">
                          <CheckCircle2 className="w-3 h-3 mr-1" /> OK
                        </Badge>
                      ) : (
                        <Badge variant="destructive">
                          <ShieldAlert className="w-3 h-3 mr-1" /> NO_OK
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.blocked
                        ? <Badge variant="destructive">blocked</Badge>
                        : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell><code className="text-xs">{r.source_fn ?? '—'}</code></TableCell>
                    <TableCell className="text-xs font-mono">
                      {r.package_id.slice(0, 8)}…
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
