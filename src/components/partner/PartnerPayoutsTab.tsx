import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { usePartnerPayouts, usePartnerAvailableBalance, useRequestPartnerPayout } from '@/hooks/usePartnerSystem';
import { Skeleton } from '@/components/ui/skeleton';
import { Wallet } from 'lucide-react';
import { toast } from 'sonner';

interface Props { partnerId: string; }

const MIN_PAYOUT = 50;

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  requested: { label: 'Beantragt', variant: 'secondary' },
  approved: { label: 'Genehmigt', variant: 'default' },
  paid: { label: 'Ausgezahlt', variant: 'outline' },
  rejected: { label: 'Abgelehnt', variant: 'destructive' },
};

export function PartnerPayoutsTab({ partnerId }: Props) {
  const { data: payouts, isLoading } = usePartnerPayouts(partnerId);
  const { data: availableAmount = 0 } = usePartnerAvailableBalance(partnerId);
  const requestPayout = useRequestPartnerPayout();

  const canRequest = availableAmount >= MIN_PAYOUT;

  const handleRequestPayout = async () => {
    if (!canRequest) { toast.error(`Mindestbetrag für Auszahlung: ${MIN_PAYOUT}€`); return; }
    try {
      await requestPayout.mutateAsync({ partner_id: partnerId, amount: availableAmount });
      toast.success('Auszahlung beantragt!');
    } catch (e: any) {
      toast.error(e.message || 'Fehler');
    }
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      <Card className="glass-card border-primary/20">
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
            <Wallet className="h-4 w-4" /> Verfügbarer Betrag
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-display font-bold mb-4">{availableAmount.toFixed(2)}€</div>
          <Button onClick={handleRequestPayout} disabled={!canRequest || requestPayout.isPending}>
            {canRequest ? 'Auszahlung beantragen' : `Mindestens ${MIN_PAYOUT}€ erforderlich`}
          </Button>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardContent className="pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Datum</TableHead>
                <TableHead>Betrag</TableHead>
                <TableHead>Genehmigt</TableHead>
                <TableHead>Referenz</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payouts?.map((p: any) => {
                const st = statusConfig[p.payout_status] || { label: p.payout_status, variant: 'outline' as const };
                return (
                  <TableRow key={p.id}>
                    <TableCell className="text-sm">{new Date(p.requested_at).toLocaleDateString('de-DE')}</TableCell>
                    <TableCell className="text-sm font-semibold">{p.requested_amount_eur?.toFixed(2)}€</TableCell>
                    <TableCell className="text-sm">{p.approved_amount_eur ? `${p.approved_amount_eur.toFixed(2)}€` : '—'}</TableCell>
                    <TableCell className="text-xs font-mono">{p.payout_reference || '—'}</TableCell>
                    <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                  </TableRow>
                );
              })}
              {(!payouts || payouts.length === 0) && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">Noch keine Auszahlungen</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
