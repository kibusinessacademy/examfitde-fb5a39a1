import { lazy, Suspense, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2 } from 'lucide-react';

const StrategyTab = lazy(() => import('@/components/marketing/StrategyTab'));
const ContentEngineTab = lazy(() => import('@/components/marketing/ContentEngineTab'));
const ContentKPITab = lazy(() => import('@/components/marketing/ContentKPITab'));
const B2BLeadsTab = lazy(() => import('@/components/marketing/B2BLeadsTab'));
const CampaignsTab = lazy(() => import('@/components/marketing/CampaignsTab'));
const AssetsTab = lazy(() => import('@/components/marketing/AssetsTab'));
const BudgetTab = lazy(() => import('@/components/marketing/BudgetTab'));
const AffiliatesTab = lazy(() => import('@/components/marketing/AffiliatesTab'));
const ExperimentsTab = lazy(() => import('@/components/marketing/ExperimentsTab'));
const LearningsTab = lazy(() => import('@/components/marketing/LearningsTab'));
const NewsletterTab = lazy(() => import('@/components/marketing/NewsletterTab'));
const BundlesTab = lazy(() => import('@/components/marketing/BundlesTab'));
const PromoCodesTab = lazy(() => import('@/components/marketing/PromoCodesTab'));
const HooksTab = lazy(() => import('@/components/marketing/HooksTab'));

const Fallback = () => <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

export default function MarketingPage() {
  const [activeTab, setActiveTab] = useState('content-engine');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Marketing & Growth Engine</h1>
        <p className="text-muted-foreground">Content-Automation, KPIs, B2B-Leads und Kampagnen</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="content-engine">Content Engine</TabsTrigger>
          <TabsTrigger value="kpi">KPI Dashboard</TabsTrigger>
          <TabsTrigger value="hooks">Hooks</TabsTrigger>
          <TabsTrigger value="b2b">B2B Leads</TabsTrigger>
          <TabsTrigger value="strategy">Strategie</TabsTrigger>
          <TabsTrigger value="campaigns">Kampagnen</TabsTrigger>
          <TabsTrigger value="assets">Assets</TabsTrigger>
          <TabsTrigger value="budget">Budget</TabsTrigger>
          <TabsTrigger value="affiliates">Affiliates</TabsTrigger>
          <TabsTrigger value="experiments">Experimente</TabsTrigger>
          <TabsTrigger value="learnings">Learnings</TabsTrigger>
          <TabsTrigger value="newsletter">Newsletter</TabsTrigger>
          <TabsTrigger value="bundles">Bundles</TabsTrigger>
          <TabsTrigger value="promo">Promo Codes</TabsTrigger>
        </TabsList>

        <Suspense fallback={<Fallback />}>
          <TabsContent value="content-engine"><ContentEngineTab /></TabsContent>
          <TabsContent value="kpi"><ContentKPITab /></TabsContent>
          <TabsContent value="hooks"><HooksTab /></TabsContent>
          <TabsContent value="b2b"><B2BLeadsTab /></TabsContent>
          <TabsContent value="strategy"><StrategyTab /></TabsContent>
          <TabsContent value="campaigns"><CampaignsTab /></TabsContent>
          <TabsContent value="assets"><AssetsTab /></TabsContent>
          <TabsContent value="budget"><BudgetTab /></TabsContent>
          <TabsContent value="affiliates"><AffiliatesTab /></TabsContent>
          <TabsContent value="experiments"><ExperimentsTab /></TabsContent>
          <TabsContent value="learnings"><LearningsTab /></TabsContent>
          <TabsContent value="newsletter"><NewsletterTab /></TabsContent>
          <TabsContent value="bundles"><BundlesTab /></TabsContent>
          <TabsContent value="promo"><PromoCodesTab /></TabsContent>
        </Suspense>
      </Tabs>
    </div>
  );
}
