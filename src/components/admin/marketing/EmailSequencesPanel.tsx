import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Play, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

type QueueRow = {
  id: string;
  recipient_email: string | null;
  audience: string | null;
  sequence_type: string;
  step_number: number;
  status: string;
  scheduled_for: string;
  sent_at: string | null;
  attempts: number;
  last_error: string | null;
};

export default function EmailSequencesPanel() {
  const qc = useQueryClient();

  const { data: queue, isLoading } = useQuery({
    queryKey: ['email-delivery-queue'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_delivery_queue')
        .select('id, recipient_email, audience, sequence_type, step_number, status, scheduled_for, sent_at, attempts, last_error')
        .order('scheduled_for', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as QueueRow[];
    },
    refetchInterval: 15_000,
  });

  const { data: stats } = useQuery({
    queryKey: ['email-sequence-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_delivery_queue')
        .select('status, sequence_type');
      if (error) throw error;
      const byStatus: Record<string, number> = {};
      const bySeq: Record<string, number> = {};
      for (const r of data ?? []) {
        byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
        bySeq[r.sequence_type] = (bySeq[r.sequence_type] ?? 0) + 1;
      }
      return { byStatus, bySeq };
    },
    refetchInterval: 30_000,
  });

  const runWorker = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('email-sequence-worker', {
        body: { limit: 50 },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      toast.success(`Worker run: ${data?.processed ?? 0} verarbeitet`);
      qc.invalidateQueries({ queryKey: ['email-delivery-queue'] });
      qc.invalidateQueries({ queryKey: ['email-sequence-stats'] });
    },
    onError: (e: Error) => toast.error(`Worker-Fehler: ${e.message}`),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Email-Sequenzen (Loop B)</h2>
          <p className="text-sm text-muted-foreground">
            DOI-Welcome · Pricing-Nurture · Post-Purchase · Re-Engagement
          </p>
        </div>
        <Button onClick={() => runWorker.mutate()} disabled={runWorker.isPending}>
          {runWorker.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
          Worker manuell starten
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Pending</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{stats?.byStatus.pending ?? 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Sent</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-green-600">{stats?.byStatus.sent ?? 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Failed</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-destructive">{stats?.byStatus.failed ?? 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Cancelled</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-muted-foreground">{stats?.byStatus.cancelled ?? 0}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Verteilung nach Sequenz</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(stats?.bySeq ?? {}).map(([seq, n]) => (
              <Badge key={seq} variant="outline">{seq}: {n}</Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Empfänger</TableHead>
            <TableHead>Sequenz</TableHead>
            <TableHead>Step</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Geplant</TableHead>
            <TableHead>Versuche</TableHead>
            <TableHead>Fehler</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(queue ?? []).map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-mono text-xs">{r.recipient_email ?? '–'}</TableCell>
              <TableCell><Badge variant="secondary">{r.sequence_type}/{r.audience}</Badge></TableCell>
              <TableCell>{r.step_number}</TableCell>
              <TableCell>
                <Badge variant={r.status === 'sent' ? 'default' : r.status === 'failed' ? 'destructive' : 'outline'}>
                  {r.status}
                </Badge>
              </TableCell>
              <TableCell className="text-xs">{new Date(r.scheduled_for).toLocaleString('de-DE')}</TableCell>
              <TableCell>{r.attempts}</TableCell>
              <TableCell className="text-xs text-destructive max-w-[200px] truncate">{r.last_error ?? '–'}</TableCell>
            </TableRow>
          ))}
          {(queue ?? []).length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                Noch keine Mails in der Warteschlange. Sequenzen starten automatisch über Trigger (DOI / Pricing / Order).
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
