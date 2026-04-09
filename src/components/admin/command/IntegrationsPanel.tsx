import { useState, lazy, Suspense } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  KeyRound, Link2, Upload, Shield, Globe, Users, Database,
  CheckCircle2, XCircle, Copy, Eye, EyeOff
} from 'lucide-react';
import { useIntegrationSummary, useLtiRegistrations, useScimTokens } from '@/hooks/useIntegrationStatus';
import type { IntegrationStatus } from '@/types/enterprise';
import { toast } from 'sonner';

const BulkImportPanel = lazy(() => import('./BulkImportPanel'));

function StatusBadge({ status }: { status: IntegrationStatus }) {
  if (status === 'connected') {
    return (
      <Badge className="bg-success/10 text-success border-success/30 gap-1">
        <CheckCircle2 className="h-3 w-3" /> Verbunden
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <XCircle className="h-3 w-3" /> Nicht konfiguriert
    </Badge>
  );
}

function IntegrationCard({
  icon: Icon,
  title,
  description,
  status,
  children,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  status: IntegrationStatus;
  children?: React.ReactNode;
}) {
  return (
    <Card className="rounded-xl">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">{title}</CardTitle>
              <CardDescription className="text-xs mt-0.5">{description}</CardDescription>
            </div>
          </div>
          <StatusBadge status={status} />
        </div>
      </CardHeader>
      {children && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  );
}

export default function IntegrationsPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { lti, scim, isLoading } = useIntegrationSummary();
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID || '';

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-primary" />
              Enterprise Integrationen
            </SheetTitle>
          </SheetHeader>

          {isLoading ? (
            <div className="space-y-4 mt-6">
              {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28" />)}
            </div>
          ) : (
            <div className="space-y-4 mt-6">
              {/* 1. Identity & Access */}
              <IntegrationCard
                icon={KeyRound}
                title="Identity & Access (SSO + SCIM)"
                description="OpenID Connect, SAML, SCIM 2.0 Provisioning"
                status={scim.status}
              >
                <div className="space-y-3">
                  <div className="rounded-lg border p-3 space-y-2">
                    <div className="text-xs font-medium text-foreground">SCIM 2.0 Endpunkt</div>
                    <code className="text-xs bg-muted px-2 py-1 rounded block break-all">
                      {import.meta.env.VITE_SUPABASE_URL}/functions/v1/scim
                    </code>
                    <div className="text-[11px] text-muted-foreground">
                      {scim.tokens.length} Token(s) konfiguriert
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>• Automatische User-Provisionierung aus Azure AD, Okta, Google Workspace</p>
                    <p>• Rollen- & Organisations-Mapping</p>
                    <p>• Deaktivierung = automatischer Seat-Entzug</p>
                  </div>
                </div>
              </IntegrationCard>

              {/* 2. LMS Integration */}
              <IntegrationCard
                icon={Link2}
                title="LMS Integration (LTI 1.3)"
                description="Launch, Deep Linking, NRPS, Grade Passback"
                status={lti.status}
              >
                <div className="space-y-3">
                  {lti.registrations.length > 0 ? (
                    <div className="space-y-2">
                      {lti.registrations.slice(0, 3).map(reg => (
                        <div key={reg.id} className="rounded-lg border p-3 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium">{reg.issuer}</span>
                            <Badge variant={reg.status === 'active' ? 'default' : 'outline'} className="text-[10px]">
                              {reg.status}
                            </Badge>
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            Client: <code>{reg.client_id}</code>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      Keine LTI-Plattformen registriert.
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>• LTI 1.3 Launch (SSO direkt aus dem LMS)</p>
                    <p>• Deep Linking für gezielte Kurs-/Modulstarts</p>
                    <p>• AGS Score Return für Ergebnis-Rückmeldung</p>
                    <p>• NRPS für Rollen- & Teilnehmer-Sync</p>
                  </div>
                </div>
              </IntegrationCard>

              {/* 3. Bulk Import */}
              <IntegrationCard
                icon={Upload}
                title="Bulk Import (CSV)"
                description="Schneller Rollout für 100–10.000 Nutzer"
                status="not_configured"
              >
                <div className="space-y-3">
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>• CSV-Upload mit Validierung & Dry-Run</p>
                    <p>• Idempotenter Import (Upsert via external_id)</p>
                    <p>• User + Org-Zuordnung + Seat-Assignment</p>
                    <p>• Vollständiger Fehlerreport</p>
                  </div>
                  <Button
                    size="sm"
                    className="rounded-xl"
                    onClick={() => setBulkImportOpen(true)}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Bulk Import starten
                  </Button>
                </div>
              </IntegrationCard>

              {/* 4. API & Governance */}
              <IntegrationCard
                icon={Database}
                title="API & Governance"
                description="Admin APIs, Reporting, Zugriffskontrolle"
                status="connected"
              >
                <div className="space-y-3">
                  <div className="rounded-lg border p-3 space-y-2">
                    <div className="text-xs font-medium text-foreground">API Base URL</div>
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-muted px-2 py-1 rounded flex-1 break-all">
                        {showApiKey
                          ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
                          : '••••••••••••••••••••••••'}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setShowApiKey(!showApiKey)}
                      >
                        {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => {
                          navigator.clipboard.writeText(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1`);
                          toast.success('URL kopiert');
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>• Authentifizierte Admin-Endpoints</p>
                    <p>• SSOT-basiertes Reporting</p>
                    <p>• Audit-Trail für alle Aktionen</p>
                  </div>
                </div>
              </IntegrationCard>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Suspense fallback={null}>
        <BulkImportPanel open={bulkImportOpen} onOpenChange={setBulkImportOpen} />
      </Suspense>
    </>
  );
}
