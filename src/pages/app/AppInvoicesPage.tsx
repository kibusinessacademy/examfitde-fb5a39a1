import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Receipt, ExternalLink } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

function formatCents(cents: number, currency = 'EUR') {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
}

export default function AppInvoicesPage() {
  const { user } = useAuth();
  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['app-invoices', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      // invoices.user_id existiert nicht — Join über orders.buyer_user_id
      const { data, error } = await supabase
        .from('invoices')
        .select('id, invoice_number, total_gross_cents, status, pdf_url, issue_date, created_at, orders!inner(buyer_user_id, currency)')
        .eq('orders.buyer_user_id', user!.id)
        .order('issue_date', { ascending: false, nullsFirst: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold text-text-primary flex items-center gap-2"><Receipt className="h-6 w-6" /> Rechnungen</h2>
      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-text-muted mx-auto mt-10" />
      ) : invoices.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-text-secondary">Noch keine Rechnungen vorhanden.</CardContent></Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nr.</TableHead>
                <TableHead>Datum</TableHead>
                <TableHead>Betrag</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">PDF</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv: any) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono text-xs">{inv.invoice_number ?? inv.id.slice(0, 8)}</TableCell>
                  <TableCell>{new Date(inv.issue_date ?? inv.created_at).toLocaleDateString('de-DE')}</TableCell>
                  <TableCell>{formatCents(inv.total_gross_cents ?? 0, inv.orders?.currency ?? 'EUR')}</TableCell>
                  <TableCell><Badge variant={inv.status === 'paid' ? 'default' : 'secondary'}>{inv.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    {inv.pdf_url ? (
                      <Button asChild size="sm" variant="outline">
                        <a href={inv.pdf_url} target="_blank" rel="noopener noreferrer">
                          Öffnen <ExternalLink className="ml-1 h-3 w-3" />
                        </a>
                      </Button>
                    ) : (
                      <span className="text-xs text-text-muted">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
