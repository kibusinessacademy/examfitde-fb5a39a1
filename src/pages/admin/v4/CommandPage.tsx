import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Activity, DollarSign, AlertTriangle, Sparkles, Shield, LayoutDashboard, Radio } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import Leitstelle from '@/components/admin/command/Leitstelle';
import RealtimeAlerts from '@/components/admin/RealtimeAlerts';

const HealthTab = lazy(() => import('@/components/admin/command/HealthTab'));
const CostTab = lazy(() => import('@/components/admin/command/CostTab'));
const ErrorsTab = lazy(() => import('@/components/admin/command/ErrorsTab'));
const CEODailyKPIs = lazy(() => import('@/components/admin/CEODailyKPIs'));
const RealtimePipelineMonitor = lazy(() => import('@/components/admin/RealtimePipelineMonitor'));
const QualityCockpitTab = lazy(() => import('@/components/admin/command/QualityCockpitTab'));
const OpsMonitoringTab = lazy(() => import('@/pages/admin/v4/OpsMonitoringTab'));

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
          <TabsTrigger value="ops-monitor" className="flex items-center gap-1.5 text-xs lg:text-sm py-2">
            <Radio className="h-3.5 w-3.5" /><span className="hidden sm:inline">OPS Monitor</span>
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
          <TabsTrigger value="mastery" className="flex items-center gap-1.5 text-xs lg:text-sm py-2">
            <Shield className="h-3.5 w-3.5" /><span className="hidden sm:inline">Mastery</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="leitstelle" className="mt-4"><Leitstelle /></TabsContent>
        <TabsContent value="ops-monitor" className="mt-4"><Suspense fallback={<Fallback />}><OpsMonitoringTab /></Suspense></TabsContent>
        <TabsContent value="pipeline" className="mt-4"><Suspense fallback={<Fallback />}><RealtimePipelineMonitor /></Suspense></TabsContent>
        <TabsContent value="health" className="mt-4"><Suspense fallback={<Fallback />}><HealthTab /></Suspense></TabsContent>
        <TabsContent value="cost" className="mt-4"><Suspense fallback={<Fallback />}><CostTab /></Suspense></TabsContent>
        <TabsContent value="errors" className="mt-4"><Suspense fallback={<Fallback />}><ErrorsTab /></Suspense></TabsContent>
        <TabsContent value="ceo" className="mt-4"><Suspense fallback={<Fallback />}><CEODailyKPIs /></Suspense></TabsContent>
        <TabsContent value="mastery" className="mt-4"><Suspense fallback={<Fallback />}><QualityCockpitTab /></Suspense></TabsContent>
      </Tabs>
    </div>
  );
}
