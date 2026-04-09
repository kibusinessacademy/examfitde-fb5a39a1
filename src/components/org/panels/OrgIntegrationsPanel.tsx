import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Link2, Key, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import { EmptyState } from '@/components/admin/enterprise/shared/EmptyState';

interface Props {
  orgId: string;
  myRole: string;
}

export default function OrgIntegrationsPanel({ orgId, myRole }: Props) {
  const [subTab, setSubTab] = useState('sso');

  return (
    <div className="space-y-4">
      <Tabs value={subTab} onValueChange={setSubTab}>
        <TabsList className="bg-transparent p-0 gap-1">
          <TabsTrigger value="sso" className="text-xs rounded-lg px-3 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">SSO</TabsTrigger>
          <TabsTrigger value="scim" className="text-xs rounded-lg px-3 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">SCIM</TabsTrigger>
          <TabsTrigger value="lti" className="text-xs rounded-lg px-3 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">LTI</TabsTrigger>
        </TabsList>

        <TabsContent value="sso">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Link2 className="h-4 w-4" /> SSO Verbindung
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Status</span>
                  <Badge variant="outline" className="text-[10px]">Nicht konfiguriert</Badge>
                </div>
                <Button size="sm" className="text-xs w-full">SSO Wizard starten</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Letzter Test</CardTitle>
              </CardHeader>
              <CardContent>
                <EmptyState
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  title="Kein Test durchgeführt"
                  description="Starten Sie den SSO Wizard, um die Verbindung zu testen."
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="scim">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" /> SCIM Provisioning
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Endpoint</span>
                  <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded">/scim/v2</code>
                </div>
                <Button size="sm" variant="outline" className="text-xs w-full">Token generieren</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Mapping</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between"><span className="text-muted-foreground">userName</span><span>→ email</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">givenName</span><span>→ first_name</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">familyName</span><span>→ last_name</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">active</span><span>→ status</span></div>
                </div>
                <Button size="sm" variant="outline" className="text-xs w-full mt-3">Mapping bearbeiten</Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="lti">
          <Card>
            <CardContent className="py-8">
              <EmptyState
                icon={<Link2 className="h-5 w-5" />}
                title="LTI nicht konfiguriert"
                description="Kontaktieren Sie den Support für LTI-Integration."
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
