import { lazy, Suspense, useState } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, DollarSign } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useEffect } from 'react';
import PageExplainer from '@/components/admin/PageExplainer';

const FinanceDashboard = lazy(() => import('@/pages/admin/FinanceDashboard'));
const EnterpriseSeatManagement = lazy(() => import('@/pages/admin/EnterpriseSeatManagement'));
const AuditExportsPage = lazy(() => import('@/pages/admin/AuditExportsPage'));

const Loading = () => (
  <div className="flex items-center justify-center py-16">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

const tabs = [
  { path: '/admin/business', label: 'Umsatz' },
  { path: '/admin/business/licenses', label: 'Lizenzen' },
  { path: '/admin/business/exports', label: 'Steuer-Export' },
];

/* ── CSV Export ── */
function SteuerExport() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from('orders')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);
      setOrders(data || []);
      setLoading(false);
    })();
  }, []);

  const handleCSVExport = () => {
    const headers = ['Datum', 'OrderID', 'Produkt', 'Betrag', 'Netto', 'Steuer', 'Brutto', 'Land', 'Rechnungsempfänger'];
    const rows = orders.map(o => [
      new Date(o.created_at).toLocaleDateString('de-DE'),
      o.id,
      o.product_name || o.product_id || '–',
      `${((o.amount_cents || 0) / 100).toFixed(2).replace('.', ',')} €`,
      `${((o.net_cents || o.amount_cents || 0) / 100).toFixed(2).replace('.', ',')} €`,
      `${((o.tax_cents || 0) / 100).toFixed(2).replace('.', ',')} €`,
      `${((o.gross_cents || o.amount_cents || 0) / 100).toFixed(2).replace('.', ',')} €`,
      o.country || 'DE',
      o.customer_name || o.customer_email || '–',
    ]);

    const csv = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const bom = '\uFEFF';
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `steuer-export-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV-Export heruntergeladen');
  };

  if (loading) return <Loading />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Download className="h-4 w-4" /> Steuer-Export
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            UTF-8, Semikolon-getrennt, EUR-Format. Spalten: Datum, OrderID, Produkt, Betrag, Netto, Steuer, Brutto, Land, Rechnungsempfänger.
          </p>
          <div className="flex gap-2">
            <Button onClick={handleCSVExport} size="sm">
              <Download className="h-3.5 w-3.5 mr-1" /> CSV exportieren ({orders.length} Bestellungen)
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function BusinessPage() {
  const location = useLocation();
  const activeTab = tabs.find(t => location.pathname === t.path)?.path ||
    tabs.find(t => location.pathname.startsWith(t.path) && t.path !== '/admin/business')?.path ||
    tabs[0].path;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Finanzen & Geschäft</h1>
        <p className="text-sm text-muted-foreground">Umsatz, Lizenzen, Steuer-Exporte</p>
      </div>

      <PageExplainer
        title="Wie funktioniert Finanzen & Geschäft?"
        description="Das kaufmännische Cockpit der Plattform. Hier siehst du Umsatzentwicklung, verwaltest Enterprise-Lizenzen und erstellst steuerlich konforme Exporte für den Steuerberater."
        workflow={[
          { label: 'Leitstelle' },
          { label: 'Studio' },
          { label: 'Quality' },
          { label: 'Ops' },
          { label: 'Business', active: true },
          { label: 'Growth' },
          { label: 'Scale' },
        ]}
        actions={[
          '"Umsatz" – Revenue-Dashboard mit MRR, Bestellungen und Produktumsätzen',
          '"Lizenzen" – Enterprise Seat Management: Seats zuweisen, Nutzung überwachen, Renewals tracken',
          '"Steuer-Export" – CSV-Export (UTF-8, Semikolon, EUR-Format) aller Bestellungen für DATEV/Steuerberater',
        ]}
        tips={[
          'Der CSV-Export enthält Netto/Brutto/Steuer aufgeschlüsselt pro Bestellung',
          'Enterprise-Lizenzen haben Seat-Limits und Renewal-Daten',
        ]}
      />

      <div className="overflow-x-auto">
        <div className="flex gap-1 border-b border-border pb-px min-w-max">
          {tabs.map(tab => (
            <Link
              key={tab.path}
              to={tab.path}
              className={cn(
                "px-3 py-2 text-sm rounded-t-md transition-colors",
                activeTab === tab.path
                  ? "bg-primary/10 text-primary font-medium border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>

      <Suspense fallback={<Loading />}>
        <Routes>
          <Route index element={<FinanceDashboard />} />
          <Route path="licenses" element={<EnterpriseSeatManagement />} />
          <Route path="exports" element={<SteuerExport />} />
        </Routes>
      </Suspense>
    </div>
  );
}
