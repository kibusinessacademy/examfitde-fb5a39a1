import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Globe, ArrowLeft, Megaphone, TrendingUp, FileText, Image, Link2, Settings, Euro, Share2, BarChart3 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const GrowthSeoCommandCenter = lazy(() => import('@/components/admin/command/GrowthSeoCommandCenter'));
const BlogPostEditor = lazy(() => import('@/components/admin/growth/BlogPostEditor'));
const ContentPageEditor = lazy(() => import('@/components/admin/growth/ContentPageEditor'));
const SEORedirectManager = lazy(() => import('@/components/admin/growth/SEORedirectManager'));
const ContentAssetManager = lazy(() => import('@/components/admin/growth/ContentAssetManager'));
const SocialMediaManager = lazy(() => import('@/components/admin/growth/SocialMediaManager'));
const SEOSettingsManager = lazy(() => import('@/components/admin/growth/SEOSettingsManager'));
const PricingManager = lazy(() => import('@/components/admin/growth/PricingManager'));

const Loading = () => (
  <Card><CardContent className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent></Card>
);

export default function GrowthPage() {
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
          Umfassende Plattform für Content, SEO, Social Media, Pricing und Vertrieb
        </p>
      </div>

      <Tabs defaultValue="dashboard" className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1 rounded-xl">
          <TabsTrigger value="dashboard" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg">
            <BarChart3 className="h-3 w-3" /> Dashboard
          </TabsTrigger>
          <TabsTrigger value="blog" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg">
            <FileText className="h-3 w-3" /> Blog
          </TabsTrigger>
          <TabsTrigger value="pages" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg">
            <Globe className="h-3 w-3" /> Seiten
          </TabsTrigger>
          <TabsTrigger value="seo" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg">
            <Settings className="h-3 w-3" /> SEO
          </TabsTrigger>
          <TabsTrigger value="redirects" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg">
            <Link2 className="h-3 w-3" /> Redirects
          </TabsTrigger>
          <TabsTrigger value="assets" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg">
            <Image className="h-3 w-3" /> Assets
          </TabsTrigger>
          <TabsTrigger value="social" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg">
            <Share2 className="h-3 w-3" /> Social
          </TabsTrigger>
          <TabsTrigger value="pricing" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg">
            <Euro className="h-3 w-3" /> Preise
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-4">
          <Suspense fallback={<Loading />}><GrowthSeoCommandCenter /></Suspense>
        </TabsContent>
        <TabsContent value="blog" className="mt-4">
          <Suspense fallback={<Loading />}><BlogPostEditor /></Suspense>
        </TabsContent>
        <TabsContent value="pages" className="mt-4">
          <Suspense fallback={<Loading />}><ContentPageEditor /></Suspense>
        </TabsContent>
        <TabsContent value="seo" className="mt-4">
          <Suspense fallback={<Loading />}><SEOSettingsManager /></Suspense>
        </TabsContent>
        <TabsContent value="redirects" className="mt-4">
          <Suspense fallback={<Loading />}><SEORedirectManager /></Suspense>
        </TabsContent>
        <TabsContent value="assets" className="mt-4">
          <Suspense fallback={<Loading />}><ContentAssetManager /></Suspense>
        </TabsContent>
        <TabsContent value="social" className="mt-4">
          <Suspense fallback={<Loading />}><SocialMediaManager /></Suspense>
        </TabsContent>
        <TabsContent value="pricing" className="mt-4">
          <Suspense fallback={<Loading />}><PricingManager /></Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
