import { useState, lazy, Suspense } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Shield, RefreshCw, Key, Upload } from 'lucide-react';

const SSOWizard = lazy(() => import('./SSOWizard'));
const ScimMappingPanel = lazy(() => import('./ScimMappingPanel'));
const ApiKeysPanel = lazy(() => import('./ApiKeysPanel'));

const BulkImportPanel = lazy(() => import('@/components/admin/command/BulkImportPanel'));

export default function IntegrationHub() {
  const [activeTab, setActiveTab] = useState('sso');

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-foreground">Enterprise Integrationen</h2>
        <p className="text-xs text-muted-foreground mt-0.5">SSO, SCIM, API Keys & Bulk Import — alles an einem Ort</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full grid grid-cols-4">
          <TabsTrigger value="sso" className="text-xs gap-1"><Shield className="h-3 w-3" />SSO Setup</TabsTrigger>
          <TabsTrigger value="scim" className="text-xs gap-1"><RefreshCw className="h-3 w-3" />SCIM</TabsTrigger>
          <TabsTrigger value="apikeys" className="text-xs gap-1"><Key className="h-3 w-3" />API Keys</TabsTrigger>
          <TabsTrigger value="bulk" className="text-xs gap-1"><Upload className="h-3 w-3" />Bulk Import</TabsTrigger>
        </TabsList>

        <TabsContent value="sso" className="mt-4">
          <Suspense fallback={<Skeleton className="h-96" />}>
            <SSOWizard onComplete={() => setActiveTab('scim')} />
          </Suspense>
        </TabsContent>

        <TabsContent value="scim" className="mt-4">
          <Suspense fallback={<Skeleton className="h-96" />}>
            <ScimMappingPanel />
          </Suspense>
        </TabsContent>

        <TabsContent value="apikeys" className="mt-4">
          <Suspense fallback={<Skeleton className="h-96" />}>
            <ApiKeysPanel />
          </Suspense>
        </TabsContent>

        <TabsContent value="bulk" className="mt-4">
          <Suspense fallback={<Skeleton className="h-64" />}>
            <BulkImportPanel open={true} onOpenChange={() => {}} />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
