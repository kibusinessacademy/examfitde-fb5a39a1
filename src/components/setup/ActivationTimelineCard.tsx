import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Circle, AlertTriangle, ListChecks } from "lucide-react";
import { useSetupRecommendations } from "@/hooks/useSetupRecommendations";
import type { RecSignals } from "@/lib/setup/recommendations";

type Phase = "Lernplattform" | "Curriculum" | "Growth" | "Governance";
type State = "done" | "in_progress" | "blocked" | "todo";

interface Step {
  phase: Phase;
  label: string;
  detail: string;
  state: State;
}

function deriveTimeline(s: RecSignals): Step[] {
  const steps: Step[] = [];
  // Lernplattform
  steps.push({
    phase: "Lernplattform",
    label: "AI-Provider aktiviert",
    detail: s.wizards?.by_key["lovable_ai_gateway"] === "connected" ? "Lovable AI Gateway verbunden" : "noch nicht verbunden",
    state: s.wizards?.by_key["lovable_ai_gateway"] === "connected" ? "done" : "todo",
  });
  steps.push({
    phase: "Lernplattform",
    label: "Intelligence Graph populiert",
    detail: s.graph ? `${s.graph.competencies} Kompetenzen, ${s.graph.skills} Skills` : "unbekannt",
    state: s.graph && s.graph.competencies > 50 ? "done"
      : s.graph && s.graph.competencies > 0 ? "in_progress" : "todo",
  });
  // Curriculum
  steps.push({
    phase: "Curriculum",
    label: "Customer-Safe Pakete",
    detail: s.customer_safe ? `${s.customer_safe.customer_safe}/${s.customer_safe.total} safe` : "unbekannt",
    state: !s.customer_safe ? "todo"
      : s.customer_safe.not_ready === 0 ? "done"
      : s.customer_safe.not_ready > 50 ? "blocked" : "in_progress",
  });
  steps.push({
    phase: "Curriculum",
    label: "Inhaltliche Lücken geschlossen",
    detail: s.data_holes ? `${s.data_holes.total} offen` : "unbekannt",
    state: !s.data_holes ? "todo"
      : s.data_holes.total === 0 ? "done"
      : s.data_holes.total > 500 ? "blocked" : "in_progress",
  });
  // Growth
  steps.push({
    phase: "Growth",
    label: "Stripe & Pricing",
    detail: s.commerce_gap ? `${s.commerce_gap.published_without_price} ohne Preis` : "unbekannt",
    state: !s.commerce_gap ? "todo"
      : s.commerce_gap.published_without_price === 0 ? "done" : "blocked",
  });
  steps.push({
    phase: "Growth",
    label: "Landingpages & SEO",
    detail: s.commerce_gap ? `${s.commerce_gap.published_without_landing} ohne Landing` : "unbekannt",
    state: !s.commerce_gap ? "todo"
      : s.commerce_gap.published_without_landing === 0 ? "done"
      : s.commerce_gap.published_without_landing < 5 ? "in_progress" : "todo",
  });
  steps.push({
    phase: "Growth",
    label: "GTM/Analytics aktiv",
    detail: s.wizards?.by_key["ga4_gtm"] === "connected" ? "GA4 + GTM verbunden" : "noch nicht verbunden",
    state: s.wizards?.by_key["ga4_gtm"] === "connected" ? "done" : "todo",
  });
  // Governance
  steps.push({
    phase: "Governance",
    label: "Heal-Cockpit grün",
    detail: s.heal_alerts ? `${s.heal_alerts.open} offen` : "unbekannt",
    state: !s.heal_alerts ? "todo"
      : s.heal_alerts.critical > 0 ? "blocked"
      : s.heal_alerts.open === 0 ? "done" : "in_progress",
  });
  steps.push({
    phase: "Governance",
    label: "Queue Health stabil",
    detail: s.lane_health ? `${s.lane_health.stuck_processing} stuck` : "unbekannt",
    state: !s.lane_health ? "todo"
      : s.lane_health.stuck_processing === 0 ? "done"
      : s.lane_health.stuck_processing > 20 ? "blocked" : "in_progress",
  });
  return steps;
}

const STATE_ICON: Record<State, { icon: typeof Check; cls: string }> = {
  done: { icon: Check, cls: "text-status-success-text" },
  in_progress: { icon: Circle, cls: "text-status-info-text" },
  blocked: { icon: AlertTriangle, cls: "text-status-error-text" },
  todo: { icon: Circle, cls: "text-text-muted" },
};

const STATE_LABEL: Record<State, string> = {
  done: "fertig", in_progress: "läuft", blocked: "blockiert", todo: "offen",
};

export function ActivationTimelineCard({ orgId }: { orgId: string | null }) {
  const { data, isLoading } = useSetupRecommendations(orgId);
  const steps = data?.signals ? deriveTimeline(data.signals) : [];
  const byPhase = steps.reduce<Record<Phase, Step[]>>((m, s) => {
    (m[s.phase] ??= []).push(s); return m;
  }, {} as Record<Phase, Step[]>);
  const totalDone = steps.filter((s) => s.state === "done").length;

  return (
    <Card className="shadow-elev-1">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListChecks className="h-5 w-5 text-status-info-text" />
          BerufOS Activation Timeline
          {steps.length > 0 && (
            <Badge variant="secondary" className="ml-2">{totalDone}/{steps.length} fertig</Badge>
          )}
        </CardTitle>
        <p className="text-sm text-text-secondary">
          Fortschritt entlang der Aktivierungsphasen — automatisch aus SSOT-Signalen abgeleitet.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : (Object.entries(byPhase) as Array<[Phase, Step[]]>).map(([phase, items]) => (
          <div key={phase}>
            <h4 className="text-xs uppercase tracking-wide text-text-muted mb-2">{phase}</h4>
            <ol className="space-y-2">
              {items.map((s) => {
                const Si = STATE_ICON[s.state];
                const Icon = Si.icon;
                return (
                  <li key={s.label} className="flex items-start gap-3 rounded-md border border-border-subtle bg-surface-base p-3">
                    <Icon className={`h-4 w-4 mt-0.5 ${Si.cls}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-text-primary">{s.label}</span>
                        <Badge variant="outline" className="text-xs">{STATE_LABEL[s.state]}</Badge>
                      </div>
                      <p className="text-xs text-text-secondary mt-0.5">{s.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
