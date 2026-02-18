import { useState, useMemo } from 'react';
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
import { Progress } from '@/components/ui/progress';
import {
  DollarSign, TrendingUp, Receipt, Download, FileText, RefreshCw,
  AlertTriangle, BarChart3, Landmark, ArrowUpDown, CreditCard, Scale,
  Factory, Clock, CheckCircle2, Loader2, Target
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

// ---- Pipeline Controlling Tab (Soll-Ist) ----
const PIPELINE_STEPS = [
  'scaffold_learning_course',
  'generate_learning_content',
  'validate_learning_content',
  'auto_seed_exam_blueprints',
  'validate_blueprints',
  'generate_exam_pool',
  'validate_exam_pool',
  'generate_oral_exam',
  'validate_oral_exam',
  'build_ai_tutor_index',
  'validate_tutor_index',
  'generate_handbook',
  'validate_handbook',
  'run_integrity_check',
  'quality_council',
  'auto_publish',
];

const STEP_LABELS: Record<string, string> = {
  scaffold_learning_course: 'Lernkurs',
  generate_learning_content: 'Lerninhalte',
  validate_learning_content: 'QG Lernen',
  auto_seed_exam_blueprints: 'Blueprints',
  validate_blueprints: 'QG Blueprints',
  generate_exam_pool: 'Fragenpool',
  validate_exam_pool: 'QG Fragen',
  generate_oral_exam: 'Mündliche',
  validate_oral_exam: 'QG Mündl.',
  build_ai_tutor_index: 'KI-Tutor',
  validate_tutor_index: 'QG Tutor',
  generate_handbook: 'Handbuch',
  validate_handbook: 'QG Handbuch',
  run_integrity_check: 'Integrität',
  quality_council: 'QA Council',
  auto_publish: 'Publish',
};

function PipelineControllingTab() {
  const { data: packages, isLoading } = useQuery({
    queryKey: ['pipeline-controlling-priority'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('course_packages')
        .select('id, title, status, priority, current_step, build_progress, created_at, started_at, published_at, updated_at, step_status_json, track')
        .lte('priority', 20)
        .order('priority')
        .order('created_at');
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30000,
  });

  const { data: costData } = useQuery({
    queryKey: ['pipeline-cost-data'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('llm_cost_events')
        .select('job_type, cost_eur, tokens_in, tokens_out, ts');
      if (error) throw error;
      return {
        totalCost: (data || []).reduce((s: number, r: any) => s + Number(r.cost_eur || 0), 0),
        totalTokens: (data || []).reduce((s: number, r: any) => s + Number(r.tokens_in || 0) + Number(r.tokens_out || 0), 0),
        runs: data?.length || 0,
      };
    },
  });

  const { data: buildingSlotCount } = useQuery({
    queryKey: ['pipeline-building-count'],
    queryFn: async () => {
      const { count } = await supabase
        .from('course_packages')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'building');
      return count || 0;
    },
    refetchInterval: 30000,
  });

  // Analysis
  const analysis = useMemo(() => {
    if (!packages) return null;

    const total = packages.length;
    const published = packages.filter(p => p.status === 'published').length;
    const building = packages.filter(p => p.status === 'building').length;
    const queued = packages.filter(p => p.status === 'queued').length;
    const blocked = packages.filter(p => p.status === 'blocked').length;
    const failed = packages.filter(p => p.status === 'failed').length;
    const remaining = total - published;

    // Estimate throughput from packages that have progress
    const withProgress = packages.filter(p => (p.build_progress || 0) > 0 && p.started_at);
    let avgHoursPerPackage = 24;
    if (withProgress.length > 0) {
      const timings = withProgress.map(p => {
        const start = new Date(p.started_at!).getTime();
        const end = new Date(p.updated_at).getTime();
        const progress = Math.max(p.build_progress || 1, 1);
        return ((end - start) / 3600000) * (100 / progress);
      });
      avgHoursPerPackage = timings.reduce((a, b) => a + b, 0) / timings.length;
    }

    const estimatedRemainingHours = remaining * avgHoursPerPackage;
    const estimatedCompletionDate = new Date(Date.now() + estimatedRemainingHours * 3600000);

    const avgCostPerPackage = costData && costData.runs > 0
      ? costData.totalCost / Math.max(1, packages.filter(p => (p.build_progress || 0) > 0).length || 1)
      : 2.5;
    const projectedTotalCost = avgCostPerPackage * total;

    // Priority breakdown
    const prio10 = packages.filter(p => p.priority === 10);
    const prio15 = packages.filter(p => p.priority === 15);
    const prio20 = packages.filter(p => p.priority === 20);

    return {
      total, published, building, queued, blocked, failed, remaining,
      avgHoursPerPackage: Math.round(avgHoursPerPackage * 10) / 10,
      estimatedRemainingHours: Math.round(estimatedRemainingHours),
      estimatedCompletionDate,
      avgCostPerPackage: Math.round(avgCostPerPackage * 100) / 100,
      projectedTotalCost: Math.round(projectedTotalCost * 100) / 100,
      progressPct: Math.round((published / total) * 100),
      prio10, prio15, prio20,
    };
  }, [packages, costData]);

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'published':
        return <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">✅ Fertig</Badge>;
      case 'building':
        return <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Baut…</Badge>;
      case 'queued':
        return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />Warteschlange</Badge>;
      case 'blocked':
        return <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20">⏸ Blocked</Badge>;
      case 'failed':
        return <Badge variant="destructive">❌ Fehler</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const renderPackageRow = (pkg: any, i: number) => {
    const progress = pkg.build_progress || 0;
    return (
      <TableRow key={pkg.id} className={pkg.status === 'building' ? 'bg-blue-500/5' : pkg.status === 'failed' ? 'bg-destructive/5' : ''}>
        <TableCell className="font-mono text-muted-foreground text-xs">{i + 1}</TableCell>
        <TableCell>
          <div className="font-medium text-sm">{pkg.title?.replace('ExamFit – ', '')}</div>
          {pkg.track && <div className="text-xs text-muted-foreground">{pkg.track}</div>}
        </TableCell>
        <TableCell>{getStatusBadge(pkg.status)}</TableCell>
        <TableCell>
          <div className="flex items-center gap-2 min-w-[140px]">
            <Progress value={progress} className="h-2 flex-1" />
            <span className="text-xs font-mono w-10 text-right">{progress}%</span>
          </div>
        </TableCell>
        <TableCell className="text-right">
          <Badge variant={pkg.priority <= 10 ? 'default' : pkg.priority <= 15 ? 'secondary' : 'outline'}>{pkg.priority}</Badge>
        </TableCell>
      </TableRow>
    );
  };

  return (
    <div className="space-y-6">
      {/* KPIs */}
      {analysis && (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
          <Card className="glass-card border-emerald-500/20">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <div>
                  <div className="text-xl font-bold">{analysis.published}/{analysis.total}</div>
                  <div className="text-xs text-muted-foreground">Fertig</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card border-blue-500/20">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                <div>
                  <div className="text-xl font-bold">{analysis.building}</div>
                  <div className="text-xs text-muted-foreground">In Produktion</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="text-xl font-bold">{analysis.queued}</div>
                  <div className="text-xs text-muted-foreground">Warteschlange</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card border-amber-500/20">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <div>
                  <div className="text-xl font-bold">{analysis.blocked + analysis.failed}</div>
                  <div className="text-xs text-muted-foreground">Blocked/Failed</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card border-primary/20">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2">
                <Factory className="h-4 w-4 text-primary" />
                <div>
                  <div className="text-xl font-bold">
                    {analysis.estimatedCompletionDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
                  </div>
                  <div className="text-xs text-muted-foreground">Prognose</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Interpretation */}
      {analysis && (
        <Card className="glass-card border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" /> Interpretation der Echtdaten
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <p className="font-medium">📊 Pipeline-Status</p>
                <ul className="space-y-1 text-muted-foreground">
                  <li>• <strong>{analysis.building} Pakete</strong> werden gerade aktiv gebaut (von max. 5 Slots)</li>
                  <li>• <strong>{analysis.queued} Pakete</strong> warten in der Warteschlange</li>
                  {analysis.blocked > 0 && (
                    <li className="text-amber-500">• <strong>{analysis.blocked} Pakete blockiert</strong> — fehlende Curriculum-Daten oder Abhängigkeiten</li>
                  )}
                  {analysis.failed > 0 && (
                    <li className="text-destructive">• <strong>{analysis.failed} Pakete fehlgeschlagen</strong> — Retry erforderlich oder manueller Eingriff</li>
                  )}
                </ul>
              </div>
              <div className="space-y-2">
                <p className="font-medium">⏱ Prognose</p>
                <ul className="space-y-1 text-muted-foreground">
                  <li>• Ø Produktionszeit: <strong>~{analysis.avgHoursPerPackage}h</strong> pro Paket</li>
                  <li>• Restliche Produktionszeit: <strong>~{analysis.estimatedRemainingHours}h</strong> ({Math.ceil(analysis.estimatedRemainingHours / 24)} Tage)</li>
                  <li>• Fertigstellung aller {analysis.total} Pakete: <strong>{analysis.estimatedCompletionDate.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' })}</strong></li>
                  <li>• Ø Kosten: <strong>{fmtEur(analysis.avgCostPerPackage)}</strong>/Paket · Gesamt: <strong>{fmtEur(analysis.projectedTotalCost)}</strong></li>
                </ul>
              </div>
            </div>
            <div className="pt-2 border-t border-border/50">
              <p className="text-xs text-muted-foreground">
                💡 <strong>Blocked-Pakete</strong> benötigen ein vorgelagertes Curriculum (Lernfelder & Kompetenzen). 
                Der Factory-Orchestrator löst dies automatisch auf, sobald die Daten verfügbar sind. 
                <strong>Failed-Pakete</strong> können über einen Retry (Status → queued) erneut angestoßen werden.
                Daten aktualisieren sich alle 30 Sekunden.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Soll-Ist Tabelle — Gruppe 1: Prio 10 (Top 10) */}
      {analysis && analysis.prio10.length > 0 && (
        <Card className="glass-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              🥇 Priorität 10 — Top 10 Ausbildungsberufe
            </CardTitle>
            <CardDescription>{analysis.prio10.filter(p => p.status === 'published').length}/{analysis.prio10.length} fertig</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Kurspaket</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Fortschritt</TableHead>
                  <TableHead className="text-right">Prio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analysis.prio10.map((pkg, i) => renderPackageRow(pkg, i))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Prio 15: AEVO */}
      {analysis && analysis.prio15.length > 0 && (
        <Card className="glass-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              🎓 Priorität 15 — AEVO
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Kurspaket</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Fortschritt</TableHead>
                  <TableHead className="text-right">Prio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analysis.prio15.map((pkg, i) => renderPackageRow(pkg, i))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Prio 20: Nächste 10 */}
      {analysis && analysis.prio20.length > 0 && (
        <Card className="glass-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              🥈 Priorität 20 — Nächste 10 Ausbildungsberufe
            </CardTitle>
            <CardDescription>{analysis.prio20.filter(p => p.status === 'published').length}/{analysis.prio20.length} fertig</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Kurspaket</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Fortschritt</TableHead>
                  <TableHead className="text-right">Prio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analysis.prio20.map((pkg, i) => renderPackageRow(pkg, i))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Budget */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="h-4 w-4" /> KI-Budget Soll-Ist
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <div className="text-2xl font-bold">{fmtEur(costData?.totalCost || 0)}</div>
              <div className="text-sm text-muted-foreground">Ist-Kosten (bisher)</div>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <div className="text-2xl font-bold">{fmtEur(analysis?.projectedTotalCost || 0)}</div>
              <div className="text-sm text-muted-foreground">Soll (Prognose {analysis?.total || 0} Pakete)</div>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <div className="text-2xl font-bold">
                {((costData?.totalTokens || 0) / 1000000).toFixed(1)}M
              </div>
              <div className="text-sm text-muted-foreground">Tokens verbraucht</div>
            </div>
          </div>
        </CardContent>
      </Card>
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
            <DollarSign className="h-7 w-7 text-primary" />
            Finance & Controlling
          </h1>
          <p className="text-muted-foreground">Umsatz · USt · Pipeline-Controlling · Exporte</p>
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-40" />
          <span className="text-muted-foreground">–</span>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-40" />
        </div>
      </div>

      <Tabs defaultValue="pipeline" className="space-y-4">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="pipeline" className="gap-1.5"><Factory className="h-4 w-4" /> Pipeline Controlling</TabsTrigger>
          <TabsTrigger value="revenue" className="gap-1.5"><TrendingUp className="h-4 w-4" /> Umsatz</TabsTrigger>
          <TabsTrigger value="vat" className="gap-1.5"><Scale className="h-4 w-4" /> USt</TabsTrigger>
          <TabsTrigger value="fees" className="gap-1.5"><CreditCard className="h-4 w-4" /> Fees & Refunds</TabsTrigger>
          <TabsTrigger value="products" className="gap-1.5"><BarChart3 className="h-4 w-4" /> Produkte</TabsTrigger>
          <TabsTrigger value="payouts" className="gap-1.5"><Landmark className="h-4 w-4" /> Payouts</TabsTrigger>
          <TabsTrigger value="open" className="gap-1.5"><Receipt className="h-4 w-4" /> Offene Posten</TabsTrigger>
          <TabsTrigger value="exports" className="gap-1.5"><Download className="h-4 w-4" /> Exporte</TabsTrigger>
        </TabsList>
        <TabsContent value="pipeline"><PipelineControllingTab /></TabsContent>
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
