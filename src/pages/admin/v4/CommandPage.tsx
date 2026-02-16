import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Activity, Award, DollarSign, AlertTriangle, TrendingUp, Cpu, Users, BookOpen } from 'lucide-react';
import HealthTab from '@/components/admin/command/HealthTab';
import QualityTab from '@/components/admin/command/QualityTab';
import CostTab from '@/components/admin/command/CostTab';
import ErrorsTab from '@/components/admin/command/ErrorsTab';
import RoiTab from '@/components/admin/command/RoiTab';
import RoutingTab from '@/components/admin/command/RoutingTab';
import SeatsTab from '@/components/admin/command/SeatsTab';
import ExamQualityTab from '@/components/admin/command/ExamQualityTab';
import RealtimePipelineMonitor from '@/components/admin/RealtimePipelineMonitor';
import RealtimeAlerts from '@/components/admin/RealtimeAlerts';

export default function CommandPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl lg:text-2xl font-display font-bold text-foreground">Leitstelle</h1>

      {/* Live Pipeline + Alerts direkt oben */}
      <RealtimeAlerts />
      <RealtimePipelineMonitor />

      <Tabs defaultValue="health" className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="health" className="flex items-center gap-1.5 text-xs lg:text-sm py-2">
            <Activity className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Health</span>
          </TabsTrigger>
          <TabsTrigger value="quality" className="flex items-center gap-1.5 text-xs lg:text-sm py-2">
            <Award className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Quality</span>
          </TabsTrigger>
          <TabsTrigger value="cost" className="flex items-center gap-1.5 text-xs lg:text-sm py-2">
            <DollarSign className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Cost</span>
          </TabsTrigger>
          <TabsTrigger value="errors" className="flex items-center gap-1.5 text-xs lg:text-sm py-2">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Errors</span>
          </TabsTrigger>
          <TabsTrigger value="roi" className="flex items-center gap-1.5 text-xs lg:text-sm py-2">
            <TrendingUp className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">ROI</span>
          </TabsTrigger>
          <TabsTrigger value="routing" className="flex items-center gap-1.5 text-xs lg:text-sm py-2">
            <Cpu className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Routing</span>
          </TabsTrigger>
          <TabsTrigger value="seats" className="flex items-center gap-1.5 text-xs lg:text-sm py-2">
            <Users className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Seats</span>
          </TabsTrigger>
          <TabsTrigger value="exam" className="flex items-center gap-1.5 text-xs lg:text-sm py-2">
            <BookOpen className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Exam KPIs</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="health" className="mt-4"><HealthTab /></TabsContent>
        <TabsContent value="quality" className="mt-4"><QualityTab /></TabsContent>
        <TabsContent value="cost" className="mt-4"><CostTab /></TabsContent>
        <TabsContent value="errors" className="mt-4"><ErrorsTab /></TabsContent>
        <TabsContent value="roi" className="mt-4"><RoiTab /></TabsContent>
        <TabsContent value="routing" className="mt-4"><RoutingTab /></TabsContent>
        <TabsContent value="seats" className="mt-4"><SeatsTab /></TabsContent>
        <TabsContent value="exam" className="mt-4"><ExamQualityTab /></TabsContent>
      </Tabs>
    </div>
  );
}
