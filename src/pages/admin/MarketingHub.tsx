import { lazy, Suspense } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  BarChart3, 
  Tag, 
  Megaphone, 
  FileText, 
  FlaskConical, 
  Wallet, 
  Lightbulb,
  Package,
  Mail,
  Users
} from 'lucide-react';

const StrategyTab = lazy(() => import('@/components/marketing/StrategyTab'));
const CampaignsTab = lazy(() => import('@/components/marketing/CampaignsTab'));
const AssetsTab = lazy(() => import('@/components/marketing/AssetsTab'));
const ExperimentsTab = lazy(() => import('@/components/marketing/ExperimentsTab'));
const BudgetTab = lazy(() => import('@/components/marketing/BudgetTab'));
const LearningsTab = lazy(() => import('@/components/marketing/LearningsTab'));
const PromoCodesTab = lazy(() => import('@/components/marketing/PromoCodesTab'));
const BundlesTab = lazy(() => import('@/components/marketing/BundlesTab'));
const NewsletterTab = lazy(() => import('@/components/marketing/NewsletterTab'));
const AffiliatesTab = lazy(() => import('@/components/marketing/AffiliatesTab'));

const TabFallback = () => <Skeleton className="h-64 w-full" />;

export default function MarketingHub() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold">Marketing & Sales Council</h1>
        <p className="text-muted-foreground">
          Plan → Test → Measure → Learn → Optimize → Scale
        </p>
      </div>

      <Tabs defaultValue="strategy" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="strategy" className="gap-1.5 text-xs">
            <BarChart3 className="h-3.5 w-3.5" /> Strategie
          </TabsTrigger>
          <TabsTrigger value="campaigns" className="gap-1.5 text-xs">
            <Megaphone className="h-3.5 w-3.5" /> Kampagnen
          </TabsTrigger>
          <TabsTrigger value="assets" className="gap-1.5 text-xs">
            <FileText className="h-3.5 w-3.5" /> Assets
          </TabsTrigger>
          <TabsTrigger value="experiments" className="gap-1.5 text-xs">
            <FlaskConical className="h-3.5 w-3.5" /> Experimente
          </TabsTrigger>
          <TabsTrigger value="budget" className="gap-1.5 text-xs">
            <Wallet className="h-3.5 w-3.5" /> Budget
          </TabsTrigger>
          <TabsTrigger value="learnings" className="gap-1.5 text-xs">
            <Lightbulb className="h-3.5 w-3.5" /> Learnings
          </TabsTrigger>
          <TabsTrigger value="promo-codes" className="gap-1.5 text-xs">
            <Tag className="h-3.5 w-3.5" /> Promos
          </TabsTrigger>
          <TabsTrigger value="bundles" className="gap-1.5 text-xs">
            <Package className="h-3.5 w-3.5" /> Bundles
          </TabsTrigger>
          <TabsTrigger value="newsletter" className="gap-1.5 text-xs">
            <Mail className="h-3.5 w-3.5" /> Newsletter
          </TabsTrigger>
          <TabsTrigger value="affiliates" className="gap-1.5 text-xs">
            <Users className="h-3.5 w-3.5" /> Affiliates
          </TabsTrigger>
        </TabsList>

        <Suspense fallback={<TabFallback />}>
          <TabsContent value="strategy"><StrategyTab /></TabsContent>
          <TabsContent value="campaigns"><CampaignsTab /></TabsContent>
          <TabsContent value="assets"><AssetsTab /></TabsContent>
          <TabsContent value="experiments"><ExperimentsTab /></TabsContent>
          <TabsContent value="budget"><BudgetTab /></TabsContent>
          <TabsContent value="learnings"><LearningsTab /></TabsContent>
          <TabsContent value="promo-codes"><PromoCodesTab /></TabsContent>
          <TabsContent value="bundles"><BundlesTab /></TabsContent>
          <TabsContent value="newsletter"><NewsletterTab /></TabsContent>
          <TabsContent value="affiliates"><AffiliatesTab /></TabsContent>
        </Suspense>
      </Tabs>
    </div>
  );
}
