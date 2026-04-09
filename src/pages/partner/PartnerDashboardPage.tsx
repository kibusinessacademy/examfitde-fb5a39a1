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

  const isAgency = partnerAccount.partner_type === 'agency';
  const isPending = partnerAccount.status === 'pending';

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur-sm sticky top-0 z-30">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <span className="text-xl font-display font-bold text-gradient">ExamFit</span>
            <span className="text-sm text-muted-foreground">Partner</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{partnerAccount.contact_name || partnerAccount.email}</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              partnerAccount.status === 'active' ? 'bg-emerald-500/10 text-emerald-500' :
              partnerAccount.status === 'pending' ? 'bg-orange-500/10 text-orange-500' :
              'bg-destructive/10 text-destructive'
            }`}>
              {partnerAccount.status === 'active' ? 'Aktiv' : partnerAccount.status === 'pending' ? 'Ausstehend' : partnerAccount.status}
            </span>
          </div>
        </div>
      </header>

      {isPending && (
        <div className="bg-orange-500/10 border-b border-orange-500/20 py-3 text-center text-sm text-orange-600">
          Dein Partner-Konto wird derzeit geprüft. Einige Funktionen sind noch eingeschränkt.
        </div>
      )}

      <div className="container py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4 sm:grid-cols-7 mb-6">
            <TabsTrigger value="overview">Übersicht</TabsTrigger>
            <TabsTrigger value="links">Links</TabsTrigger>
            <TabsTrigger value="commissions">Provisionen</TabsTrigger>
            <TabsTrigger value="payouts">Payouts</TabsTrigger>
            {isAgency && <TabsTrigger value="leads">Leads</TabsTrigger>}
            <TabsTrigger value="assets">Werbemittel</TabsTrigger>
            <TabsTrigger value="settings">Einstellungen</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <PartnerOverviewTab partnerId={partnerAccount.id} partnerType={partnerAccount.partner_type} />
          </TabsContent>
          <TabsContent value="links">
            <PartnerTrackingLinksTab partnerId={partnerAccount.id} referralCode={partnerAccount.referral_code} />
          </TabsContent>
          <TabsContent value="commissions">
            <PartnerCommissionsTab partnerId={partnerAccount.id} />
          </TabsContent>
          <TabsContent value="payouts">
            <PartnerPayoutsTab partnerId={partnerAccount.id} />
          </TabsContent>
          {isAgency && (
            <TabsContent value="leads">
              <PartnerLeadsTab partnerId={partnerAccount.id} />
            </TabsContent>
          )}
          <TabsContent value="assets">
            <PartnerAssetsTab partnerType={partnerAccount.partner_type} />
          </TabsContent>
          <TabsContent value="settings">
            <PartnerSettingsTab partner={partnerAccount} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
