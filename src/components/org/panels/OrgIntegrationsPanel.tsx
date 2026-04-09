import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Link2, Key, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Loader2, Copy, Eye } from 'lucide-react';
import { EmptyState } from '@/components/admin/enterprise/shared/EmptyState';
import {
  useOrgSSOConnections, useSaveSSOConnection, useTestSSOConnection,
  useOrgScimTokens, useGenerateScimToken,
} from '@/hooks/useOrgEnterprise';
import { toast } from 'sonner';

interface Props {
  orgId: string;
  myRole: string;
}

export default function OrgIntegrationsPanel({ orgId, myRole }: Props) {
  const [subTab, setSubTab] = useState('sso');

  return (
    <div className="space-y-4">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SSOKpiCards orgId={orgId} />
      </div>

      <Tabs value={subTab} onValueChange={setSubTab}>
        <TabsList className="bg-transparent p-0 gap-1">
          <TabsTrigger value="sso" className="text-xs rounded-lg px-3 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">SSO</TabsTrigger>
          <TabsTrigger value="scim" className="text-xs rounded-lg px-3 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">SCIM</TabsTrigger>
          <TabsTrigger value="lti" className="text-xs rounded-lg px-3 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">LTI</TabsTrigger>
        </TabsList>

        <TabsContent value="sso"><SSOSection orgId={orgId} /></TabsContent>
        <TabsContent value="scim"><SCIMSection orgId={orgId} /></TabsContent>
        <TabsContent value="lti">
          <Card><CardContent className="py-8">
            <EmptyState icon={<Link2 className="h-5 w-5" />} title="LTI nicht konfiguriert" description="Kontaktieren Sie den Support für LTI-Integration." />
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SSOKpiCards({ orgId }: { orgId: string }) {
  const { data: conns } = useOrgSSOConnections(orgId);
  const { data: tokens } = useOrgScimTokens(orgId);
  const activeSSO = conns?.filter(c => c.status === 'active' || c.status === 'configured').length ?? 0;
  const activeSCIM = tokens?.filter(t => t.is_active).length ?? 0;

  return (
    <>
      <Card><CardContent className="p-3 text-center">
        <p className="text-[10px] text-muted-foreground">SSO Verbindungen</p>
        <p className="text-lg font-bold">{activeSSO}</p>
      </CardContent></Card>
      <Card><CardContent className="p-3 text-center">
        <p className="text-[10px] text-muted-foreground">SCIM Tokens</p>
        <p className="text-lg font-bold">{activeSCIM}</p>
      </CardContent></Card>
      <Card><CardContent className="p-3 text-center">
        <p className="text-[10px] text-muted-foreground">Letzter SSO-Test</p>
        <p className="text-xs font-medium">{conns?.[0]?.last_test_at ? new Date(conns[0].last_test_at).toLocaleDateString('de-DE') : '–'}</p>
      </CardContent></Card>
      <Card><CardContent className="p-3 text-center">
        <p className="text-[10px] text-muted-foreground">Test-Status</p>
        <p className="text-xs font-medium">{conns?.[0]?.last_test_status === 'success' ? '✅ OK' : conns?.[0]?.last_test_status === 'failed' ? '❌ Fehler' : '–'}</p>
      </CardContent></Card>
    </>
  );
}

function SSOSection({ orgId }: { orgId: string }) {
  const { data: connections, isLoading } = useOrgSSOConnections(orgId);
  const saveMutation = useSaveSSOConnection();
  const testMutation = useTestSSOConnection();

  const [showForm, setShowForm] = useState(false);
  const [provider, setProvider] = useState('oidc');
  const [issuerUrl, setIssuerUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [domain, setDomain] = useState('');

  const handleSave = async () => {
    try {
      await saveMutation.mutateAsync({
        org_id: orgId,
        provider,
        config: { issuer_url: issuerUrl, client_id: clientId },
        domain: domain || undefined,
      });
      setShowForm(false);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleTest = async (connId: string) => {
    await testMutation.mutateAsync({ org_id: orgId, connection_id: connId });
  };

  return (
    <div className="space-y-4">
      {/* Existing connections */}
      {connections?.map(conn => (
        <Card key={conn.id}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Link2 className="h-4 w-4" />
                {conn.provider.toUpperCase()}
                {conn.domain && <span className="text-muted-foreground font-normal">({conn.domain})</span>}
              </CardTitle>
              <Badge variant={conn.last_test_status === 'success' ? 'default' : conn.last_test_status === 'failed' ? 'destructive' : 'secondary'} className="text-[10px]">
                {conn.last_test_status || conn.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {conn.last_error && (
              <div className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 p-2 rounded flex items-start gap-1.5">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                {conn.last_error}
              </div>
            )}

            {/* Debug View */}
            {conn.last_test_result && (
              <div className="text-xs space-y-1 bg-muted p-2 rounded">
                <p className="font-medium">Letzter Test:</p>
                {conn.last_test_result.warnings?.map((w: string, i: number) => (
                  <p key={i} className="text-yellow-600">⚠ {w}</p>
                ))}
                {conn.last_test_result.discovered_endpoints && Object.entries(conn.last_test_result.discovered_endpoints).map(([k, v]) => (
                  <p key={k} className="text-muted-foreground">{k}: <span className="font-mono text-[10px]">{String(v).slice(0, 60)}</span></p>
                ))}
              </div>
            )}

            <Button size="sm" variant="outline" className="text-xs" onClick={() => handleTest(conn.id)} disabled={testMutation.isPending}>
              {testMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
              Verbindung testen
            </Button>
          </CardContent>
        </Card>
      ))}

      {/* New connection form */}
      {showForm ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Neue SSO-Verbindung</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              {['oidc', 'azure_ad', 'okta', 'google', 'saml'].map(p => (
                <Button key={p} size="sm" variant={provider === p ? 'default' : 'outline'} className="text-xs" onClick={() => setProvider(p)}>
                  {p.toUpperCase()}
                </Button>
              ))}
            </div>
            <Input placeholder="Issuer URL" value={issuerUrl} onChange={e => setIssuerUrl(e.target.value)} className="text-xs" />
            <Input placeholder="Client ID" value={clientId} onChange={e => setClientId(e.target.value)} className="text-xs" />
            <Input placeholder="Domain (optional)" value={domain} onChange={e => setDomain(e.target.value)} className="text-xs" />
            <div className="flex gap-2">
              <Button size="sm" className="text-xs" onClick={handleSave} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Speichern
              </Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => setShowForm(false)}>Abbrechen</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button size="sm" className="text-xs" onClick={() => setShowForm(true)}>
          + SSO-Verbindung hinzufügen
        </Button>
      )}
    </div>
  );
}

function SCIMSection({ orgId }: { orgId: string }) {
  const { data: tokens, isLoading } = useOrgScimTokens(orgId);
  const generateMutation = useGenerateScimToken();
  const [label, setLabel] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!label.trim()) { toast.error('Label erforderlich'); return; }
    try {
      const result = await generateMutation.mutateAsync({ org_id: orgId, label });
      setNewToken(result.token);
      setLabel('');
      toast.success('SCIM Token generiert');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const scimEndpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/scim-v2/Users`;

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <RefreshCw className="h-4 w-4" /> SCIM Provisioning
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">SCIM Endpoint</p>
              <div className="flex gap-1">
                <code className="text-[9px] bg-muted px-2 py-1 rounded flex-1 overflow-x-auto">{scimEndpoint}</code>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { navigator.clipboard.writeText(scimEndpoint); toast.success('Kopiert'); }}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[10px] text-muted-foreground">Neuen Token generieren</p>
              <div className="flex gap-2">
                <Input placeholder="Token Label" value={label} onChange={e => setLabel(e.target.value)} className="text-xs" />
                <Button size="sm" className="text-xs shrink-0" onClick={handleGenerate} disabled={generateMutation.isPending}>
                  {generateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Key className="h-3 w-3" />}
                </Button>
              </div>
            </div>

            {newToken && (
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-2 rounded">
                <p className="text-[10px] text-green-700 dark:text-green-300 font-medium mb-1">⚠ Token nur jetzt sichtbar!</p>
                <div className="flex gap-1">
                  <code className="text-[9px] bg-background px-2 py-1 rounded flex-1 break-all">{newToken}</code>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { navigator.clipboard.writeText(newToken); toast.success('Kopiert'); }}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Aktive Tokens</CardTitle>
          </CardHeader>
          <CardContent>
            {!tokens?.length ? (
              <EmptyState icon={<Key className="h-4 w-4" />} title="Keine Tokens" description="Generieren Sie einen SCIM Token." />
            ) : (
              <div className="space-y-2">
                {tokens.map(t => (
                  <div key={t.id} className="flex items-center justify-between text-xs border rounded p-2">
                    <div>
                      <span className="font-medium">{t.label}</span>
                      <span className="text-muted-foreground ml-2">{new Date(t.created_at).toLocaleDateString('de-DE')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {t.last_used_at && <span className="text-[10px] text-muted-foreground">Zuletzt: {new Date(t.last_used_at).toLocaleDateString('de-DE')}</span>}
                      <Badge variant={t.is_active ? 'default' : 'secondary'} className="text-[10px]">
                        {t.is_active ? 'aktiv' : 'inaktiv'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Mapping Info */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">SCIM Mapping</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between"><span className="text-muted-foreground">userName</span><span>→ email</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">name.givenName</span><span>→ display_name</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">name.familyName</span><span>→ display_name</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">active</span><span>→ status</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">roles[0].value</span><span>→ org_role</span></div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
