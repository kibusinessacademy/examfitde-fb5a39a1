import { useState, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Shield, RefreshCw, Key, Upload, Sparkles, ArrowRight } from 'lucide-react';

const SSOWizard = lazy(() => import('./SSOWizard'));
const ScimMappingPanel = lazy(() => import('./ScimMappingPanel'));
const ApiKeysPanel = lazy(() => import('./ApiKeysPanel'));

const BulkImportPanel = lazy(() => import('@/components/admin/command/BulkImportPanel'));

export default function IntegrationHub() {
  const [activeTab, setActiveTab] = useState('sso');

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-foreground">Enterprise Integrationen</h2>
          <p className="text-xs text-muted-foreground mt-0.5">SSO, SCIM, API Keys & Bulk Import — alles an einem Ort</p>
        </div>
        <Button asChild size="sm" variant="outline" className="gap-1">
          <Link to="/admin/setup-wizards">
            <Sparkles className="h-3 w-3" /> One-Click Wizards <ArrowRight className="h-3 w-3" />
          </Link>
        </Button>
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
