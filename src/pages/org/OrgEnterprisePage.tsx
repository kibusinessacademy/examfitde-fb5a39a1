import { useState, lazy, Suspense } from 'react';
import OrgConsoleShell from '@/components/org/OrgConsoleShell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  LayoutDashboard, Users, CreditCard, Armchair, Link2,
  Key, Upload, Shield, ScrollText,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

const OrgOverviewPanel = lazy(() => import('@/components/org/panels/OrgOverviewPanel'));
const OrgUsersPanel = lazy(() => import('@/components/org/panels/OrgUsersPanel'));
const OrgLicensesPanel = lazy(() => import('@/components/org/panels/OrgLicensesPanel'));
const OrgAssignmentsPanel = lazy(() => import('@/components/org/panels/OrgAssignmentsPanel'));
const OrgIntegrationsPanel = lazy(() => import('@/components/org/panels/OrgIntegrationsPanel'));
const OrgApiKeysPanel = lazy(() => import('@/components/org/panels/OrgApiKeysPanel'));
const OrgBulkImportPanel = lazy(() => import('@/components/org/panels/OrgBulkImportPanel'));
const OrgCompliancePanel = lazy(() => import('@/components/org/panels/OrgCompliancePanel'));
const OrgAuditPanel = lazy(() => import('@/components/org/panels/OrgAuditPanel'));

const TABS = [
  { value: 'overview', label: 'Übersicht', icon: LayoutDashboard },
  { value: 'users', label: 'Nutzer', icon: Users },
  { value: 'licenses', label: 'Lizenzen', icon: CreditCard },
  { value: 'assignments', label: 'Seats', icon: Armchair },
  { value: 'integrations', label: 'Integrationen', icon: Link2 },
  { value: 'api-keys', label: 'API Keys', icon: Key },
  { value: 'bulk-import', label: 'Bulk Import', icon: Upload },
  { value: 'compliance', label: 'Compliance', icon: Shield },
  { value: 'audit', label: 'Audit', icon: ScrollText },
] as const;

const PanelSkeleton = () => (
  <div className="space-y-4">
    <Skeleton className="h-20 w-full" />
    <Skeleton className="h-64 w-full" />
  </div>
);

export default function OrgEnterprisePage() {
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <OrgConsoleShell>
      {({ orgId, orgName, myRole, context, isLoading }) => (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex flex-wrap h-auto gap-1 bg-transparent p-0 mb-4">
            {TABS.map(t => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className="gap-1.5 text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg px-3 py-1.5"
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <Suspense fallback={<PanelSkeleton />}>
            <TabsContent value="overview">
              <OrgOverviewPanel orgId={orgId} context={context?.selected} />
            </TabsContent>
            <TabsContent value="users">
              <OrgUsersPanel orgId={orgId} context={context?.selected} />
            </TabsContent>
            <TabsContent value="licenses">
              <OrgLicensesPanel orgId={orgId} context={context?.selected} />
            </TabsContent>
            <TabsContent value="assignments">
              <OrgAssignmentsPanel orgId={orgId} context={context?.selected} />
            </TabsContent>
            <TabsContent value="integrations">
              <OrgIntegrationsPanel orgId={orgId} myRole={myRole} />
            </TabsContent>
            <TabsContent value="api-keys">
              <OrgApiKeysPanel orgId={orgId} />
            </TabsContent>
            <TabsContent value="bulk-import">
              <OrgBulkImportPanel orgId={orgId} />
            </TabsContent>
            <TabsContent value="compliance">
              <OrgCompliancePanel orgId={orgId} />
            </TabsContent>
            <TabsContent value="audit">
              <OrgAuditPanel orgId={orgId} />
            </TabsContent>
          </Suspense>
        </Tabs>
      )}
    </OrgConsoleShell>
  );
}
