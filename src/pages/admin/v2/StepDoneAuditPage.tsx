/**
 * Audit log page for auto-heal actions affecting `package_steps`.
 * Reads from `step_done_meta_audit` (added by the meta.ok hardening migration).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { CheckCircle2, ShieldAlert } from 'lucide-react';

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

export default function StepDoneAuditPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['step-done-meta-audit'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('step_done_meta_audit')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as AuditRow[];
    },
    refetchInterval: 30_000,
  });

  return (
    <div className="container mx-auto py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Step-Done Meta Audit</h1>
        <p className="text-sm text-muted-foreground">
          Protokoll aller <code>package_steps → done</code> Übergänge mit
          Invariant-Check (<code>meta.ok = 'true'</code>). Letzte 200 Einträge.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Transitions</CardTitle>
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
