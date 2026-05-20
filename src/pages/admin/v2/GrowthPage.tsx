import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Globe, ArrowLeft, BarChart3, FileText, Image, Link2, Settings, Euro, Share2, Search, Target, RefreshCw, Radar, Zap, Rocket, Tag, Music, Laugh, Activity, ScrollText } from 'lucide-react';
const PostPublishGrowthFanoutCard = lazy(() => import('@/components/admin/growth/PostPublishGrowthFanoutCard'));
const PostPublishGrowthHealthCard = lazy(() => import('@/components/admin/growth/PostPublishGrowthHealthCard'));
const GrowthQualityScoreCard = lazy(() => import('@/components/admin/growth/GrowthQualityScoreCard'));
const GrowthRepairFoundationCard = lazy(() => import('@/components/admin/growth/GrowthRepairFoundationCard'));
const GrowthNextBestFixCard = lazy(() => import('@/components/admin/growth/GrowthNextBestFixCard'));
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const GrowthDashboardOverview = lazy(() => import('@/components/admin/growth/GrowthDashboardOverview'));

const GrowthSeoCommandCenter = lazy(() => import('@/components/admin/command/GrowthSeoCommandCenter'));
const BlogPostEditor = lazy(() => import('@/components/admin/growth/BlogPostEditor'));
const ContentPageEditor = lazy(() => import('@/components/admin/growth/ContentPageEditor'));
const SEORedirectManager = lazy(() => import('@/components/admin/growth/SEORedirectManager'));
const ContentAssetManager = lazy(() => import('@/components/admin/growth/ContentAssetManager'));
const SocialMediaManager = lazy(() => import('@/components/admin/growth/SocialMediaManager'));
const SEOSettingsManager = lazy(() => import('@/components/admin/growth/SEOSettingsManager'));
const PricingManager = lazy(() => import('@/components/admin/growth/PricingManager'));
const PricingIntegrityCard = lazy(() => import('@/components/admin/growth/PricingIntegrityCard'));
const FunnelIntegrityCard = lazy(() => import('@/components/admin/growth/FunnelIntegrityCard'));
const FunnelAnalyticsCard = lazy(() => import('@/components/admin/growth/FunnelAnalyticsCard'));
const PruefungsreifeFunnelCard = lazy(() => import('@/components/admin/growth/PruefungsreifeFunnelCard'));
const PostPurchaseActivationCard = lazy(() => import('@/components/admin/growth/PostPurchaseActivationCard').then(m => ({ default: m.PostPurchaseActivationCard })));
const ActivationAssuranceCard = lazy(() => import('@/components/admin/growth/ActivationAssuranceCard').then(m => ({ default: m.ActivationAssuranceCard })));
const ActivationNudgeDispatcherCard = lazy(() => import('@/components/admin/growth/ActivationNudgeDispatcherCard').then(m => ({ default: m.ActivationNudgeDispatcherCard })));
const PlatformIntegrityCard = lazy(() => import('@/components/admin/growth/PlatformIntegrityCard'));
const KeywordStrategyManager = lazy(() => import('@/components/admin/growth/KeywordStrategyManager'));
const ContentBriefManager = lazy(() => import('@/components/admin/growth/ContentBriefManager'));
const InternalLinkManager = lazy(() => import('@/components/admin/growth/InternalLinkManager'));
const RefreshQueueManager = lazy(() => import('@/components/admin/growth/RefreshQueueManager'));
const SEOAuditManager = lazy(() => import('@/components/admin/growth/SEOAuditManager'));
const LlmVisibilityCard = lazy(() => import('@/features/admin/components/LlmVisibilityCard').then(m => ({ default: m.LlmVisibilityCard })));
const SemanticGraphCrawlHealthCard = lazy(() => import('@/features/admin/components/SemanticGraphCrawlHealthCard').then(m => ({ default: m.SemanticGraphCrawlHealthCard })));
const SemanticSearchFeedbackCard = lazy(() => import('@/features/admin/components/SemanticSearchFeedbackCard').then(m => ({ default: m.SemanticSearchFeedbackCard })));
const SeoDeadEndDriftCard = lazy(() => import('@/features/admin/components/SeoDeadEndDriftCard').then(m => ({ default: m.SeoDeadEndDriftCard })));
const SeoCanonicalParityCard = lazy(() => import('@/components/admin/growth/SeoCanonicalParityCard'));
const GrowthGraphLeitstelleCard = lazy(() => import('@/components/admin/growth/GrowthGraphLeitstelleCard'));
const GrowthGraphHealthStatusCard = lazy(() => import('@/components/admin/growth/GrowthGraphHealthStatusCard'));
const TutorIndexNoIndexHealCard = lazy(() => import('@/components/admin/growth/TutorIndexNoIndexHealCard'));
const FunnelDropoffHeatmapCard = lazy(() => import('@/components/admin/growth/FunnelDropoffHeatmapCard'));
const CtaPerformanceCard = lazy(() => import('@/components/admin/growth/CtaPerformanceCard'));
const SEODiscoveryManager = lazy(() => import('@/components/admin/growth/SEODiscoveryManager'));
const GrowthLoopManager = lazy(() => import('@/components/admin/growth/GrowthLoopManager'));
const PromoCodesPanel = lazy(() => import('@/components/admin/marketing/AdminPromoCodesPanel'));
const SongsDashboard = lazy(() => import('@/components/admin/songs/SongsDashboard'));
const HumorQCPage = lazy(() => import('@/pages/admin/v2/HumorQCPage'));
const MarketingIntelligencePanel = lazy(() => import('@/components/admin/marketing/MarketingIntelligencePanel'));

const Loading = () => (
  <Card><CardContent className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent></Card>
);

export default function GrowthPage() {
  const [tab, setTab] = useState('dashboard');
  return (
    <div className="space-y-4">
      <div>
        <Link to="/admin/command" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1 transition-colors">
          <ArrowLeft className="h-3 w-3" /> Leitstelle
        </Link>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Globe className="h-5 w-5 text-primary" />
          Growth · SEO · Marketing
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Content Operating System – Keywords, Briefs, Audits, Discovery, Conversion, Growth Loop
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1 rounded-xl">
          <TabsTrigger value="dashboard" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg"><BarChart3 className="h-3 w-3" /> Dashboard</TabsTrigger>
          <TabsTrigger value="growth" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg"><Rocket className="h-3 w-3" /> Growth Loop</TabsTrigger>
          <TabsTrigger value="keywords" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg"><Search className="h-3 w-3" /> Keywords</TabsTrigger>
          <TabsTrigger value="briefs" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg"><Target className="h-3 w-3" /> Briefs</TabsTrigger>
          <TabsTrigger value="blog" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg"><FileText className="h-3 w-3" /> Blog</TabsTrigger>
          <TabsTrigger value="pages" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg"><Globe className="h-3 w-3" /> Seiten</TabsTrigger>
          <TabsTrigger value="links" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg"><Link2 className="h-3 w-3" /> Links</TabsTrigger>
          <TabsTrigger value="audit" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg"><Zap className="h-3 w-3" /> Audit</TabsTrigger>
          <TabsTrigger value="refresh" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg"><RefreshCw className="h-3 w-3" /> Refresh</TabsTrigger>
          <TabsTrigger value="discovery" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg"><Radar className="h-3 w-3" /> Discovery</TabsTrigger>
          <TabsTrigger value="seo" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg"><Settings className="h-3 w-3" /> SEO</TabsTrigger>
          <TabsTrigger value="redirects" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg"><Link2 className="h-3 w-3" /> Redirects</TabsTrigger>
          <TabsTrigger value="assets" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg"><Image className="h-3 w-3" /> Assets</TabsTrigger>
          <TabsTrigger value="social" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg"><Share2 className="h-3 w-3" /> Social</TabsTrigger>
          <TabsTrigger value="pricing" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg"><Euro className="h-3 w-3" /> Preise</TabsTrigger>
          <TabsTrigger value="promo" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg"><Tag className="h-3 w-3" /> Promo</TabsTrigger>
          <TabsTrigger value="songs" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg"><Music className="h-3 w-3" /> Songs</TabsTrigger>
          <TabsTrigger value="humor" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg"><Laugh className="h-3 w-3" /> Humor QC</TabsTrigger>
          <TabsTrigger value="intel" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg data-[state=active]:text-primary"><Activity className="h-3 w-3" /> Marketing-Intel</TabsTrigger>
          <TabsTrigger value="fanout" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg"><ScrollText className="h-3 w-3" /> Post-Publish Fanout</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-4 space-y-4">
          <Suspense fallback={<Loading />}><GrowthDashboardOverview onTabSwitch={setTab} /></Suspense>
          <Suspense fallback={<Loading />}><PostPurchaseActivationCard /></Suspense>
          <Suspense fallback={<Loading />}><ActivationAssuranceCard /></Suspense>
          <Suspense fallback={<Loading />}><ActivationNudgeDispatcherCard /></Suspense>
          <Suspense fallback={<Loading />}><FunnelAnalyticsCard /></Suspense>
          <Suspense fallback={<Loading />}><PruefungsreifeFunnelCard /></Suspense>
          <Suspense fallback={<Loading />}><CtaPerformanceCard /></Suspense>
          <Suspense fallback={<Loading />}><FunnelDropoffHeatmapCard /></Suspense>
          <Suspense fallback={<Loading />}><PlatformIntegrityCard /></Suspense>
          <Suspense fallback={<Loading />}><FunnelIntegrityCard /></Suspense>
          <Suspense fallback={<Loading />}><GrowthSeoCommandCenter /></Suspense>
        </TabsContent>
        <TabsContent value="growth" className="mt-4"><Suspense fallback={<Loading />}><GrowthLoopManager /></Suspense></TabsContent>
        <TabsContent value="keywords" className="mt-4"><Suspense fallback={<Loading />}><KeywordStrategyManager /></Suspense></TabsContent>
        <TabsContent value="briefs" className="mt-4"><Suspense fallback={<Loading />}><ContentBriefManager /></Suspense></TabsContent>
        <TabsContent value="blog" className="mt-4"><Suspense fallback={<Loading />}><BlogPostEditor /></Suspense></TabsContent>
        <TabsContent value="pages" className="mt-4"><Suspense fallback={<Loading />}><ContentPageEditor /></Suspense></TabsContent>
        <TabsContent value="links" className="mt-4"><Suspense fallback={<Loading />}><InternalLinkManager /></Suspense></TabsContent>
        <TabsContent value="audit" className="mt-4 space-y-4">
          <Suspense fallback={<Loading />}><GrowthGraphHealthStatusCard /></Suspense>
          <Suspense fallback={<Loading />}><TutorIndexNoIndexHealCard /></Suspense>
          <Suspense fallback={<Loading />}><GrowthGraphLeitstelleCard /></Suspense>
          <Suspense fallback={<Loading />}><SeoCanonicalParityCard /></Suspense>
          <Suspense fallback={<Loading />}><SeoDeadEndDriftCard /></Suspense>
          <Suspense fallback={<Loading />}><SemanticGraphCrawlHealthCard /></Suspense>
          <Suspense fallback={<Loading />}><SemanticSearchFeedbackCard /></Suspense>
          <Suspense fallback={<Loading />}><LlmVisibilityCard /></Suspense>
          <Suspense fallback={<Loading />}><SEOAuditManager /></Suspense>
        </TabsContent>
        <TabsContent value="refresh" className="mt-4"><Suspense fallback={<Loading />}><RefreshQueueManager /></Suspense></TabsContent>
        <TabsContent value="discovery" className="mt-4"><Suspense fallback={<Loading />}><SEODiscoveryManager /></Suspense></TabsContent>
        <TabsContent value="seo" className="mt-4"><Suspense fallback={<Loading />}><SEOSettingsManager /></Suspense></TabsContent>
        <TabsContent value="redirects" className="mt-4"><Suspense fallback={<Loading />}><SEORedirectManager /></Suspense></TabsContent>
        <TabsContent value="assets" className="mt-4"><Suspense fallback={<Loading />}><ContentAssetManager /></Suspense></TabsContent>
        <TabsContent value="social" className="mt-4"><Suspense fallback={<Loading />}><SocialMediaManager /></Suspense></TabsContent>
        <TabsContent value="pricing" className="mt-4 space-y-4">
          <Suspense fallback={<Loading />}><PricingIntegrityCard /></Suspense>
          <Suspense fallback={<Loading />}><PricingManager /></Suspense>
        </TabsContent>
        <TabsContent value="promo" className="mt-4"><Suspense fallback={<Loading />}><PromoCodesPanel /></Suspense></TabsContent>
        <TabsContent value="songs" className="mt-4"><Suspense fallback={<Loading />}><SongsDashboard /></Suspense></TabsContent>
        <TabsContent value="humor" className="mt-4"><Suspense fallback={<Loading />}><HumorQCPage /></Suspense></TabsContent>
        <TabsContent value="intel" className="mt-4"><Suspense fallback={<Loading />}><MarketingIntelligencePanel /></Suspense></TabsContent>
        <TabsContent value="fanout" className="mt-4 space-y-4">
          <Suspense fallback={<Loading />}><PostPublishGrowthHealthCard /></Suspense>
          <Suspense fallback={<Loading />}><GrowthQualityScoreCard /></Suspense>
          <Suspense fallback={<Loading />}><GrowthNextBestFixCard /></Suspense>
          <Suspense fallback={<Loading />}><GrowthRepairFoundationCard /></Suspense>
          <Suspense fallback={<Loading />}><PostPublishGrowthFanoutCard /></Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
