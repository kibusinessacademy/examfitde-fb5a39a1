import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { usePartnerDashboardSummary } from '@/hooks/usePartnerSystem';
import { Skeleton } from '@/components/ui/skeleton';
import { MousePointerClick, Users, TrendingUp, Wallet, Clock, CheckCircle, DollarSign, BarChart3 } from 'lucide-react';

interface Props {
  partnerId: string;
  partnerType: string;
}

export function PartnerOverviewTab({ partnerId, partnerType }: Props) {
  const { data: summary, isLoading } = usePartnerDashboardSummary(partnerId);

  if (isLoading) return <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-28" />)}</div>;
  if (!summary) return <p className="text-muted-foreground text-center py-8">Keine Daten verfügbar</p>;

  const stats = [
    { label: 'Klicks (30 Tage)', value: summary.clicks_30d, icon: MousePointerClick, color: 'text-primary' },
    { label: 'Klicks gesamt', value: summary.total_clicks, icon: BarChart3, color: 'text-muted-foreground' },
    { label: 'Conversions', value: summary.total_conversions, icon: TrendingUp, color: 'text-accent' },
    { label: 'Leads', value: summary.total_leads, icon: Users, color: 'text-blue-500' },
    { label: 'Provisionen (offen)', value: `${summary.pending_commissions_eur.toFixed(2)}€`, icon: Clock, color: 'text-orange-500' },
    { label: 'Provisionen (genehmigt)', value: `${summary.approved_commissions_eur.toFixed(2)}€`, icon: CheckCircle, color: 'text-emerald-500' },
    { label: 'Ausgezahlt', value: `${summary.paid_commissions_eur.toFixed(2)}€`, icon: DollarSign, color: 'text-primary' },
    { label: 'Gesamt verdient', value: `${summary.total_commissions_eur.toFixed(2)}€`, icon: Wallet, color: 'text-accent' },
  ];

  const conversionRate = summary.total_clicks > 0 ? ((summary.total_conversions / summary.total_clicks) * 100).toFixed(1) : '0.0';
  const epc = summary.total_clicks > 0 ? (summary.total_commissions_eur / summary.total_clicks).toFixed(2) : '0.00';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="glass-card">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-xs text-muted-foreground font-normal">{label}</CardTitle>
              <Icon className={`h-4 w-4 ${color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="glass-card border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Conversion Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-display font-bold text-gradient">{conversionRate}%</div>
          </CardContent>
        </Card>
        <Card className="glass-card border-accent/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">EPC (Earnings per Click)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-display font-bold text-gradient">{epc}€</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
