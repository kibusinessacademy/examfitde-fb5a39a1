import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { usePartnerAccount } from '@/hooks/usePartnerSystem';
import { Loader2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PartnerOverviewTab } from '@/components/partner/PartnerOverviewTab';
import { PartnerTrackingLinksTab } from '@/components/partner/PartnerTrackingLinksTab';
import { PartnerCommissionsTab } from '@/components/partner/PartnerCommissionsTab';
import { PartnerPayoutsTab } from '@/components/partner/PartnerPayoutsTab';
import { PartnerLeadsTab } from '@/components/partner/PartnerLeadsTab';
import { PartnerAssetsTab } from '@/components/partner/PartnerAssetsTab';
import { PartnerSettingsTab } from '@/components/partner/PartnerSettingsTab';
import { PartnerContentTab } from '@/components/partner/PartnerContentTab';

export default function PartnerDashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const { data: partnerAccount, isLoading: partnerLoading } = usePartnerAccount();
  const [activeTab, setActiveTab] = useState('overview');

  if (authLoading || partnerLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  const partner = partnerAccount as any;

  if (!partner) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-md p-8">
          <h1 className="text-2xl font-display font-bold mb-4">Partner-Zugang</h1>
          <p className="text-muted-foreground mb-6">
            Du hast noch kein Partner-Konto. Kontaktiere uns, um als Affiliate- oder Agenturpartner zu starten.
          </p>
          <a href="mailto:partner@examfit.de" className="text-primary underline">partner@examfit.de</a>
        </div>
      </div>
    );
  }

  const isAgency = partner.partner_type === 'agency';
  const isPending = partner.status === 'pending';

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background/95 backdrop-blur-sm sticky top-0 z-30">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <span className="text-xl font-display font-bold text-gradient">ExamFit</span>
            <span className="text-sm text-muted-foreground">Partner</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{partner.contact_name || partner.email}</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              partner.status === 'active' ? 'bg-accent/10 text-accent' :
              partner.status === 'pending' ? 'bg-warning/10 text-warning' :
              'bg-destructive/10 text-destructive'
            }`}>
              {partner.status === 'active' ? 'Aktiv' : partner.status === 'pending' ? 'Ausstehend' : partner.status}
            </span>
          </div>
        </div>
      </header>

      {isPending && (
        <div className="bg-warning/10 border-b border-warning/20 py-3 text-center text-sm text-warning">
          Dein Partner-Konto wird derzeit geprüft. Einige Funktionen sind noch eingeschränkt.
        </div>
      )}

      <div className="container py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full flex flex-wrap gap-1 h-auto p-1 mb-6">
            <TabsTrigger value="overview" className="text-xs sm:text-sm">Übersicht</TabsTrigger>
            <TabsTrigger value="links" className="text-xs sm:text-sm">Links</TabsTrigger>
            <TabsTrigger value="commissions" className="text-xs sm:text-sm">Provisionen</TabsTrigger>
            <TabsTrigger value="payouts" className="text-xs sm:text-sm">Payouts</TabsTrigger>
            {isAgency && <TabsTrigger value="leads" className="text-xs sm:text-sm">Leads</TabsTrigger>}
            <TabsTrigger value="content" className="text-xs sm:text-sm">Content Engine</TabsTrigger>
            <TabsTrigger value="assets" className="text-xs sm:text-sm">Werbemittel</TabsTrigger>
            <TabsTrigger value="settings" className="text-xs sm:text-sm">Einstellungen</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <PartnerOverviewTab partnerId={partner.id} partnerType={partner.partner_type} />
          </TabsContent>
          <TabsContent value="links">
            <PartnerTrackingLinksTab partnerId={partner.id} referralCode={partner.referral_code} />
          </TabsContent>
          <TabsContent value="commissions">
            <PartnerCommissionsTab partnerId={partner.id} />
          </TabsContent>
          <TabsContent value="payouts">
            <PartnerPayoutsTab partnerId={partner.id} />
          </TabsContent>
          {isAgency && (
            <TabsContent value="leads">
              <PartnerLeadsTab partnerId={partner.id} />
            </TabsContent>
          )}
          <TabsContent value="content">
            <PartnerContentTab partnerId={partner.id} />
          </TabsContent>
          <TabsContent value="assets">
            <PartnerAssetsTab partnerType={partner.partner_type} />
          </TabsContent>
          <TabsContent value="settings">
            <PartnerSettingsTab partner={partner} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
