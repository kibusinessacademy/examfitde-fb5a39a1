import { lazy, Suspense, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2 } from 'lucide-react';

const ContentEngineTab = lazy(() => import('@/components/marketing/ContentEngineTab'));
const ContentKPITab = lazy(() => import('@/components/marketing/ContentKPITab'));
const HooksTab = lazy(() => import('@/components/marketing/HooksTab'));
const B2BLeadsTab = lazy(() => import('@/components/marketing/B2BLeadsTab'));

const Fallback = () => (
  <div className="flex justify-center py-12">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

export default function MarketingPage() {
  const [activeTab, setActiveTab] = useState('content-engine');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Marketing & Growth Engine</h1>
        <p className="text-muted-foreground">Content-Automation, KPIs, B2B-Leads und Hooks</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="content-engine">Content Engine</TabsTrigger>
          <TabsTrigger value="kpi">KPI Dashboard</TabsTrigger>
          <TabsTrigger value="hooks">Hooks</TabsTrigger>
          <TabsTrigger value="b2b">B2B Leads</TabsTrigger>
        </TabsList>

        <Suspense fallback={<Fallback />}>
          <TabsContent value="content-engine"><ContentEngineTab /></TabsContent>
          <TabsContent value="kpi"><ContentKPITab /></TabsContent>
          <TabsContent value="hooks"><HooksTab /></TabsContent>
          <TabsContent value="b2b"><B2BLeadsTab /></TabsContent>
        </Suspense>
      </Tabs>
    </div>
  );
}
