import { Activity, Gauge, ShieldCheck, Workflow, Radar, Sparkles, Shield, ListChecks, AlertCircle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AdminPageHeader } from "@/components/admin/v2/AdminPageHeader";
import AiEvalRunsCard from "@/features/admin/components/AiEvalRunsCard";
import PolicyGovernanceCard from "@/features/admin/components/PolicyGovernanceCard";
import AdaptiveSequencingDecisionsCard from "@/features/admin/components/AdaptiveSequencingDecisionsCard";
import SafeActionsCard from "@/features/admin/components/SafeActionsCard";
import RuntimeActionsLedgerCard from "@/features/admin/components/RuntimeActionsLedgerCard";
import RuntimeFailuresCard from "@/features/admin/components/RuntimeFailuresCard";

/**
 * AI Runtime Command Center v1
 * ────────────────────────────
 * Bündelt die neuen Control-Plane-Layer (P0–P4 + L1–L3) als EIN Cockpit:
 *   • AI Eval Health         → AiEvalRunsCard
 *   • Policy Governance      → PolicyGovernanceCard
 *   • Adaptive Sequencing    → AdaptiveSequencingDecisionsCard (inkl. Regression Alerts)
 *   • AI Observability       → Platzhalter, nächste Ausbaustufe
 *   • Intervention Loop      → Platzhalter, nächste Ausbaustufe
 *
 * Read-only Leitstelle. Safe-Actions (Re-run, Rollback, Disable Policy, Recompute
 * Sequence) folgen im nächsten Cut mit Reason-Pflichtfeld + auto_heal_log Audit
 * gemäß `mem://constraints/admin-ui-leitstelle-v1`.
 */
export default function RuntimeCommandCenterPage() {
  return (
    <div className="space-y-4">
      <AdminPageHeader
        icon={Sparkles}
        title="AI Runtime Command Center"
        description="Measure → Detect → Decide → Mutate → Rollback → Explain. SSOT für AI-Eval, Policy-Governance, Adaptive Sequencing, Observability & Intervention-Loop."
        documentTitle="AI Runtime Command Center · ExamFit Admin"
        badges={
          <>
            <Badge variant="outline" className="text-[10px]">v1.1</Badge>
            <Badge variant="secondary" className="text-[10px]">observability</Badge>
          </>
        }
      />

      <Tabs defaultValue="actions" className="w-full">
        <TabsList className="flex w-full flex-wrap gap-1">
          <TabsTrigger value="actions" className="gap-1.5">
            <ListChecks className="h-3.5 w-3.5" /> Actions
          </TabsTrigger>
          <TabsTrigger value="failures" className="gap-1.5">
            <AlertCircle className="h-3.5 w-3.5" /> Failures
          </TabsTrigger>
          <TabsTrigger value="health" className="gap-1.5">
            <Gauge className="h-3.5 w-3.5" /> Health
          </TabsTrigger>
          <TabsTrigger value="governance" className="gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" /> Governance
          </TabsTrigger>
          <TabsTrigger value="sequencing" className="gap-1.5">
            <Workflow className="h-3.5 w-3.5" /> Sequencing
          </TabsTrigger>
          <TabsTrigger value="observability" className="gap-1.5">
            <Radar className="h-3.5 w-3.5" /> Observability
          </TabsTrigger>
          <TabsTrigger value="intervention" className="gap-1.5">
            <Activity className="h-3.5 w-3.5" /> Intervention
          </TabsTrigger>
          <TabsTrigger value="safe_actions" className="gap-1.5">
            <Shield className="h-3.5 w-3.5" /> Safe Actions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="actions" className="mt-4 space-y-4">
          <RuntimeActionsLedgerCard />
        </TabsContent>

        <TabsContent value="failures" className="mt-4 space-y-4">
          <RuntimeFailuresCard />
        </TabsContent>

        <TabsContent value="health" className="mt-4 space-y-4">
          <AiEvalRunsCard />
        </TabsContent>

        <TabsContent value="governance" className="mt-4 space-y-4">
          <PolicyGovernanceCard />
        </TabsContent>

        <TabsContent value="sequencing" className="mt-4 space-y-4">
          <AdaptiveSequencingDecisionsCard />
        </TabsContent>


        <TabsContent value="observability" className="mt-4">
          <PlaceholderCard
            title="AI Observability"
            hint="Modellgesundheit, Scope-Violations, Grounding-Miss, Drift. Wire-in folgt im nächsten Cut über `admin_get_ai_observability_summary` + `v_ai_model_health`."
          />
        </TabsContent>

        <TabsContent value="intervention" className="mt-4">
          <PlaceholderCard
            title="Intervention Loop"
            hint="Outcomes & Policy-Impact aus `v_recommendation_policy_effectiveness`. Folgecut bringt Effectiveness-Drilldown + Safe-Actions (Rollback, Disable Policy) mit Reason-Pflichtfeld + Audit."
          />
        </TabsContent>

        <TabsContent value="safe_actions" className="mt-4 space-y-4">
          <SafeActionsCard />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PlaceholderCard({ title, hint }: { title: string; hint: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
