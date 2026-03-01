import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Download, RefreshCw, Users, TrendingUp, DollarSign } from 'lucide-react';

const BerufsKIAffiliateDashboard = () => {
  const qc = useQueryClient();

  const { data: affiliates, refetch: refetchAffiliates } = useQuery({
    queryKey: ['work-affiliates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('work_affiliates').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: productSales } = useQuery({
    queryKey: ['work-affiliate-product-sales'],
    queryFn: async () => {
      const { data, error } = await supabase.from('work_purchases')
        .select('id, user_email, affiliate_code, amount_cents, currency, created_at, status')
        .not('affiliate_code', 'is', null).order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return data;
    },
  });

  const { data: bundleSales } = useQuery({
    queryKey: ['work-affiliate-bundle-sales'],
    queryFn: async () => {
      const { data, error } = await supabase.from('work_bundle_purchases')
        .select('id, user_email, affiliate_code, amount_paid_cents, currency, created_at')
        .not('affiliate_code', 'is', null).order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return data;
    },
  });

  const { data: clicks } = useQuery({
    queryKey: ['work-affiliate-clicks'],
    queryFn: async () => {
      const { data, error } = await supabase.from('work_affiliate_clicks')
        .select('*').order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return data;
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('berufski-corporate-sync');
      if (error) throw error;
      return data;
    },
    onSuccess: () => toast.success('Corporate Pläne synchronisiert'),
    onError: (err: any) => toast.error(err.message),
  });

  const toggleStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const newStatus = status === 'active' ? 'paused' : 'active';
      const { error } = await supabase.from('work_affiliates').update({ status: newStatus }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Status aktualisiert'); qc.invalidateQueries({ queryKey: ['work-affiliates'] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const affiliateSummary = (affiliates || []).map(aff => {
    const pSales = (productSales || []).filter(s => s.affiliate_code === aff.code);
    const bSales = (bundleSales || []).filter(s => s.affiliate_code === aff.code);
    const affClicks = (clicks || []).filter(c => c.affiliate_code === aff.code);
    const totalRevenue = pSales.reduce((s, p) => s + (p.amount_cents || 0), 0) + bSales.reduce((s, b) => s + (b.amount_paid_cents || 0), 0);
    const commission = Math.round(totalRevenue * aff.payout_percent / 100);
    return { ...aff, productOrders: pSales.length, bundleOrders: bSales.length, clicks: affClicks.length, totalRevenue, commission };
  });

  const exportCsv = () => {
    const headers = ['Code', 'Name', 'Payout%', 'Clicks', 'Product Orders', 'Bundle Orders', 'Revenue (EUR)', 'Commission (EUR)'];
    const rows = affiliateSummary.map(a => [a.code, a.name, a.payout_percent, a.clicks, a.productOrders, a.bundleOrders, (a.totalRevenue / 100).toFixed(2), (a.commission / 100).toFixed(2)]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `examfitwork-affiliates-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalRevAll = affiliateSummary.reduce((s, a) => s + a.totalRevenue, 0);
  const totalCommAll = affiliateSummary.reduce((s, a) => s + a.commission, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Affiliate Dashboard</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}><RefreshCw className="h-4 w-4 mr-1" /> Corp Sync</Button>
          <Button variant="outline" size="sm" onClick={exportCsv}><Download className="h-4 w-4 mr-1" /> CSV Export</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Users className="h-4 w-4" /> Affiliates</div><div className="text-2xl font-bold mt-1">{affiliates?.length || 0}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-2 text-sm text-muted-foreground"><TrendingUp className="h-4 w-4" /> Clicks</div><div className="text-2xl font-bold mt-1">{clicks?.length || 0}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-2 text-sm text-muted-foreground"><DollarSign className="h-4 w-4" /> Umsatz</div><div className="text-2xl font-bold mt-1">{(totalRevAll / 100).toFixed(2)} €</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-2 text-sm text-muted-foreground"><DollarSign className="h-4 w-4" /> Provision</div><div className="text-2xl font-bold mt-1">{(totalCommAll / 100).toFixed(2)} €</div></CardContent></Card>
      </div>

      <Tabs defaultValue="affiliates">
        <TabsList>
          <TabsTrigger value="affiliates">Affiliates</TabsTrigger>
          <TabsTrigger value="sales">Verkäufe</TabsTrigger>
          <TabsTrigger value="clicks">Clicks</TabsTrigger>
        </TabsList>

        <TabsContent value="affiliates">
          <Card>
            <CardHeader><CardTitle>Affiliate Übersicht</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Payout %</TableHead><TableHead>Clicks</TableHead><TableHead>Produkt</TableHead><TableHead>Bundle</TableHead><TableHead>Umsatz</TableHead><TableHead>Provision</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {affiliateSummary.map(a => (
                    <TableRow key={a.id}>
                      <TableCell className="font-mono text-sm">{a.code}</TableCell>
                      <TableCell>{a.name}</TableCell>
                      <TableCell>{a.payout_percent}%</TableCell>
                      <TableCell>{a.clicks}</TableCell>
                      <TableCell>{a.productOrders}</TableCell>
                      <TableCell>{a.bundleOrders}</TableCell>
                      <TableCell>{(a.totalRevenue / 100).toFixed(2)} €</TableCell>
                      <TableCell className="font-semibold">{(a.commission / 100).toFixed(2)} €</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => toggleStatus.mutate({ id: a.id, status: a.status })} disabled={toggleStatus.isPending}>
                          <Badge variant={a.status === 'active' ? 'default' : 'secondary'}>{a.status}</Badge>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {affiliateSummary.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">Keine Affiliates</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sales">
          <Card>
            <CardHeader><CardTitle>Affiliate-Verkäufe</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Typ</TableHead><TableHead>E-Mail</TableHead><TableHead>Affiliate</TableHead><TableHead>Betrag</TableHead><TableHead>Datum</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(productSales || []).map(s => (
                    <TableRow key={s.id}><TableCell><Badge variant="outline">Produkt</Badge></TableCell><TableCell className="text-sm">{s.user_email}</TableCell><TableCell className="font-mono text-sm">{s.affiliate_code}</TableCell><TableCell>{((s.amount_cents || 0) / 100).toFixed(2)} €</TableCell><TableCell className="text-sm">{new Date(s.created_at).toLocaleDateString('de-DE')}</TableCell></TableRow>
                  ))}
                  {(bundleSales || []).map(s => (
                    <TableRow key={s.id}><TableCell><Badge variant="outline">Bundle</Badge></TableCell><TableCell className="text-sm">{s.user_email}</TableCell><TableCell className="font-mono text-sm">{s.affiliate_code}</TableCell><TableCell>{((s.amount_paid_cents || 0) / 100).toFixed(2)} €</TableCell><TableCell className="text-sm">{new Date(s.created_at).toLocaleDateString('de-DE')}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="clicks">
          <Card>
            <CardHeader><CardTitle>Affiliate Clicks (letzte 200)</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Landing Path</TableHead><TableHead>Referrer</TableHead><TableHead>Datum</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(clicks || []).map(c => (
                    <TableRow key={c.id}><TableCell className="font-mono text-sm">{c.affiliate_code}</TableCell><TableCell className="text-sm">{c.landing_path}</TableCell><TableCell className="text-sm truncate max-w-[200px]">{c.referrer || '—'}</TableCell><TableCell className="text-sm">{new Date(c.created_at).toLocaleDateString('de-DE')}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default BerufsKIAffiliateDashboard;
