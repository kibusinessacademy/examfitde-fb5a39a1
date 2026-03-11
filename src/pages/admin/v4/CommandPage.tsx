import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Activity, DollarSign, AlertTriangle, Sparkles, Shield, LayoutDashboard, Radio, CalendarDays, HeartPulse } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import Leitstelle from '@/components/admin/command/Leitstelle';
import RealtimeAlerts from '@/components/admin/RealtimeAlerts';
import PipelineHealthPanel from '@/components/admin/command/PipelineHealthPanel';

const HealthTab = lazy(() => import('@/components/admin/command/HealthTab'));
const CostTab = lazy(() => import('@/components/admin/command/CostTab'));
const ErrorsTab = lazy(() => import('@/components/admin/command/ErrorsTab'));
const CEODailyKPIs = lazy(() => import('@/components/admin/CEODailyKPIs'));
const RealtimePipelineMonitor = lazy(() => import('@/components/admin/RealtimePipelineMonitor'));
const QualityCockpitTab = lazy(() => import('@/components/admin/command/QualityCockpitTab'));
const OpsMonitoringTab = lazy(() => import('@/pages/admin/v4/OpsMonitoringTab'));
const DailyCommandBriefing = lazy(() => import('@/components/admin/command/DailyCommandBriefing'));
const ForensicMonitorPanel = lazy(() => import('@/components/admin/command/ForensicMonitorPanel'));

const Fallback = () => <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;

export default function CommandPage() {
  return (
    <div className="space-y-4">
      <RealtimeAlerts />
      <PipelineHealthPanel />
      <Tabs defaultValue="briefing" className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1 rounded-xl">
          <TabsTrigger value="briefing" className="flex items-center gap-1.5 text-xs lg:text-sm py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg">
            <CalendarDays className="h-3.5 w-3.5" /><span className="hidden sm:inline">Tagesbriefing</span>
          </TabsTrigger>
          <TabsTrigger value="leitstelle" className="flex items-center gap-1.5 text-xs lg:text-sm py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg">
            <LayoutDashboard className="h-3.5 w-3.5" /><span className="hidden sm:inline">Leitstelle</span>
          </TabsTrigger>
          <TabsTrigger value="ops-monitor" className="flex items-center gap-1.5 text-xs lg:text-sm py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg">
            <Radio className="h-3.5 w-3.5" /><span className="hidden sm:inline">OPS Monitor</span>
          </TabsTrigger>
          <TabsTrigger value="pipeline" className="flex items-center gap-1.5 text-xs lg:text-sm py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg">
            <Activity className="h-3.5 w-3.5" /><span className="hidden sm:inline">Pipeline</span>
          </TabsTrigger>
          <TabsTrigger value="health" className="flex items-center gap-1.5 text-xs lg:text-sm py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg">
            <Activity className="h-3.5 w-3.5" /><span className="hidden sm:inline">Health</span>
          </TabsTrigger>
          <TabsTrigger value="cost" className="flex items-center gap-1.5 text-xs lg:text-sm py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg">
            <DollarSign className="h-3.5 w-3.5" /><span className="hidden sm:inline">Cost</span>
          </TabsTrigger>
          <TabsTrigger value="errors" className="flex items-center gap-1.5 text-xs lg:text-sm py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg">
            <AlertTriangle className="h-3.5 w-3.5" /><span className="hidden sm:inline">Errors</span>
          </TabsTrigger>
          <TabsTrigger value="ceo" className="flex items-center gap-1.5 text-xs lg:text-sm py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg">
            <Sparkles className="h-3.5 w-3.5" /><span className="hidden sm:inline">CEO</span>
          </TabsTrigger>
          <TabsTrigger value="mastery" className="flex items-center gap-1.5 text-xs lg:text-sm py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg">
            <Shield className="h-3.5 w-3.5" /><span className="hidden sm:inline">Mastery</span>
          </TabsTrigger>
          <TabsTrigger value="forensik" className="flex items-center gap-1.5 text-xs lg:text-sm py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg">
            <HeartPulse className="h-3.5 w-3.5" /><span className="hidden sm:inline">Forensik</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="briefing" className="mt-4"><Suspense fallback={<Fallback />}><DailyCommandBriefing /></Suspense></TabsContent>
        <TabsContent value="leitstelle" className="mt-4"><Leitstelle /></TabsContent>
        <TabsContent value="ops-monitor" className="mt-4"><Suspense fallback={<Fallback />}><OpsMonitoringTab /></Suspense></TabsContent>
        <TabsContent value="pipeline" className="mt-4"><Suspense fallback={<Fallback />}><RealtimePipelineMonitor /></Suspense></TabsContent>
        <TabsContent value="health" className="mt-4"><Suspense fallback={<Fallback />}><HealthTab /></Suspense></TabsContent>
        <TabsContent value="cost" className="mt-4"><Suspense fallback={<Fallback />}><CostTab /></Suspense></TabsContent>
        <TabsContent value="errors" className="mt-4"><Suspense fallback={<Fallback />}><ErrorsTab /></Suspense></TabsContent>
        <TabsContent value="ceo" className="mt-4"><Suspense fallback={<Fallback />}><CEODailyKPIs /></Suspense></TabsContent>
        <TabsContent value="mastery" className="mt-4"><Suspense fallback={<Fallback />}><QualityCockpitTab /></Suspense></TabsContent>
        <TabsContent value="forensik" className="mt-4"><Suspense fallback={<Fallback />}><ForensicMonitorPanel /></Suspense></TabsContent>
      </Tabs>
    </div>
  );
}
