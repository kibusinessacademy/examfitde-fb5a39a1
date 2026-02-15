import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Activity, Award, DollarSign, AlertTriangle } from 'lucide-react';
import HealthTab from '@/components/admin/command/HealthTab';
import QualityTab from '@/components/admin/command/QualityTab';
import CostTab from '@/components/admin/command/CostTab';
import ErrorsTab from '@/components/admin/command/ErrorsTab';

export default function CommandPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl lg:text-2xl font-display font-bold text-foreground">Leitstelle</h1>

      <Tabs defaultValue="health" className="w-full">
        <TabsList className="grid w-full grid-cols-4 h-auto">
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
        </TabsList>

        <TabsContent value="health" className="mt-4"><HealthTab /></TabsContent>
        <TabsContent value="quality" className="mt-4"><QualityTab /></TabsContent>
        <TabsContent value="cost" className="mt-4"><CostTab /></TabsContent>
        <TabsContent value="errors" className="mt-4"><ErrorsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
