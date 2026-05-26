/**
 * Premium UX — One-Click Setup Wizards Hub.
 * Route: /admin/setup-wizards
 *
 * Renders the unified catalog grouped by category, with live status from
 * `enterprise_setup_wizard_state`. Selecting a wizard either deep-links into
 * the existing tool (SSO/SCIM/Bulk-Import) or opens the in-page WizardRunner.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import {
  Sparkles, CheckCircle2, CircleDashed, AlertTriangle, ArrowLeft, Zap, ArrowRight,
} from 'lucide-react';
import {
  WIZARDS, WIZARD_CATEGORIES, wizardsByCategory, type WizardCategory, type WizardDef,
} from '@/lib/setup-wizards/catalog';
import { useSetupWizardList } from '@/hooks/useSetupWizards';
import type { SetupWizardState, SetupWizardStatus } from '@/lib/setup-wizards/api';
import WizardRunner from '@/components/setup-wizards/WizardRunner';

interface OrgOption { id: string; name: string }

function useManagerOrgs() {
  return useQuery({
    queryKey: ['setup-wizards', 'orgs'],
    queryFn: async (): Promise<OrgOption[]> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data, error } = await supabase
        .from('org_memberships')
        .select('org_id, role, organizations(id, name)')
        .eq('user_id', u.user.id)
        .eq('status', 'active')
        .in('role', ['owner', 'admin', 'manager']);
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((r: any) => ({
        id: r.organizations?.id ?? r.org_id,
        name: r.organizations?.name ?? 'Organisation',
      })).filter((o) => !!o.id);
    },
    staleTime: 60_000,
  });
}

const STATUS_META: Record<SetupWizardStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  not_started: { label: 'Nicht gestartet', cls: 'bg-surface-2 text-muted-foreground border-border', icon: <CircleDashed className="h-3 w-3" /> },
  in_progress: { label: 'In Arbeit',        cls: 'bg-status-info-bg-subtle text-status-info-text border-status-info-border', icon: <ArrowRight className="h-3 w-3" /> },
  connected:   { label: 'Verbunden',        cls: 'bg-status-success-bg-subtle text-status-success-text border-status-success-border', icon: <CheckCircle2 className="h-3 w-3" /> },
  error:       { label: 'Fehler',           cls: 'bg-status-error-bg-subtle text-status-error-text border-status-error-border', icon: <AlertTriangle className="h-3 w-3" /> },
  skipped:     { label: 'Übersprungen',     cls: 'bg-surface-2 text-muted-foreground border-border', icon: <CircleDashed className="h-3 w-3" /> },
};

export default function SetupWizardsPage() {
  const { data: orgs, isLoading: orgsLoading } = useManagerOrgs();
  const [orgId, setOrgId] = useState<string | null>(null);
  useEffect(() => { if (orgs?.length && !orgId) setOrgId(orgs[0].id); }, [orgs, orgId]);

  const { data: stateRes } = useSetupWizardList(orgId ?? undefined);
  const stateByKey = useMemo(() => {
    const map = new Map<string, SetupWizardState>();
    (stateRes?.states ?? []).forEach((s) => map.set(s.wizard_key, s));
    return map;
  }, [stateRes]);

  const grouped = useMemo(() => wizardsByCategory(), []);
  const categoryKeys = Object.keys(WIZARD_CATEGORIES) as WizardCategory[];

  const totalConnected = useMemo(
    () => Array.from(stateByKey.values()).filter((s) => s.status === 'connected').length,
    [stateByKey],
  );
  const totalWizards = WIZARDS.length;

  const [activeWizardKey, setActiveWizardKey] = useState<string | null>(null);
  const activeWizard = activeWizardKey ? WIZARDS.find((w) => w.key === activeWizardKey) : null;

  return (
    <div className="container mx-auto px-3 sm:px-4 py-6 sm:py-8 max-w-7xl">
      <div className="mb-6">
        <Button asChild variant="ghost" size="sm" className="mb-3">
          <Link to="/admin/v2/leitstelle"><ArrowLeft className="h-4 w-4 mr-1" /> Leitstelle</Link>
        </Button>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-primary" />
              One-Click Setup Wizards
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Premium-UX-Layer für alle Enterprise-Integrationen. Kunden müssen nichts mehr verstehen, konfigurieren oder zusammensuchen — wir führen durch jede Verbindung.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {orgs && orgs.length > 0 && (
              <Select value={orgId ?? ''} onValueChange={(v) => setOrgId(v)}>
                <SelectTrigger className="w-[220px]"><SelectValue placeholder="Organisation" /></SelectTrigger>
                <SelectContent>
                  {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      </div>

      {/* KPI Strip */}
      <Card className="mb-6 shadow-elev-1">
        <CardContent className="py-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs text-muted-foreground">Integrations-Reife</p>
              <p className="text-2xl font-bold text-foreground">{totalConnected} / {totalWizards}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Verbundene Integrationen in dieser Organisation</p>
            </div>
            <div className="flex-1 max-w-md">
              <Progress value={totalWizards > 0 ? (totalConnected / totalWizards) * 100 : 0} className="h-2" />
            </div>
            <Badge variant="outline" className="gap-1">
              <Zap className="h-3 w-3" /> {WIZARDS.filter((w) => w.tier === 'enterprise').length} Enterprise-Wizards
            </Badge>
          </div>
        </CardContent>
      </Card>

      {!orgsLoading && (!orgs || orgs.length === 0) ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          Du musst Manager oder Admin einer Organisation sein, um Setup-Wizards zu sehen.
        </CardContent></Card>
      ) : (
        <Tabs defaultValue={categoryKeys[0]}>
          <TabsList className="flex w-full flex-wrap h-auto gap-1">
            {categoryKeys.map((c) => (
              <TabsTrigger key={c} value={c} className="text-xs">
                {WIZARD_CATEGORIES[c].label}
                <Badge variant="outline" className="ml-2 text-[10px] h-4 px-1.5">
                  {grouped[c].length}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>
          {categoryKeys.map((c) => (
            <TabsContent key={c} value={c} className="mt-4 space-y-3">
              <p className="text-xs text-muted-foreground">{WIZARD_CATEGORIES[c].description}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {grouped[c].map((w) => (
                  <WizardCard
                    key={w.key}
                    wizard={w}
                    state={stateByKey.get(w.key)}
                    onOpen={() => setActiveWizardKey(w.key)}
                  />
                ))}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      )}

      {/* Active wizard panel */}
      {activeWizard && orgId && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm p-3 sm:p-6 overflow-y-auto" onClick={() => setActiveWizardKey(null)}>
          <div className="max-w-2xl mx-auto" onClick={(e) => e.stopPropagation()}>
            <WizardRunner
              wizard={activeWizard}
              orgId={orgId}
              state={stateByKey.get(activeWizard.key)}
              onClose={() => setActiveWizardKey(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function WizardCard({
  wizard, state, onOpen,
}: { wizard: WizardDef; state?: SetupWizardState; onOpen: () => void }) {
  const status = state?.status ?? 'not_started';
  const meta = STATUS_META[status];
  return (
    <Card className="shadow-elev-1 hover:shadow-elev-2 transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-sm font-semibold truncate">{wizard.label}</CardTitle>
            <p className="text-xs text-muted-foreground truncate mt-0.5">{wizard.vendor}</p>
          </div>
          <Badge variant="outline" className={meta.cls + ' gap-1 shrink-0'}>
            {meta.icon}
            <span className="text-[10px]">{meta.label}</span>
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground line-clamp-3">{wizard.promise}</p>
        <div className="flex items-center justify-between gap-2">
          <Badge variant="secondary" className="text-[10px] capitalize">{wizard.tier}</Badge>
          <Button size="sm" variant={status === 'connected' ? 'outline' : 'default'} onClick={onOpen}>
            {status === 'connected' ? 'Verwalten' : status === 'in_progress' ? 'Fortsetzen' : 'Einrichten'}
            <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
