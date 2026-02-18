import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Activity, Award, DollarSign, AlertTriangle, TrendingUp, Cpu, Users, BookOpen, BarChart3, Shield, Sparkles, LayoutDashboard } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import Leitstelle from '@/components/admin/command/Leitstelle';
import RealtimeAlerts from '@/components/admin/RealtimeAlerts';

const HealthTab = lazy(() => import('@/components/admin/command/HealthTab'));
const QualityTab = lazy(() => import('@/components/admin/command/QualityTab'));
const CostTab = lazy(() => import('@/components/admin/command/CostTab'));
const ErrorsTab = lazy(() => import('@/components/admin/command/ErrorsTab'));
const RoiTab = lazy(() => import('@/components/admin/command/RoiTab'));
const RoutingTab = lazy(() => import('@/components/admin/command/RoutingTab'));
const SeatsTab = lazy(() => import('@/components/admin/command/SeatsTab'));
const ExamQualityTab = lazy(() => import('@/components/admin/command/ExamQualityTab'));
const OutcomeKPIsTab = lazy(() => import('@/components/admin/command/OutcomeKPIsTab'));
const ProductionSafetyNet = lazy(() => import('@/components/admin/ProductionSafetyNet'));
const CEODailyKPIs = lazy(() => import('@/components/admin/CEODailyKPIs'));
const RealtimePipelineMonitor = lazy(() => import('@/components/admin/RealtimePipelineMonitor'));

const Fallback = () => <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;

export default function CommandPage() {
  return (
    <div className="space-y-4">
      <RealtimeAlerts />

      <Tabs defaultValue="leitstelle" className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="leitstelle" className="flex items-center gap-1.5 text-xs lg:text-sm py-2">
            <LayoutDashboard className="h-3.5 w-3.5" /><span className="hidden sm:inline">Leitstelle</span>
          </TabsTrigger>
          <TabsTrigger value="pipeline" className="flex items-center gap-1.5 text-xs lg:text-sm py-2">
            <Activity className="h-3.5 w-3.5" /><span className="hidden sm:inline">Pipeline</span>
          </TabsTrigger>
          <TabsTrigger value="health" className="flex items-center gap-1.5 text-xs lg:text-sm py-2">
            <Activity className="h-3.5 w-3.5" /><span className="hidden sm:inline">Health</span>
          </TabsTrigger>
          <TabsTrigger value="cost" className="flex items-center gap-1.5 text-xs lg:text-sm py-2">
            <DollarSign className="h-3.5 w-3.5" /><span className="hidden sm:inline">Cost</span>
          </TabsTrigger>
          <TabsTrigger value="errors" className="flex items-center gap-1.5 text-xs lg:text-sm py-2">
            <AlertTriangle className="h-3.5 w-3.5" /><span className="hidden sm:inline">Errors</span>
          </TabsTrigger>
          <TabsTrigger value="ceo" className="flex items-center gap-1.5 text-xs lg:text-sm py-2">
            <Sparkles className="h-3.5 w-3.5" /><span className="hidden sm:inline">CEO</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="leitstelle" className="mt-4"><Leitstelle /></TabsContent>
        <TabsContent value="pipeline" className="mt-4"><Suspense fallback={<Fallback />}><RealtimePipelineMonitor /></Suspense></TabsContent>
        <TabsContent value="health" className="mt-4"><Suspense fallback={<Fallback />}><HealthTab /></Suspense></TabsContent>
        <TabsContent value="cost" className="mt-4"><Suspense fallback={<Fallback />}><CostTab /></Suspense></TabsContent>
        <TabsContent value="errors" className="mt-4"><Suspense fallback={<Fallback />}><ErrorsTab /></Suspense></TabsContent>
        <TabsContent value="ceo" className="mt-4"><Suspense fallback={<Fallback />}><CEODailyKPIs /></Suspense></TabsContent>
      </Tabs>
    </div>
  );
}
