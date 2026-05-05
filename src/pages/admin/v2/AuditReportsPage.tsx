import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';

type AuditSummary = {
  generated_at: string;
  coupling_legacy_producers: { proname: string; args: string; issue: string; schema_name: string }[];
  orphan_jobs: { count: number; sample: { job_id: string; job_type: string; status: string; package_id: string | null; created_at: string; last_error: string | null }[] };
  orphan_functions_latest: { function_name: string; ref_count: number; notes: string | null; snapshot_at: string }[];
  dead_columns_latest: {
    table_name: string;
    column_name: string;
    ref_count_db: number;
    ref_count_edge: number;
    ref_count_ui: number;
    safe_to_drop: boolean;
    notes: string | null;
    snapshot_at: string;
  }[];
};

export default function AuditReportsPage() {
  const [data, setData] = useState<AuditSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const { data, error } = await (supabase as unknown as {
        rpc: (n: string) => Promise<{ data: AuditSummary | null; error: { message: string } | null }>;
      }).rpc('admin_get_audit_reports_summary');
      if (error) throw error;
      setData(data);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const counts = data
    ? {
        coupling: data.coupling_legacy_producers.length,
        orphanJobs: data.orphan_jobs?.count ?? 0,
        orphanFns: data.orphan_functions_latest.length,
        deadCols: data.dead_columns_latest.length,
        deadColsSafe: data.dead_columns_latest.filter((c) => c.safe_to_drop).length,
      }
    : null;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Audit Reports</h1>
          <p className="text-sm text-muted-foreground">
            Coupling, verwaiste Jobs/Funktionen &amp; tote Spalten — letzter Snapshot{' '}
            {data?.generated_at ? new Date(data.generated_at).toLocaleString() : '—'}
          </p>
        </div>
        <Button onClick={load} variant="outline" size="sm" disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Neu laden
        </Button>
      </div>

      {err && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-destructive">{err}</CardContent>
        </Card>
      )}

      {loading && !data && <Skeleton className="h-64" />}

      {counts && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard label="Coupling-Producer (legacy)" value={counts.coupling} bad={counts.coupling > 0} />
          <KpiCard label="Verwaiste Jobs" value={counts.orphanJobs} bad={counts.orphanJobs > 0} />
          <KpiCard label="Orphan Edge-Functions" value={counts.orphanFns} bad={counts.orphanFns > 0} />
          <KpiCard
            label="Dead Columns (safe / total)"
            value={`${counts.deadColsSafe} / ${counts.deadCols}`}
            bad={false}
          />
        </div>
      )}

      {data && (
        <Tabs defaultValue="coupling" className="w-full">
          <TabsList>
            <TabsTrigger value="coupling">Coupling ({counts?.coupling ?? 0})</TabsTrigger>
            <TabsTrigger value="orphan-jobs">Orphan Jobs ({counts?.orphanJobs ?? 0})</TabsTrigger>
            <TabsTrigger value="orphan-fns">Orphan Functions ({counts?.orphanFns ?? 0})</TabsTrigger>
            <TabsTrigger value="dead-cols">Dead Columns ({counts?.deadCols ?? 0})</TabsTrigger>
          </TabsList>

          <TabsContent value="coupling">
            <ReportTable
              title="Funktionen mit legacy auto_heal_log-Schreibmuster"
              empty="Keine Coupling-Probleme. ✅"
              columns={['proname', 'args', 'issue']}
              rows={data.coupling_legacy_producers.map((r) => [r.proname, r.args, r.issue])}
            />
          </TabsContent>

          <TabsContent value="orphan-jobs">
            <ReportTable
              title="Jobs mit referenziertem package_id, das nicht mehr existiert"
              empty="Keine verwaisten Jobs. ✅"
              columns={['job_id', 'type', 'status', 'package_id', 'last_error']}
              rows={data.orphan_jobs.sample.map((j) => [
                j.job_id.slice(0, 8),
                j.job_type,
                j.status,
                j.package_id?.slice(0, 8) ?? '—',
                j.last_error?.slice(0, 80) ?? '—',
              ])}
            />
          </TabsContent>

          <TabsContent value="orphan-fns">
            <ReportTable
              title="Edge-Functions ohne erkennbare Aufrufer (letzter Snapshot)"
              empty="Noch kein Snapshot — laufe `node scripts/edge-fn-audit.mjs` oder warte auf Cron."
              columns={['function_name', 'ref_count', 'notes']}
              rows={data.orphan_functions_latest.map((f) => [f.function_name, String(f.ref_count), f.notes ?? '—'])}
            />
          </TabsContent>

          <TabsContent value="dead-cols">
            <ReportTable
              title="Spalten-Kandidaten ohne Referenzen (db/edge/ui)"
              empty="Noch kein Snapshot — laufe `node scripts/dead-column-audit.mjs`."
              columns={['table.column', 'db', 'edge', 'ui', 'safe?']}
              rows={data.dead_columns_latest.map((c) => [
                `${c.table_name}.${c.column_name}`,
                String(c.ref_count_db),
                String(c.ref_count_edge),
                String(c.ref_count_ui),
                c.safe_to_drop ? '✅' : '⛔',
              ])}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function KpiCard({ label, value, bad }: { label: string; value: number | string; bad: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
          {bad ? (
            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          )}
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold text-foreground">{value}</div>
      </CardContent>
    </Card>
  );
}

function ReportTable({
  title,
  empty,
  columns,
  rows,
}: {
  title: string;
  empty: string;
  columns: string[];
  rows: (string | number)[][];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Badge variant="secondary">leer</Badge> {empty}
          </div>
        ) : (
          <ScrollArea className="h-96">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-1">
                <tr>
                  {columns.map((c) => (
                    <th key={c} className="text-left p-2 font-medium text-muted-foreground border-b border-border">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-surface-2">
                    {r.map((cell, j) => (
                      <td key={j} className="p-2 font-mono text-foreground">
                        {String(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
