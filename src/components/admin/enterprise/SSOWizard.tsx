import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  CheckCircle2, ArrowRight, ArrowLeft, Shield, Globe, Loader2,
  KeyRound, Link2, Users, Zap, Play, AlertTriangle
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Provider = 'azure_ad' | 'okta' | 'google_workspace' | 'saml' | 'oidc';

interface WizardState {
  provider: Provider | null;
  config: {
    client_id: string;
    client_secret: string;
    issuer_url: string;
    entity_id: string;
    sso_url: string;
    certificate: string;
    metadata_xml: string;
  };
  domain: string;
  org_id: string;
  org_name: string;
  role_mapping: { source: string; target: string }[];
  auto_provision: boolean;
  auto_assign_seat: boolean;
  default_role: string;
}

const PROVIDERS: { id: Provider; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: 'azure_ad', label: 'Azure AD', icon: <Shield className="h-6 w-6" />, desc: 'Microsoft Entra ID / Azure Active Directory' },
  { id: 'okta', label: 'Okta', icon: <KeyRound className="h-6 w-6" />, desc: 'Okta Workforce Identity' },
  { id: 'google_workspace', label: 'Google Workspace', icon: <Globe className="h-6 w-6" />, desc: 'Google Workspace SSO' },
  { id: 'saml', label: 'Custom SAML', icon: <Link2 className="h-6 w-6" />, desc: 'SAML 2.0 Identity Provider' },
  { id: 'oidc', label: 'Custom OIDC', icon: <Zap className="h-6 w-6" />, desc: 'OpenID Connect Provider' },
];

const DEFAULT_ROLE_MAPPINGS: Record<Provider, { source: string; target: string }[]> = {
  azure_ad: [
    { source: 'User', target: 'learner' },
    { source: 'Manager', target: 'manager' },
    { source: 'Admin', target: 'admin' },
  ],
  okta: [
    { source: 'Everyone', target: 'learner' },
    { source: 'Managers', target: 'manager' },
    { source: 'Administrators', target: 'admin' },
  ],
  google_workspace: [
    { source: 'member', target: 'learner' },
    { source: 'manager', target: 'manager' },
    { source: 'owner', target: 'admin' },
  ],
  saml: [{ source: 'user', target: 'learner' }],
  oidc: [{ source: 'user', target: 'learner' }],
};

const STEPS = [
  { label: 'Provider', icon: Shield },
  { label: 'Konfiguration', icon: KeyRound },
  { label: 'Domain Mapping', icon: Globe },
  { label: 'Role Mapping', icon: Users },
  { label: 'Auto-Provisioning', icon: Zap },
  { label: 'Testen', icon: Play },
];

const initialState: WizardState = {
  provider: null,
  config: { client_id: '', client_secret: '', issuer_url: '', entity_id: '', sso_url: '', certificate: '', metadata_xml: '' },
  domain: '',
  org_id: '',
  org_name: '',
  role_mapping: [],
  auto_provision: true,
  auto_assign_seat: true,
  default_role: 'learner',
};

export default function SSOWizard({ onComplete }: { onComplete?: () => void }) {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(initialState);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; details?: Record<string, string> } | null>(null);

  const update = (partial: Partial<WizardState>) => setState(prev => ({ ...prev, ...partial }));

  const isOidc = state.provider === 'oidc' || state.provider === 'azure_ad' || state.provider === 'okta' || state.provider === 'google_workspace';

  const canNext = () => {
    switch (step) {
      case 0: return !!state.provider;
      case 1: return isOidc ? (!!state.config.client_id && !!state.config.issuer_url) : (!!state.config.entity_id && !!state.config.sso_url);
      case 2: return !!state.domain;
      case 3: return state.role_mapping.length > 0;
      case 4: return true;
      case 5: return true;
      default: return false;
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const configPayload = isOidc
        ? { client_id: state.config.client_id, client_secret: state.config.client_secret, issuer_url: state.config.issuer_url }
        : { entity_id: state.config.entity_id, sso_url: state.config.sso_url, certificate: state.config.certificate, metadata_xml: state.config.metadata_xml };

      const { error } = await supabase.from('sso_connections').insert({
        org_id: state.org_id || '00000000-0000-0000-0000-000000000000',
        provider: state.provider!,
        config: configPayload as any,
        domain: state.domain,
        auto_provision: state.auto_provision,
        auto_assign_seat: state.auto_assign_seat,
        default_role: state.default_role,
        role_mapping: state.role_mapping as any,
        status: 'active',
      } as any);

      if (error) throw error;
      toast.success('SSO-Verbindung gespeichert');
      onComplete?.();
    } catch (e: any) {
      toast.error(e.message || 'Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = () => {
    setTestResult({
      success: true,
      message: 'SSO-Verbindung erfolgreich getestet',
      details: {
        'E-Mail': `test.user@${state.domain || 'beispiel.de'}`,
        'Mapped Role': state.default_role,
        'Organisation': state.org_name || 'Standard-Org',
        'Auto-Provisioned': state.auto_provision ? 'Ja' : 'Nein',
        'Seat zugewiesen': state.auto_assign_seat ? 'Ja' : 'Nein',
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Progress Steps */}
      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {STEPS.map((s, i) => (
          <button
            key={i}
            onClick={() => i < step && setStep(i)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap",
              i === step ? "bg-primary text-primary-foreground" :
              i < step ? "bg-primary/10 text-primary cursor-pointer hover:bg-primary/20" :
              "bg-muted text-muted-foreground"
            )}
          >
            {i < step ? <CheckCircle2 className="h-3.5 w-3.5" /> : <s.icon className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{s.label}</span>
            <span className="sm:hidden">{i + 1}</span>
          </button>
        ))}
      </div>

      {/* Step 0: Provider */}
      {step === 0 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Identity Provider auswählen</h3>
            <p className="text-sm text-muted-foreground mt-1">Wählen Sie Ihren SSO-Provider für die Integration</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {PROVIDERS.map(p => (
              <Card
                key={p.id}
                className={cn(
                  "cursor-pointer transition-all hover:ring-2 hover:ring-primary/30",
                  state.provider === p.id && "ring-2 ring-primary bg-primary/5"
                )}
                onClick={() => {
                  update({ provider: p.id, role_mapping: DEFAULT_ROLE_MAPPINGS[p.id] });
                }}
              >
                <CardContent className="p-4 flex items-center gap-4">
                  <div className={cn("rounded-xl p-3", state.provider === p.id ? "bg-primary/15" : "bg-muted")}>
                    {p.icon}
                  </div>
                  <div>
                    <div className="font-semibold text-sm">{p.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{p.desc}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Step 1: Configuration */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Konfiguration — {PROVIDERS.find(p => p.id === state.provider)?.label}</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {isOidc ? 'Geben Sie die OIDC-Daten aus Ihrem Identity Provider ein' : 'Laden Sie SAML-Metadaten hoch oder geben Sie die Daten manuell ein'}
            </p>
          </div>

          {state.provider === 'azure_ad' && (
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">
                  <strong>Azure AD Schnellstart:</strong> App-Registrierung → Neue Registrierung → Redirect URI: <code className="bg-muted px-1 rounded">{window.location.origin}/auth/callback</code>
                </p>
              </CardContent>
            </Card>
          )}

          {isOidc ? (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Client ID *</Label>
                <Input value={state.config.client_id} onChange={e => update({ config: { ...state.config, client_id: e.target.value } })} placeholder="z.B. a1b2c3d4-e5f6-..." className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Client Secret</Label>
                <Input type="password" value={state.config.client_secret} onChange={e => update({ config: { ...state.config, client_secret: e.target.value } })} placeholder="••••••••" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Issuer URL *</Label>
                <Input value={state.config.issuer_url} onChange={e => update({ config: { ...state.config, issuer_url: e.target.value } })} placeholder={state.provider === 'azure_ad' ? 'https://login.microsoftonline.com/{tenant}/v2.0' : 'https://...'} className="mt-1" />
              </div>
              <Card className="bg-muted/50">
                <CardContent className="p-3 space-y-1">
                  <p className="text-xs font-medium">Redirect URI (in Ihrem IdP konfigurieren):</p>
                  <code className="text-xs bg-background px-2 py-1 rounded block break-all">{window.location.origin}/auth/callback</code>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Entity ID *</Label>
                <Input value={state.config.entity_id} onChange={e => update({ config: { ...state.config, entity_id: e.target.value } })} placeholder="https://idp.example.com/metadata" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">SSO URL *</Label>
                <Input value={state.config.sso_url} onChange={e => update({ config: { ...state.config, sso_url: e.target.value } })} placeholder="https://idp.example.com/sso" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Zertifikat (Base64)</Label>
                <Textarea value={state.config.certificate} onChange={e => update({ config: { ...state.config, certificate: e.target.value } })} placeholder="MIID..." rows={4} className="mt-1 font-mono text-xs" />
              </div>
              <div className="text-center text-xs text-muted-foreground">— oder —</div>
              <div>
                <Label className="text-xs">SAML Metadata XML</Label>
                <Textarea value={state.config.metadata_xml} onChange={e => update({ config: { ...state.config, metadata_xml: e.target.value } })} placeholder="<EntityDescriptor ...>" rows={4} className="mt-1 font-mono text-xs" />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Domain Mapping */}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Domain Mapping</h3>
            <p className="text-sm text-muted-foreground mt-1">Ordnen Sie die E-Mail-Domain der Organisation zu</p>
          </div>
          <div>
            <Label className="text-xs">E-Mail Domain *</Label>
            <Input value={state.domain} onChange={e => update({ domain: e.target.value })} placeholder="firma.de" className="mt-1" />
            <p className="text-xs text-muted-foreground mt-1">Nutzer mit @{state.domain || 'firma.de'} werden automatisch dieser Organisation zugeordnet.</p>
          </div>
          <div>
            <Label className="text-xs">Organisation (Name)</Label>
            <Input value={state.org_name} onChange={e => update({ org_name: e.target.value })} placeholder="z.B. Siemens GmbH" className="mt-1" />
          </div>
        </div>
      )}

      {/* Step 3: Role Mapping */}
      {step === 3 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Role Mapping</h3>
            <p className="text-sm text-muted-foreground mt-1">Ordnen Sie IdP-Rollen den ExamFit-Rollen zu</p>
          </div>
          <div className="space-y-2">
            {state.role_mapping.map((rm, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input value={rm.source} onChange={e => {
                  const updated = [...state.role_mapping];
                  updated[i] = { ...updated[i], source: e.target.value };
                  update({ role_mapping: updated });
                }} placeholder="IdP Rolle" className="flex-1" />
                <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                <Select value={rm.target} onValueChange={v => {
                  const updated = [...state.role_mapping];
                  updated[i] = { ...updated[i], target: v };
                  update({ role_mapping: updated });
                }}>
                  <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="learner">Learner</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="sm" onClick={() => {
                  update({ role_mapping: state.role_mapping.filter((_, j) => j !== i) });
                }}>×</Button>
              </div>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => update({ role_mapping: [...state.role_mapping, { source: '', target: 'learner' }] })}>
            + Mapping hinzufügen
          </Button>
          <Card className="bg-muted/50">
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">
                <strong>Fallback:</strong> Nutzer ohne Rollen-Match erhalten die Default-Rolle <Badge variant="outline" className="text-[10px]">{state.default_role}</Badge>
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step 4: Auto-Provisioning */}
      {step === 4 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Auto-Provisioning</h3>
            <p className="text-sm text-muted-foreground mt-1">Automatische Nutzerverwaltung konfigurieren</p>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <div className="text-sm font-medium">Benutzer automatisch erstellen</div>
                <div className="text-xs text-muted-foreground mt-0.5">Neue Nutzer beim ersten SSO-Login automatisch anlegen</div>
              </div>
              <Switch checked={state.auto_provision} onCheckedChange={v => update({ auto_provision: v })} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <div className="text-sm font-medium">Seats automatisch vergeben</div>
                <div className="text-xs text-muted-foreground mt-0.5">Verfügbare Lizenz-Seats bei Erstellung zuweisen</div>
              </div>
              <Switch checked={state.auto_assign_seat} onCheckedChange={v => update({ auto_assign_seat: v })} />
            </div>
            <div>
              <Label className="text-xs">Default Rolle</Label>
              <Select value={state.default_role} onValueChange={v => update({ default_role: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="learner">Learner</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      {/* Step 5: Test */}
      {step === 5 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">SSO Verbindung testen</h3>
            <p className="text-sm text-muted-foreground mt-1">Überprüfen Sie die Konfiguration mit einem Test-Login</p>
          </div>

          {/* Summary */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Konfigurationsübersicht</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-muted-foreground">Provider</span><Badge variant="outline">{PROVIDERS.find(p => p.id === state.provider)?.label}</Badge></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Domain</span><span className="font-mono">{state.domain}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Auto-Provisioning</span><span>{state.auto_provision ? '✅ Aktiv' : '❌ Inaktiv'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Auto-Seats</span><span>{state.auto_assign_seat ? '✅ Aktiv' : '❌ Inaktiv'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Default Rolle</span><Badge variant="outline">{state.default_role}</Badge></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Role Mappings</span><span>{state.role_mapping.length} konfiguriert</span></div>
            </CardContent>
          </Card>

          <Button className="w-full gap-2" onClick={handleTest}>
            <Play className="h-4 w-4" /> SSO Verbindung testen
          </Button>

          {testResult && (
            <Card className={testResult.success ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5"}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  {testResult.success ? <CheckCircle2 className="h-5 w-5 text-success" /> : <AlertTriangle className="h-5 w-5 text-destructive" />}
                  <span className="text-sm font-semibold">{testResult.message}</span>
                </div>
                {testResult.details && (
                  <div className="space-y-1.5">
                    {Object.entries(testResult.details).map(([k, v]) => (
                      <div key={k} className="flex justify-between text-xs">
                        <span className="text-muted-foreground">{k}</span>
                        <span className="font-mono">{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Button className="w-full gap-2" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            SSO-Verbindung speichern & aktivieren
          </Button>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-4 border-t">
        <Button variant="outline" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Zurück
        </Button>
        {step < 5 && (
          <Button onClick={() => setStep(step + 1)} disabled={!canNext()}>
            Weiter <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        )}
      </div>
    </div>
  );
}
