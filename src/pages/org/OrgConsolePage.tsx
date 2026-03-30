import { useEffect, useMemo, useState, useCallback } from "react";
import { getOrgConsoleContext } from "@/lib/orgApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Building2 } from "lucide-react";
import OrgKpiPanel from "@/pages/org/panels/OrgKpiPanel";
import OrgBillingPanel from "@/pages/org/panels/OrgBillingPanel";
import OrgSeatManagementPanel from "@/pages/org/panels/OrgSeatManagementPanel";
import OrgPrivacyPanel from "@/pages/org/panels/OrgPrivacyPanel";
import OrgEntityManagerPanel from "@/pages/org/panels/OrgEntityManagerPanel";
import AdminPrivacyQueuePanel from "@/pages/org/panels/AdminPrivacyQueuePanel";
import OrgPerformancePanel from "@/pages/org/panels/OrgPerformancePanel";
import OrgInterventionPanel from "@/pages/org/panels/OrgInterventionPanel";

type OrgListItem = { id: string; name: string; org_type: string; my_role: string };

export default function OrgConsolePage() {
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("kpis");

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const data = await getOrgConsoleContext(orgId ?? undefined);
        if (!alive) return;
        setCtx(data);
        if (!orgId && data?.selected?.org?.id) setOrgId(data.selected.org.id);
      } catch (e) {
        console.error("OrgConsolePage load failed", e);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [orgId]);

  const orgs: OrgListItem[] = useMemo(() => (ctx?.orgs ?? []).filter((o: any) => o?.id), [ctx]);
  const selected = ctx?.selected ?? null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (orgs.length === 0) {
    return (
      <Card className="max-w-2xl mx-auto">
        <CardContent className="py-12 text-center">
          <Building2 className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">Keine Organisation zugewiesen.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{selected?.org?.name ?? "Org Console"}</h1>
          <p className="text-sm text-muted-foreground">
            Rolle: <span className="font-medium">{selected?.my_role ?? "–"}</span>
            {" · "}Privacy: <span className="font-medium">{selected?.privacy_access?.status ?? "NONE"}</span>
          </p>
        </div>

        {orgs.length > 1 && (
          <Select value={orgId ?? undefined} onValueChange={(v) => setOrgId(v)}>
            <SelectTrigger className="w-[280px]">
              <SelectValue placeholder="Organisation wählen" />
            </SelectTrigger>
            <SelectContent>
              {orgs.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name} · {o.org_type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Tabs */}
      {selected?.org?.id && (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="kpis">KPIs</TabsTrigger>
            <TabsTrigger value="billing">Rechnungen</TabsTrigger>
            <TabsTrigger value="seats">Learner & Lizenzen</TabsTrigger>
            <TabsTrigger value="performance">Prüfungsreife</TabsTrigger>
            <TabsTrigger value="interventions">Interventionen</TabsTrigger>
            <TabsTrigger value="entities">Einheiten</TabsTrigger>
            <TabsTrigger value="privacy">Datenschutz</TabsTrigger>
            {selected?.my_role === "OWNER" && (
              <TabsTrigger value="admin_privacy">Admin Queue</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="kpis" className="mt-4">
            <OrgKpiPanel
              organizationId={selected.org.id}
              entities={selected.entities ?? []}
              privacyAccess={selected.privacy_access}
              myRole={selected.my_role}
            />
          </TabsContent>

          <TabsContent value="billing" className="mt-4">
            <OrgBillingPanel
              organizationId={selected.org.id}
              entities={selected.entities ?? []}
              myRole={selected.my_role}
            />
          </TabsContent>

          <TabsContent value="seats" className="mt-4">
            <OrgSeatManagementPanel
              organizationId={selected.org.id}
            />
          </TabsContent>

          <TabsContent value="performance" className="mt-4">
            <OrgPerformancePanel organizationId={selected.org.id} onNavigateToInterventions={() => setActiveTab("interventions")} />
          </TabsContent>

          <TabsContent value="interventions" className="mt-4">
            <OrgInterventionPanel organizationId={selected.org.id} />
          </TabsContent>

          <TabsContent value="entities" className="mt-4">
            <OrgEntityManagerPanel
              organizationId={selected.org.id}
              myRole={selected.my_role}
            />
          </TabsContent>

          <TabsContent value="privacy" className="mt-4">
            <OrgPrivacyPanel
              organizationId={selected.org.id}
              privacyAccess={selected.privacy_access}
              myRole={selected.my_role}
            />
          </TabsContent>

          {selected?.my_role === "OWNER" && (
            <TabsContent value="admin_privacy" className="mt-4">
              <AdminPrivacyQueuePanel />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
