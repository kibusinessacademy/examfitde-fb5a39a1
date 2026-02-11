import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DollarSign, TrendingUp, Receipt, Download, FileText, RefreshCw,
  AlertTriangle, BarChart3, Landmark, ArrowUpDown, CreditCard, Scale
} from 'lucide-react';
import { toast } from 'sonner';

const fmtEur = (v: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(v || 0);

function useDateRange() {
  const now = new Date();
  const [from, setFrom] = useState(new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(now.toISOString().slice(0, 10));
  return { from, to, setFrom, setTo };
}

function useFinanceReport(report: string, from: string, to: string) {
  return useQuery({
    queryKey: ['finance-report', report, from, to],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('finance-reports', {
        body: null,
        headers: {},
        method: 'GET',
      });
      // Use query params via URL workaround – call with body
      const res = await supabase.functions.invoke('finance-reports', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report, from, to }),
      });
      if (res.error) throw res.error;
      return res.data?.data || [];
    },
    enabled: false, // manual trigger
  });
}

// ---- Revenue Tab ----
function RevenueTab({ from, to }: { from: string; to: string }) {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['finance-revenue', from, to],
    queryFn: async () => {
      const { data: result } = await supabase.rpc('report_revenue_by_month', { p_from: from, p_to: to });
      return (result as any[]) || [];
    },
  });

  const totalNet = data?.reduce((s, r) => s + Number(r.netto_eur || 0), 0) || 0;
  const totalGross = data?.reduce((s, r) => s + Number(r.brutto_eur || 0), 0) || 0;
  const totalTax = data?.reduce((s, r) => s + Number(r.ust_eur || 0), 0) || 0;

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="glass-card border-green-500/20 bg-green-500/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <DollarSign className="h-5 w-5 text-green-500" />
              <div>
                <div className="text-2xl font-bold">{fmtEur(totalGross)}</div>
                <div className="text-sm text-muted-foreground">Brutto-Umsatz</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <TrendingUp className="h-5 w-5 text-primary" />
              <div>
                <div className="text-2xl font-bold">{fmtEur(totalNet)}</div>
                <div className="text-sm text-muted-foreground">Netto-Umsatz</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Scale className="h-5 w-5 text-amber-500" />
              <div>
                <div className="text-2xl font-bold">{fmtEur(totalTax)}</div>
                <div className="text-sm text-muted-foreground">USt gesamt</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">Umsatz nach Monat</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Monat</TableHead>
                <TableHead className="text-right">Brutto (€)</TableHead>
                <TableHead className="text-right">Netto (€)</TableHead>
                <TableHead className="text-right">USt (€)</TableHead>
                <TableHead className="text-right">Transaktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.map((row: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{row.monat}</TableCell>
                  <TableCell className="text-right">{fmtEur(row.brutto_eur)}</TableCell>
                  <TableCell className="text-right">{fmtEur(row.netto_eur)}</TableCell>
                  <TableCell className="text-right">{fmtEur(row.ust_eur)}</TableCell>
                  <TableCell className="text-right">{row.anzahl}</TableCell>
                </TableRow>
              ))}
              {(!data || data.length === 0) && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    Keine Umsatzdaten im gewählten Zeitraum
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

// ---- VAT Tab ----
function VATTab({ from, to }: { from: string; to: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['finance-vat', from, to],
    queryFn: async () => {
      const { data: result } = await supabase.rpc('report_vat_by_rate', { p_from: from, p_to: to });
      return (result as any[]) || [];
    },
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Scale className="h-5 w-5" /> USt-Auswertung nach Steuersatz
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Steuersatz</TableHead>
              <TableHead className="text-right">Netto (€)</TableHead>
              <TableHead className="text-right">USt (€)</TableHead>
              <TableHead className="text-right">Brutto (€)</TableHead>
              <TableHead className="text-right">Anzahl</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.map((row: any, i: number) => (
              <TableRow key={i}>
                <TableCell className="font-medium">{Number(row.tax_rate_pct).toFixed(0)}%</TableCell>
                <TableCell className="text-right">{fmtEur(row.netto_eur)}</TableCell>
                <TableCell className="text-right">{fmtEur(row.ust_eur)}</TableCell>
                <TableCell className="text-right">{fmtEur(row.brutto_eur)}</TableCell>
                <TableCell className="text-right">{row.anzahl}</TableCell>
              </TableRow>
            ))}
            {(!data || data.length === 0) && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">Keine Daten</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---- Fees & Refunds Tab ----
function FeesRefundsTab({ from, to }: { from: string; to: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['finance-fees', from, to],
    queryFn: async () => {
      const { data: result } = await supabase.rpc('report_fees_refunds_by_month', { p_from: from, p_to: to });
      return (result as any[]) || [];
    },
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  const totalFees = data?.reduce((s, r) => s + Number(r.fees_eur || 0), 0) || 0;
  const totalRefunds = data?.reduce((s, r) => s + Number(r.refunds_eur || 0), 0) || 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="glass-card border-amber-500/20 bg-amber-500/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <CreditCard className="h-5 w-5 text-amber-500" />
              <div>
                <div className="text-2xl font-bold">{fmtEur(totalFees)}</div>
                <div className="text-sm text-muted-foreground">Stripe Fees gesamt</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card border-red-500/20 bg-red-500/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              <div>
                <div className="text-2xl font-bold">{fmtEur(totalRefunds)}</div>
                <div className="text-sm text-muted-foreground">Rückerstattungen gesamt</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card">
        <CardHeader><CardTitle className="text-lg">Fees & Refunds nach Monat</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Monat</TableHead>
                <TableHead className="text-right">Fees (€)</TableHead>
                <TableHead className="text-right">Refunds (€)</TableHead>
                <TableHead className="text-right">Disputes (€)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.map((row: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{row.monat}</TableCell>
                  <TableCell className="text-right">{fmtEur(row.fees_eur)}</TableCell>
                  <TableCell className="text-right">{fmtEur(row.refunds_eur)}</TableCell>
                  <TableCell className="text-right">{fmtEur(row.disputes_eur)}</TableCell>
                </TableRow>
              ))}
              {(!data || data.length === 0) && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">Keine Daten</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Products Tab ----
function ProductsTab({ from, to }: { from: string; to: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['finance-products', from, to],
    queryFn: async () => {
      const { data: result } = await supabase.rpc('report_revenue_by_product', { p_from: from, p_to: to });
      return (result as any[]) || [];
    },
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <BarChart3 className="h-5 w-5" /> Umsatz nach Produkt
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produkt</TableHead>
              <TableHead className="text-right">Netto (€)</TableHead>
              <TableHead className="text-right">Brutto (€)</TableHead>
              <TableHead className="text-right">Verkäufe</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.map((row: any, i: number) => (
              <TableRow key={i}>
                <TableCell className="font-medium max-w-[250px] truncate">{row.produkt}</TableCell>
                <TableCell className="text-right">{fmtEur(row.netto_eur)}</TableCell>
                <TableCell className="text-right">{fmtEur(row.brutto_eur)}</TableCell>
                <TableCell className="text-right">{row.anzahl}</TableCell>
              </TableRow>
            ))}
            {(!data || data.length === 0) && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">Keine Daten</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---- Payouts Tab ----
function PayoutsTab({ from, to }: { from: string; to: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['finance-payouts', from, to],
    queryFn: async () => {
      const { data: result } = await supabase.rpc('report_payouts', { p_from: from, p_to: to });
      return (result as any[]) || [];
    },
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Landmark className="h-5 w-5" /> Auszahlungen (Payouts)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Datum</TableHead>
              <TableHead className="text-right">Betrag (€)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Stripe Payout ID</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.map((row: any, i: number) => (
              <TableRow key={i}>
                <TableCell className="font-medium">{row.datum}</TableCell>
                <TableCell className="text-right">{fmtEur(row.betrag_eur)}</TableCell>
                <TableCell><Badge variant="outline">{row.status}</Badge></TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{row.stripe_payout_id || '–'}</TableCell>
              </TableRow>
            ))}
            {(!data || data.length === 0) && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">Keine Payouts</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---- Open Items Tab ----
function OpenItemsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['finance-open-items'],
    queryFn: async () => {
      const { data: result } = await supabase.rpc('report_open_items');
      return (result as any[]) || [];
    },
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Receipt className="h-5 w-5" /> Offene Posten
        </CardTitle>
        <CardDescription>Unbezahlte oder teilweise bezahlte Bestellungen</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bestellung</TableHead>
              <TableHead>Kunde</TableHead>
              <TableHead className="text-right">Betrag (€)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Datum</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.map((row: any, i: number) => (
              <TableRow key={i}>
                <TableCell className="font-mono text-xs">{(row.order_id || '').slice(0, 8)}…</TableCell>
                <TableCell>{row.billing_name || row.billing_email || '–'}</TableCell>
                <TableCell className="text-right">{fmtEur(row.betrag_eur)}</TableCell>
                <TableCell><Badge variant="destructive">{row.status}</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground">{row.datum}</TableCell>
              </TableRow>
            ))}
            {(!data || data.length === 0) && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">Keine offenen Posten 🎉</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---- Exports Tab ----
function ExportsTab({ from, to }: { from: string; to: string }) {
  const [exporting, setExporting] = useState<string | null>(null);

  const downloadReport = async (report: string, format: string, filename: string) => {
    setExporting(report);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error('Nicht eingeloggt');

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/finance-reports?report=${report}&from=${from}&to=${to}&format=${format}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
      });

      if (!res.ok) throw new Error(await res.text());

      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`${filename} heruntergeladen`);
    } catch (err) {
      toast.error(`Export fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(null);
    }
  };

  const exports = [
    { label: 'Umsatz-Report (CSV)', report: 'revenue', format: 'csv', file: `umsatz_${from}_${to}.csv`, icon: TrendingUp },
    { label: 'USt-Report (CSV)', report: 'vat', format: 'csv', file: `ust_${from}_${to}.csv`, icon: Scale },
    { label: 'Fees & Refunds (CSV)', report: 'fees', format: 'csv', file: `fees_${from}_${to}.csv`, icon: CreditCard },
    { label: 'Produkt-Report (CSV)', report: 'products', format: 'csv', file: `produkte_${from}_${to}.csv`, icon: BarChart3 },
    { label: 'Payouts (CSV)', report: 'payouts', format: 'csv', file: `payouts_${from}_${to}.csv`, icon: Landmark },
    { label: 'DATEV Buchungsstapel', report: 'ledger_csv', format: 'datev', file: `DATEV_${from}_${to}.csv`, icon: FileText },
    { label: 'Ledger Komplett (CSV)', report: 'ledger_csv', format: 'csv', file: `ledger_${from}_${to}.csv`, icon: ArrowUpDown },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {exports.map(exp => {
        const Icon = exp.icon;
        return (
          <Card key={exp.label} className="glass-card">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <div className="font-medium text-sm">{exp.label}</div>
                    <div className="text-xs text-muted-foreground">{from} – {to}</div>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={exporting === exp.report}
                  onClick={() => downloadReport(exp.report, exp.format, exp.file)}
                >
                  <Download className="h-4 w-4 mr-1" />
                  {exporting === exp.report ? '…' : 'Download'}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ---- Main Finance Dashboard ----
export default function FinanceDashboard() {
  const { from, to, setFrom, setTo } = useDateRange();

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold flex items-center gap-3">
            <DollarSign className="h-7 w-7 text-green-500" />
            Finance & Billing
          </h1>
          <p className="text-muted-foreground">Umsatz · USt · Fees · Refunds · Payouts · DATEV Export</p>
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-40" />
          <span className="text-muted-foreground">–</span>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-40" />
        </div>
      </div>

      <Tabs defaultValue="revenue" className="space-y-4">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="revenue" className="gap-1.5"><TrendingUp className="h-4 w-4" /> Umsatz</TabsTrigger>
          <TabsTrigger value="vat" className="gap-1.5"><Scale className="h-4 w-4" /> USt</TabsTrigger>
          <TabsTrigger value="fees" className="gap-1.5"><CreditCard className="h-4 w-4" /> Fees & Refunds</TabsTrigger>
          <TabsTrigger value="products" className="gap-1.5"><BarChart3 className="h-4 w-4" /> Produkte</TabsTrigger>
          <TabsTrigger value="payouts" className="gap-1.5"><Landmark className="h-4 w-4" /> Payouts</TabsTrigger>
          <TabsTrigger value="open" className="gap-1.5"><Receipt className="h-4 w-4" /> Offene Posten</TabsTrigger>
          <TabsTrigger value="exports" className="gap-1.5"><Download className="h-4 w-4" /> Exporte</TabsTrigger>
        </TabsList>
        <TabsContent value="revenue"><RevenueTab from={from} to={to} /></TabsContent>
        <TabsContent value="vat"><VATTab from={from} to={to} /></TabsContent>
        <TabsContent value="fees"><FeesRefundsTab from={from} to={to} /></TabsContent>
        <TabsContent value="products"><ProductsTab from={from} to={to} /></TabsContent>
        <TabsContent value="payouts"><PayoutsTab from={from} to={to} /></TabsContent>
        <TabsContent value="open"><OpenItemsTab /></TabsContent>
        <TabsContent value="exports"><ExportsTab from={from} to={to} /></TabsContent>
      </Tabs>
    </div>
  );
}
