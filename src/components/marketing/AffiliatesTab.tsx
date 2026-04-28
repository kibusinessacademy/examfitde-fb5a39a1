import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Edit } from 'lucide-react';

export default function AffiliatesTab() {
  const { data: affiliates, isLoading } = useQuery({
    queryKey: ['affiliates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('affiliates')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    }
  });

  const { data: pendingPayouts } = useQuery({
    queryKey: ['pending-payouts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('affiliates')
        .select('id, pending_payout')
        .gt('pending_payout', 0);
      if (error) throw error;
      return data?.reduce((sum, a) => sum + (a.pending_payout || 0), 0) || 0;
    }
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const activeAffiliates = affiliates?.filter(a => a.status === 'active').length || 0;
  const totalEarnings = affiliates?.reduce((sum, a) => sum + (a.total_earnings || 0), 0) || 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Aktive Partner</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{activeAffiliates}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Gesamt Auszahlungen</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{totalEarnings.toFixed(2)}€</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Ausstehend</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-display font-bold text-warning tabular-nums">{(pendingPayouts || 0).toFixed(2)}€</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Bewerbungen</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{affiliates?.filter(a => a.status === 'pending').length || 0}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Affiliate Partner</CardTitle>
          <CardDescription>Partnerprogramm</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Partner-Code</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Provision</TableHead>
                <TableHead>Verdient</TableHead>
                <TableHead>Ausstehend</TableHead>
                <TableHead className="text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {affiliates?.map((affiliate) => (
                <TableRow key={affiliate.id}>
                  <TableCell className="font-mono">{affiliate.affiliate_code}</TableCell>
                  <TableCell>
                    <Badge variant={
                      affiliate.status === 'active' ? 'default' :
                      affiliate.status === 'pending' ? 'secondary' :
                      'destructive'
                    }>
                      {affiliate.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{affiliate.commission_rate}%</TableCell>
                  <TableCell>{(affiliate.total_earnings || 0).toFixed(2)}€</TableCell>
                  <TableCell className="text-warning tabular-nums">{(affiliate.pending_payout || 0).toFixed(2)}€</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon"><Edit className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {affiliates?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Noch keine Affiliates registriert
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
