import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { usePartnerCommissions } from '@/hooks/usePartnerSystem';
import { Skeleton } from '@/components/ui/skeleton';

interface Props { partnerId: string; }

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'Ausstehend', variant: 'secondary' },
  approved: { label: 'Genehmigt', variant: 'default' },
  rejected: { label: 'Abgelehnt', variant: 'destructive' },
  paid: { label: 'Ausgezahlt', variant: 'outline' },
  cancelled: { label: 'Storniert', variant: 'destructive' },
};

export function PartnerCommissionsTab({ partnerId }: Props) {
  const { data: commissions, isLoading } = usePartnerCommissions(partnerId);

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <Card className="glass-card">
      <CardContent className="pt-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Datum</TableHead>
              <TableHead>Bestellung</TableHead>
              <TableHead>Betrag</TableHead>
              <TableHead>Modus</TableHead>
              <TableHead>Provision</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {commissions?.map((c: any) => {
              const st = statusConfig[c.commission_status] || { label: c.commission_status, variant: 'outline' as const };
              return (
                <TableRow key={c.id}>
                  <TableCell className="text-sm">{new Date(c.created_at).toLocaleDateString('de-DE')}</TableCell>
                  <TableCell className="font-mono text-xs">{c.order_ref || '—'}</TableCell>
                  <TableCell className="text-sm">{c.gross_amount_eur?.toFixed(2)}€</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{c.commission_mode} ({c.commission_rate}%)</TableCell>
                  <TableCell className="text-sm font-semibold">{c.commission_amount_eur?.toFixed(2)}€</TableCell>
                  <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                </TableRow>
              );
            })}
            {(!commissions || commissions.length === 0) && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">Noch keine Provisionen</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
