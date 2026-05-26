/**
 * BerufOS Activation & Intelligence OS
 *
 * Zentrale Steuerzentrale: Smart Recommendations · Activation Timeline ·
 * Integration Health · Cross-Layer Navigation (Wizards · Heal · Copilot · Graph).
 *
 * SSOT: keine eigenen Daten — reine Aggregation existierender admin_*-Signal-RPCs
 * über die deterministische Recommendation-Engine (src/lib/setup/recommendations.ts).
 *
 * Route: /admin/activation-os
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Rocket, ArrowLeft, ArrowRight, Sparkles, Activity, ListChecks,
  Settings2, ShieldCheck, Workflow, Heart, Building2, Compass,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SmartRecommendationsCard } from "@/components/setup/SmartRecommendationsCard";
import { ActivationTimelineCard } from "@/components/setup/ActivationTimelineCard";
import { IntegrationHealthCenterCard } from "@/components/setup/IntegrationHealthCenterCard";

interface OrgOption { id: string; name: string }

function useManagerOrgs() {
  return useQuery({
    queryKey: ["activation-os-orgs"],
    queryFn: async (): Promise<OrgOption[]> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data, error } = await supabase
        .from("org_memberships")
        .select("org_id, role, organizations(id, name)")
        .eq("user_id", u.user.id)
        .eq("status", "active")
        .in("role", ["owner", "admin", "manager"]);
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((r: any) => ({
        id: r.organizations?.id ?? r.org_id,
        name: r.organizations?.name ?? "Organisation",
      })).filter((o) => !!o.id);
    },
    staleTime: 60_000,
  });
}

interface LayerLink {
  layer: string;
  title: string;
  description: string;
  icon: typeof Rocket;
  to: string;
  badge?: string;
}

const LAYERS: LayerLink[] = [
  { layer: "Activation", title: "Setup-Wizards", description: "17 One-Click-Integrationen (SSO, Stripe, GTM, …).", icon: Settings2, to: "/admin/setup-wizards" },
  { layer: "Learning Ops", title: "BerufsKI Hub", description: "Tutor, Workflows, Inhalte, Lernpfade.", icon: Compass, to: "/berufs-ki" },
  { layer: "AI Ops", title: "Graph Activation", description: "Skill→Competency→Workflow→Outcome.", icon: Workflow, to: "/berufs-ki/graph-activation", badge: "deterministic" },
  { layer: "Content Ops", title: "Heal Cockpit", description: "Curriculum-Drift, Repair-Wellen, Quality Gates.", icon: Heart, to: "/admin/heal" },
  { layer: "Growth", title: "Growth Dashboards", description: "Funnel, Conversion-Events, SEO-Health.", icon: Activity, to: "/admin/growth" },
  { layer: "Recovery", title: "Manager Copilot", description: "Tagesbriefing aus Risk Radar + Cohorts.", icon: ShieldCheck, to: "/berufs-ki/copilot" },
  { layer: "Enterprise", title: "Multi-Rollout", description: "Standorte, Kohorten, Org-weite Rollouts.", icon: Building2, to: "/berufs-ki/intelligence/executive" },
];

export default function ActivationOSPage() {
  const { data: orgs, isLoading } = useManagerOrgs();
  const [orgId, setOrgId] = useState<string | null>(null);
  useEffect(() => { if (orgs?.length && !orgId) setOrgId(orgs[0].id); }, [orgs, orgId]);

  return (
    <div className="container py-8 space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
            <Link to="/admin"><ArrowLeft className="h-4 w-4 mr-1" /> Admin</Link>
          </Button>
          <h1 className="text-3xl font-semibold text-text-primary flex items-center gap-2">
            <Rocket className="h-7 w-7 text-status-info-text" />
            BerufOS Activation & Intelligence OS
          </h1>
          <p className="text-text-secondary mt-1 max-w-2xl">
            Die zentrale Steuerzentrale für Activation, Learning-Ops, AI-Ops, Content-Ops,
            Growth, Recovery und Enterprise — eine Oberfläche, sieben Layer, deterministische Signale.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {orgs && orgs.length > 1 && (
            <Select value={orgId ?? undefined} onValueChange={setOrgId}>
              <SelectTrigger className="w-[220px]"><SelectValue placeholder="Organisation wählen" /></SelectTrigger>
              <SelectContent>
                {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Badge variant="outline" className="gap-1">
            <Sparkles className="h-3 w-3" /> deterministic · evidence-based · scope-gated
          </Badge>
        </div>
      </div>

      {/* P0 — Smart Recommendations */}
      <SmartRecommendationsCard orgId={orgId} />

      {/* Activation Timeline + Health */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ActivationTimelineCard orgId={orgId} />
        <IntegrationHealthCenterCard orgId={orgId} />
      </div>

      {/* Layer Navigation */}
      <Card className="shadow-elev-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-status-info-text" />
            Sieben Layer der Plattform
          </CardTitle>
          <p className="text-sm text-text-secondary">
            Direkter Sprung in die spezialisierten Werkzeuge — keine Duplikation, nur Brücken.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {LAYERS.map((l) => {
              const Icon = l.icon;
              return (
                <Link
                  key={l.to}
                  to={l.to}
                  className="group rounded-lg border border-border-subtle bg-surface-base p-4 hover:border-border-strong transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <Icon className="h-5 w-5 text-status-info-text" />
                      <span className="text-xs uppercase tracking-wide text-text-muted">{l.layer}</span>
                    </div>
                    {l.badge && <Badge variant="secondary" className="text-xs">{l.badge}</Badge>}
                  </div>
                  <h3 className="font-medium text-text-primary group-hover:underline">{l.title}</h3>
                  <p className="text-sm text-text-secondary mt-1">{l.description}</p>
                  <div className="mt-2 text-xs text-status-info-text flex items-center gap-1">
                    Öffnen <ArrowRight className="h-3 w-3" />
                  </div>
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <p className="text-sm text-text-muted">Lade Organisationen…</p>
      )}
    </div>
  );
}
