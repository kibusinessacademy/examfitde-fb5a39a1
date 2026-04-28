import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

export default function BudgetTab() {
  const queryClient = useQueryClient();

  const { data: requests, isLoading } = useQuery({
    queryKey: ['budget-requests'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('marketing_budget_requests')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    }
  });

  const decideBudget = useMutation({
    mutationFn: async ({ id, status, reason }: { id: string; status: string; reason?: string }) => {
      const { error } = await supabase.from('marketing_budget_requests').update({
        status,
        decided_by: 'admin',
        decided_at: new Date().toISOString(),
        decision_reason: reason || null
      }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budget-requests'] });
      toast.success('Budget-Entscheidung gespeichert');
    }
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const pending = requests?.filter(r => r.status === 'pending') || [];
  const totalApproved = requests?.filter(r => r.status === 'approved').reduce((s, r) => s + r.requested_amount, 0) || 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className={pending.length > 0 ? 'border-warning/40' : ''}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary flex items-center gap-2">
              {pending.length > 0 && <AlertTriangle className="h-4 w-4 text-warning" />}
              Offene Anträge
            </CardTitle>
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{pending.length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Genehmigt (gesamt)</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{totalApproved.toFixed(2)}€</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Basis-Budget</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">100,00€</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Budget-Anträge</CardTitle>
          <CardDescription>Jede Erhöhung benötigt Beweis (CAC, LTV, ROI) und Admin-Genehmigung</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kampagne</TableHead>
                <TableHead>Beantragt</TableHead>
                <TableHead>Aktuell</TableHead>
                <TableHead>ROI</TableHead>
                <TableHead>Risiko</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests?.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.campaign_name}</TableCell>
                  <TableCell className="font-mono font-bold">{r.requested_amount}€</TableCell>
                  <TableCell className="font-mono">{r.current_budget}€</TableCell>
                  <TableCell>{r.expected_roi ? `${r.expected_roi}x` : '–'}</TableCell>
                  <TableCell>
                    <Badge variant={r.risk_level === 'low' ? 'secondary' : r.risk_level === 'high' ? 'destructive' : 'outline'}>
                      {r.risk_level}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.status === 'approved' ? 'default' : r.status === 'rejected' ? 'destructive' : 'secondary'}>
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    {r.status === 'pending' && (
                      <>
                        <Button size="sm" onClick={() => decideBudget.mutate({ id: r.id, status: 'approved' })}>
                          <CheckCircle className="h-3.5 w-3.5 mr-1" /> Genehmigen
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => decideBudget.mutate({ id: r.id, status: 'rejected', reason: 'Kein ausreichender ROI-Beweis' })}>
                          <XCircle className="h-3.5 w-3.5 mr-1" /> Ablehnen
                        </Button>
                      </>
                    )}
                    {r.decided_at && (
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(r.decided_at), 'dd.MM.yy', { locale: de })}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {requests?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">Keine Budget-Anträge</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
