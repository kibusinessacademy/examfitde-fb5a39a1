/**
 * Heal Cockpit — /admin/heal
 *
 * Single Pane of Glass für ALLE Heal-/Recovery-/Repair-Funktionen.
 *
 * v3 Layout (entrümpelt 2026-04-29):
 *   • Sticky Quick-Action-Bar oben (Reap Control + Reap All + Refresh)
 *   • 4 Top-Level-Gruppen statt 12 Sections:
 *       1. Pulse (default-open) — Throughput, Lane-Health, Blocker-Counts
 *       2. Quick Recover (default-open) — Stale-Reap (lane-aware), Hot-Loop
 *       3. Pakete heilen — Targeted, Stuck-Patterns, Heal-Status, Blocked
 *       4. Erweitert (collapsed) — Triage, Recheck, Drill-down, Selector,
 *          Reaper, Strategien, Queue-Detail-Tabs
 *
 * Empfohlene Bedienung:
 *   1. Pulse-Bar oben checken → grün/gelb/rot pro Lane sichtbar
 *   2. Bei Stillstand: "Reap Control-Lane" oder Quick-Recover-Sektion
 *   3. Pakete heilen → Stuck-Patterns Bulk-Promote oder Per-Step-Retry
 *   4. Erweitert nur bei Spezial-Workflows öffnen
 */
import { lazy, Suspense, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Activity, AlertTriangle, Crosshair, Filter, Heart, ListChecks,
  RefreshCw, Settings, Shield, Stethoscope, Wand2, Wrench, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AdminPageHeader } from "@/components/admin/v2/AdminPageHeader";

import { ThroughputCard } from "@/components/admin/heal/cards/ThroughputCard";
import { LaneHealthCard } from "@/components/admin/heal/cards/LaneHealthCard";
import { CancelReasonBreakdownCard } from "@/components/admin/heal/cards/CancelReasonBreakdownCard";
import { CancelHotspotsCard } from "@/components/admin/heal/cards/CancelHotspotsCard";
import { PendingAgeHistogramCard } from "@/components/admin/heal/cards/PendingAgeHistogramCard";
import { WorkerThroughputForensicsCard } from "@/components/admin/heal/cards/WorkerThroughputForensicsCard";
import { DrainOrchestratorCard } from "@/components/admin/heal/cards/DrainOrchestratorCard";
import { RecoveryPulseHistoryCard } from "@/components/admin/heal/cards/RecoveryPulseHistoryCard";
import { QualityGateDecisionsCard } from "@/components/admin/heal/cards/QualityGateDecisionsCard";
import { OpsCancelSkipRiseCard } from "@/components/admin/heal/cards/OpsCancelSkipRiseCard";
import { ArtifactCompletenessCard } from "@/components/admin/heal/cards/ArtifactCompletenessCard";
import { LessonJoinParityCard } from "@/components/admin/heal/cards/LessonJoinParityCard";
import { PostPublishOrchestratorCard } from "@/components/admin/heal/cards/PostPublishOrchestratorCard";
import { PaidButNotDeliveredCard } from "@/components/admin/heal/cards/PaidButNotDeliveredCard";
import { ActivationFunnelCard } from "@/components/admin/heal/cards/ActivationFunnelCard";
import { ExamReadinessDistributionCard } from "@/components/admin/heal/cards/ExamReadinessDistributionCard";
import { ContentFeedbackPipelineCard } from "@/components/admin/heal/cards/ContentFeedbackPipelineCard";
import { NextBestActionDistributionCard } from "@/components/admin/heal/cards/NextBestActionDistributionCard";
import { ExamSuccessDriversCard } from "@/components/admin/heal/cards/ExamSuccessDriversCard";
import { InterventionEffectivenessCard } from "@/components/admin/heal/cards/InterventionEffectivenessCard";
import { NbaWeightingHealthCard } from "@/components/admin/heal/cards/NbaWeightingHealthCard";
import { TutorInterventionHealthCard } from "@/components/admin/heal/cards/TutorInterventionHealthCard";
import { CohortPopulationIntelligenceCard } from "@/components/admin/heal/cards/CohortPopulationIntelligenceCard";
import { TrainerIntelligenceCard } from "@/components/admin/heal/cards/TrainerIntelligenceCard";
import { AutonomousOptimizationCard } from "@/components/admin/heal/cards/AutonomousOptimizationCard";
import { SkillGraphIntelligenceCard } from "@/components/admin/heal/cards/SkillGraphIntelligenceCard";
import { AdaptivePathOrchestrationCard } from "@/components/admin/heal/cards/AdaptivePathOrchestrationCard";
import { CognitiveLoadIntelligenceCard } from "@/components/admin/heal/cards/CognitiveLoadIntelligenceCard";
import { TemporalIntelligenceCard } from "@/components/admin/heal/cards/TemporalIntelligenceCard";
import { PredictiveSimulationCard } from "@/components/admin/heal/cards/PredictiveSimulationCard";
import { SeoJobHealthCard } from "@/components/admin/heal/cards/SeoJobHealthCard";
import { SeoGraphImpactCard } from "@/components/admin/heal/cards/SeoGraphImpactCard";
import { SeoGraphReconCard } from "@/components/admin/heal/cards/SeoGraphReconCard";
import { SeoBridgeActivationCard } from "@/components/admin/heal/cards/SeoBridgeActivationCard";
import { SeoBridgePromotionCard } from "@/components/admin/heal/cards/SeoBridgePromotionCard";
import { HealAutomationControlCard } from "@/components/admin/heal/cards/HealAutomationControlCard";
import { NotificationDeliveryHealthCard } from "@/components/admin/heal/cards/NotificationDeliveryHealthCard";
import { AccessSsotHealthCard } from "@/components/admin/heal/cards/AccessSsotHealthCard";
import { WorkerOutputBreakdownCard } from "@/components/admin/heal/cards/WorkerOutputBreakdownCard";
import { PackageHealLogViewerCard } from "@/components/admin/heal/cards/PackageHealLogViewerCard";
import { HealRunDrilldownCard } from "@/components/admin/heal/cards/HealRunDrilldownCard";
import { AutoPulseImpactCard } from "@/components/admin/heal/cards/AutoPulseImpactCard";
import { BlockedReasonDetailCard } from "@/components/admin/heal/cards/BlockedReasonDetailCard";
import { ControlLaneRequeueCard } from "@/components/admin/heal/cards/ControlLaneRequeueCard";
import { QualityCouncilDriftCard } from "@/components/admin/heal/cards/QualityCouncilDriftCard";
import {
  BlockerCountsCard, type BlockerKey,
} from "@/components/admin/heal/cards/BlockerCountsCard";
import { RecoverActionsCard } from "@/components/admin/heal/cards/RecoverActionsCard";
import { TargetedHealCard } from "@/components/admin/heal/cards/TargetedHealCard";
import { StuckPatternsCard } from "@/components/admin/heal/cards/StuckPatternsCard";
import { AutoPublishRetryCard } from "@/components/admin/heal/cards/AutoPublishRetryCard";
import { ManualRetryAuditCard } from "@/components/admin/heal/cards/ManualRetryAuditCard";
import { BronzeQuarantineCard } from "@/components/admin/heal/cards/BronzeQuarantineCard";
import { PreHeartbeatKillRiskCard } from "@/components/admin/heal/cards/PreHeartbeatKillRiskCard";
import { PreHeartbeatKillForensicsCard } from "@/components/admin/heal/cards/PreHeartbeatKillForensicsCard";
import { AggregateStateDiffCard } from "@/components/admin/heal/cards/AggregateStateDiffCard";
import { HealStatusCard } from "@/components/admin/heal/cards/HealStatusCard";
import { PublishTailBlockersCard } from "@/components/admin/heal/cards/PublishTailBlockersCard";
import { SoftDriftMcRepairCard } from "@/components/admin/heal/cards/SoftDriftMcRepairCard";
import { JobTypeWorkerAuditCard } from "@/components/admin/heal/cards/JobTypeWorkerAuditCard";
import { ExamPoolDriftLogCard } from "@/components/admin/heal/cards/ExamPoolDriftLogCard";
import { StaleDraftsCard } from "@/components/admin/heal/cards/StaleDraftsCard";
import { ContentGapTopupCard } from "@/components/admin/heal/cards/ContentGapTopupCard";
import { LearningIntegrityExecutiveCard } from "@/components/admin/heal/cards/LearningIntegrityExecutiveCard";
import { LxiNoLessonsRepairCard } from "@/components/admin/heal/cards/LxiNoLessonsRepairCard";
import { StaleDoneStepsCard } from "@/components/admin/heal/cards/StaleDoneStepsCard";
import { ContinuationFailuresCard } from "@/components/admin/heal/cards/ContinuationFailuresCard";
import { ForcePublishLogPanel } from "@/components/admin/heal/ForcePublishLogPanel";
import { CouncilDeferredCard } from "@/components/admin/heal/cards/CouncilDeferredCard";
import { SystemIntentsKpiCard } from "@/components/admin/heal/cards/SystemIntentsKpiCard";
import NotificationKpiCard from "@/components/admin/heal/cards/NotificationKpiCard";
import NotificationAttributionCard from "@/components/admin/heal/cards/NotificationAttributionCard";
import NotificationHealthCard from "@/components/admin/heal/cards/NotificationHealthCard";
import NotificationActionFunnelCard from "@/components/admin/heal/cards/NotificationActionFunnelCard";
import NotificationSuppressionGovernanceCard from "@/components/admin/heal/cards/NotificationSuppressionGovernanceCard";
import NotificationRecoveryRoutingCard from "@/components/admin/heal/cards/NotificationRecoveryRoutingCard";
import NotificationEffectivenessCard from "@/components/admin/heal/cards/NotificationEffectivenessCard";
import AdaptivePolicyCard from "@/components/admin/heal/cards/AdaptivePolicyCard";
import PolicyImpactFunnelCard from "@/components/admin/heal/cards/PolicyImpactFunnelCard";
import NotificationFinalizationCard from "@/components/admin/heal/cards/NotificationFinalizationCard";
import NotificationRevenueAttributionCard from "@/components/admin/heal/cards/NotificationRevenueAttributionCard";
import B2bRenewalPipelineCard from "@/components/admin/heal/cards/B2bRenewalPipelineCard";
import UpsellDiscoveryCard from "@/components/admin/heal/cards/UpsellDiscoveryCard";
import { TrackM4StatusCard } from "@/components/admin/heal/cards/TrackM4StatusCard";
import { TrackM5StatusCard } from "@/components/admin/heal/cards/TrackM5StatusCard";
import { TrackM6StatusCard } from "@/components/admin/heal/cards/TrackM6StatusCard";
import { TrackM7StatusCard } from "@/components/admin/heal/cards/TrackM7StatusCard";
import { TrackM8StatusCard } from "@/components/admin/heal/cards/TrackM8StatusCard";
import { TrackM9StatusCard } from "@/components/admin/heal/cards/TrackM9StatusCard";
import { CustomerSafeReadinessCard } from "@/components/admin/heal/cards/CustomerSafeReadinessCard";
import { OperationalStateCard } from "@/components/admin/heal/cards/OperationalStateCard";
import { GrowthSignalsCard } from "@/components/admin/heal/cards/GrowthSignalsCard";
import { GrowthClassificationCard } from "@/components/admin/heal/cards/GrowthClassificationCard";
import { CanonicalDriftRunbookCard } from "@/components/admin/heal/cards/CanonicalDriftRunbookCard";
import { AttributionAuditCard } from "@/components/admin/heal/cards/AttributionAuditCard";
import { RepairEligibilityCard } from "@/components/admin/heal/cards/RepairEligibilityCard";
import { DriftOverviewCard } from "@/components/admin/heal/cards/DriftOverviewCard";
import { AutoPublishErrorOverviewCard } from "@/components/admin/heal/cards/AutoPublishErrorOverviewCard";
import { StaleLockEscalationsCard } from "@/components/admin/heal/cards/StaleLockEscalationsCard";
import { SnapshotDriftCard } from "@/components/admin/heal/cards/SnapshotDriftCard";
import { QueueDrainCard } from "@/components/admin/heal/cards/QueueDrainCard";
import { BlockedPackagesCard } from "@/components/admin/heal/cards/BlockedPackagesCard";
import { TriageCards } from "@/components/admin/heal/cards/TriageCards";
import { TargetedRecheckCard } from "@/components/admin/heal/cards/TargetedRecheckCard";
import { DrillDownCard } from "@/components/admin/heal/cards/DrillDownCard";
import { AutoSelectorCard } from "@/components/admin/heal/cards/AutoSelectorCard";
import { ReaperGovernanceCard } from "@/components/admin/heal/cards/ReaperGovernanceCard";
import { HealStrategyCard } from "@/components/admin/heal/cards/HealStrategyCard";
import { AlertsBanner } from "@/components/admin/heal/cards/AlertsBanner";
import { NextActionCard } from "@/components/admin/heal/cards/NextActionCard";
import { HealKpiHeroCard } from "@/components/admin/heal/cards/HealKpiHeroCard";
import { RecurringPatternsCard } from "@/components/admin/heal/cards/RecurringPatternsCard";
import { PermanentFixBacklogCard } from "@/components/admin/heal/cards/PermanentFixBacklogCard";
import { CourseHealPlansCard } from "@/components/admin/heal/cards/CourseHealPlansCard";
import { ExamPoolQuarantineCard } from "@/components/admin/heal/cards/ExamPoolQuarantineCard";
import { PackagePipelineLiveCard } from "@/components/admin/heal/cards/PackagePipelineLiveCard";
import { HealAuditLayersCard } from "@/components/admin/heal/cards/HealAuditLayersCard";
import { QueuedStallSuggestionCard } from "@/components/admin/heal/cards/QueuedStallSuggestionCard";
import { StatusReverterAlertsCard } from "@/components/admin/heal/cards/StatusReverterAlertsCard";
import { HealFunctionAuditCard } from "@/components/admin/heal/cards/HealFunctionAuditCard";
import { DidaktikAuditCard } from "@/components/admin/heal/cards/DidaktikAuditCard";
import { BuildIntegrityE2ECard } from "@/components/admin/heal/cards/BuildIntegrityE2ECard";
import { LaneReasonBreakdownCard } from "@/components/admin/heal/cards/LaneReasonBreakdownCard";
import { WorkerHeartbeatSSOTCard } from "@/components/admin/heal/cards/WorkerHeartbeatSSOTCard";
import { SeoPublishDriftCard } from "@/components/admin/heal/cards/SeoPublishDriftCard";

// Queue-Detail-Tabs (lazy — schwer)
const QueueLiveTab = lazy(() => import("@/pages/admin/v2/QueuePage"));
const HealTab = lazy(() =>
  import("@/components/admin/queue-cockpit/HealCockpitTabContent").then((m) => ({
    default: m.HealCockpitTabContent,
  })),
);
const StuckTab = lazy(() =>
  import("@/components/admin/queue-cockpit/StuckStepsTabContent").then((m) => ({
    default: m.StuckStepsTabContent,
  })),
);
const RepairTab = lazy(() =>
  import("@/components/admin/queue-cockpit/RepairQueueTabContent").then((m) => ({
    default: m.RepairQueueTabContent,
  })),
);
const StagnationTab = lazy(() =>
  import("@/components/admin/queue-cockpit/StagnationTabContent").then((m) => ({
    default: m.StagnationTabContent,
  })),
);
const RetryTab = lazy(() =>
  import("@/components/admin/queue-cockpit/RetryLoopTabContent").then((m) => ({
    default: m.RetryLoopTabContent,
  })),
);
const AuditTab = lazy(() =>
  import("@/components/admin/queue-cockpit/BypassAuditTabContent").then((m) => ({
    default: m.BypassAuditTabContent,
  })),
);
const ExplainTab = lazy(() =>
  import("@/components/admin/queue-cockpit/IntegrityExplainTabContent").then((m) => ({
    default: m.IntegrityExplainTabContent,
  })),
);
const HealingWizardTab = lazy(() =>
  import("@/components/admin/queue-cockpit/HealingWizardTabContent").then((m) => ({
    default: m.HealingWizardTabContent,
  })),
);

const QUEUE_SUBTABS = [
  { value: "live", label: "Live", icon: Activity, hint: "Aktive Jobs in Echtzeit" },
  { value: "heal", label: "Heal-Worklist", icon: Stethoscope, hint: "Smart-Heal-Worklist" },
  { value: "wizard", label: "Wizard", icon: Wand2, hint: "Geführter Heal-Wizard + Timeline" },
  { value: "stuck", label: "Stuck", icon: AlertTriangle, hint: "Festgefahrene Pipeline-Steps" },
  { value: "repair", label: "Repair", icon: Wrench, hint: "Geplante Reparatur-Jobs" },
  { value: "stagnation", label: "Stagnation", icon: ListChecks, hint: "Cooldown-/Backoff-Stagnation" },
  { value: "retry", label: "Retry-Loops", icon: RefreshCw, hint: "Endlosschleifen-Detektor" },
  { value: "explain", label: "Explain", icon: Filter, hint: "Integrity Explain Mode" },
  { value: "audit", label: "Audit", icon: Shield, hint: "Bypass / Force-Done Audit" },
] as const;

type QueueSubTab = (typeof QUEUE_SUBTABS)[number]["value"];
const VALID_QUEUE_SUBTABS = new Set<string>(QUEUE_SUBTABS.map((t) => t.value));

const LoadingFallback = () => (
  <div className="space-y-3 py-4">
    <Skeleton className="h-8 w-64" />
    <Skeleton className="h-32 w-full" />
  </div>
);

// 4 Hauptgruppen statt 12 Sections
const SECTIONS = {
  pulse: "pulse",
  recover: "recover",
  packages: "packages",
  advanced: "advanced",
} as const;

const DEFAULT_OPEN = ["pulse", "recover"];

export default function HealCockpitPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<BlockerKey | "ALL">("ALL");
  const [advancedTab, setAdvancedTab] = useState<string>("triage");

  const rawSubtab = params.get("queue_tab");
  const queueSubtab: QueueSubTab =
    rawSubtab && VALID_QUEUE_SUBTABS.has(rawSubtab) ? (rawSubtab as QueueSubTab) : "live";

  const setQueueSubtab = (v: string) => {
    const next = new URLSearchParams(params);
    next.set("queue_tab", v);
    setParams(next, { replace: true });
  };

  const refreshAll = () => qc.invalidateQueries();

  // Quick-Action: Reap pro Lane (mit Bestätigung via AlertDialog)
  const reapLane = useMutation({
    mutationFn: async (lane: "control" | "all") => {
      const { data, error } = await supabase.rpc(
        "admin_reap_stale_processing_now" as any,
        {
          p_max_age_seconds: 300,
          p_max_cancels: 100,
          p_lane: lane === "all" ? null : lane,
        },
      );
      if (error) throw error;
      return { lane, res: data as any };
    },
    onSuccess: ({ lane, res }) => {
      toast.success(
        `Reap (${lane}): ${res?.failed_terminal ?? 0} terminal · ${res?.requeued ?? 0} requeued`,
      );
      qc.invalidateQueries({ queryKey: ["admin-lane-health"] });
      qc.invalidateQueries({ queryKey: ["queue-throughput-v2"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Reap fehlgeschlagen"),
  });

  return (
    <div className="space-y-4 max-w-[1500px] mx-auto pb-12">
      <AdminPageHeader
        icon={Heart}
        title="Heal Cockpit"
        description="Pulse → Recover → Pakete heilen. Erweiterte Tools sind eingeklappt."
        documentTitle="Heal Cockpit · Admin"
        metaDescription="Konsolidierter Steuerstand für Stale-Reaper, Hot-Loop-Quarantäne, Targeted Recheck, Track-Normalize, Heal-Strategien und Live-Queue."
        actions={
          <div className="flex items-center gap-2 flex-wrap" data-quick-reap>
            <QuickReapButton
              lane="control"
              label="Reap Control-Lane"
              variant="destructive"
              pending={reapLane.isPending}
              onConfirm={() => reapLane.mutate("control")}
            />
            <QuickReapButton
              lane="all"
              label="Reap All"
              variant="outline"
              pending={reapLane.isPending}
              onConfirm={() => reapLane.mutate("all")}
            />
            <Button variant="outline" size="sm" onClick={refreshAll}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
            </Button>
          </div>
        }
      />

      <AlertsBanner />
      <HealKpiHeroCard />
      <NextActionCard />

      <Accordion type="multiple" defaultValue={DEFAULT_OPEN} className="space-y-2">
        {/* 1 — Pulse */}
        <AccordionItem value={SECTIONS.pulse} className="border rounded-lg bg-card px-4">
          <AccordionTrigger className="hover:no-underline">
            <SectionTitle
              icon={Activity}
              step={1}
              title="Pulse"
              hint="Throughput · Lane-Health · Blocker-Counts — was läuft, was steht?"
            />
          </AccordionTrigger>
          <AccordionContent className="pb-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <LaneHealthCard />
              <ThroughputCard windowHours={6} />
            </div>
            <WorkerHeartbeatSSOTCard />
            <LaneReasonBreakdownCard />
            <BlockerCountsCard filter={filter} onFilterChange={setFilter} />
          </AccordionContent>
        </AccordionItem>

        {/* 2 — Quick Recover */}
        <AccordionItem value={SECTIONS.recover} className="border rounded-lg bg-card px-4 border-destructive/30">
          <AccordionTrigger className="hover:no-underline">
            <SectionTitle
              icon={Zap}
              step={2}
              title="Quick Recover"
              hint="Stale-Reap (lane-aware mit Bestätigung) · Hot-Loop Quarantäne · Drain"
              tone="destructive"
            />
          </AccordionTrigger>
          <AccordionContent className="pb-4 space-y-3">
            <RecoverActionsCard />
            <QueueDrainCard />
          </AccordionContent>
        </AccordionItem>

        {/* 3 — Pakete heilen */}
        <AccordionItem value={SECTIONS.packages} data-section="packages" className="border rounded-lg bg-card px-4 border-primary/30">
          <AccordionTrigger className="hover:no-underline">
            <SectionTitle
              icon={Stethoscope}
              step={3}
              title="Pakete heilen"
              hint="Stuck-Patterns · Heal-Status pro Kurs · Targeted-Heal · Blocked-Packages"
            />
          </AccordionTrigger>
          <AccordionContent className="pb-4 space-y-3">
            <PublishTailBlockersCard />
            <DidaktikAuditCard />
            <BuildIntegrityE2ECard />
            <SeoPublishDriftCard />
            <RecurringPatternsCard limit={10} />
            <PermanentFixBacklogCard />
            <CourseHealPlansCard />
            <ExamPoolQuarantineCard />
            <DriftOverviewCard />
            <SnapshotDriftCard />
            <SystemIntentsKpiCard />
            <NotificationKpiCard />
            <NotificationAttributionCard />
            <NotificationHealthCard />
            <NotificationActionFunnelCard />
            <NotificationSuppressionGovernanceCard />
            <NotificationRecoveryRoutingCard />
            <NotificationEffectivenessCard />
            <AdaptivePolicyCard />
            <PolicyImpactFunnelCard />
            <NotificationFinalizationCard />
            <NotificationRevenueAttributionCard />
            <B2bRenewalPipelineCard />
            <UpsellDiscoveryCard />
            <TrackM4StatusCard />
            <TrackM5StatusCard />
            <TrackM6StatusCard />
            <TrackM7StatusCard />
            <TrackM8StatusCard />
            <TrackM9StatusCard />
            <OperationalStateCard />
            <GrowthSignalsCard />
            <GrowthClassificationCard />
            <CanonicalDriftRunbookCard />
            <AttributionAuditCard />
            <RepairEligibilityCard />
            <CustomerSafeReadinessCard />
            <PackagePipelineLiveCard />
            <HealAuditLayersCard />
            <QueuedStallSuggestionCard />
            <StatusReverterAlertsCard />
            <HealFunctionAuditCard />
            <StuckPatternsCard />
            <AutoPublishRetryCard />
            <ManualRetryAuditCard />
            <BronzeQuarantineCard />
            <HealStatusCard />
            <SoftDriftMcRepairCard />
            <JobTypeWorkerAuditCard />
            <StaleDraftsCard />
            <LearningIntegrityExecutiveCard />
            <LxiNoLessonsRepairCard />
            <ContentGapTopupCard />
            <StaleDoneStepsCard />
            <ContinuationFailuresCard />
            <ForcePublishLogPanel />
            <CouncilDeferredCard />
            <ExamPoolDriftLogCard />
            <TargetedHealCard />
            <BlockedPackagesCard />
          </AccordionContent>
        </AccordionItem>

        {/* 4 — Erweitert (collapsed) */}
        <AccordionItem value={SECTIONS.advanced} className="border rounded-lg bg-card px-4">
          <AccordionTrigger className="hover:no-underline">
            <SectionTitle
              icon={Settings}
              step={4}
              title="Erweitert"
              hint="Diagnostik-Detail · Triage · Recheck · Drill-down · Auto-Selector · Reaper · Strategien · Queue-Tabs"
            />
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <Tabs value={advancedTab} onValueChange={setAdvancedTab} className="w-full">
              <Card className="p-1 mb-4">
                <TabsList className="w-full flex flex-wrap h-auto gap-1 bg-transparent p-0">
                  {ADVANCED_TABS.map((t) => (
                    <TabsTrigger
                      key={t.value}
                      value={t.value}
                      title={t.hint}
                      className="flex-1 min-w-[7rem] gap-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
                    >
                      <t.icon className="h-3.5 w-3.5" />
                      {t.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Card>

              <TabsContent value="diagnostics" className="space-y-3">
                <DrainOrchestratorCard />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <WorkerThroughputForensicsCard />
                  <RecoveryPulseHistoryCard />
                </div>
                <AutoPublishErrorOverviewCard />
                <StaleLockEscalationsCard />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <PendingAgeHistogramCard />
                  <CancelReasonBreakdownCard />
                </div>
                <CancelHotspotsCard />
                <PreHeartbeatKillRiskCard />
                <PreHeartbeatKillForensicsCard />
                <AggregateStateDiffCard />
                <QualityGateDecisionsCard />
                <OpsCancelSkipRiseCard />
                <LessonJoinParityCard />
                <PostPublishOrchestratorCard />
                <PaidButNotDeliveredCard />
                <ActivationFunnelCard />
                <ExamReadinessDistributionCard />
                <ContentFeedbackPipelineCard />
                <NextBestActionDistributionCard />
                <ExamSuccessDriversCard />
                <InterventionEffectivenessCard />
                <NbaWeightingHealthCard />
                <TutorInterventionHealthCard />
                <CohortPopulationIntelligenceCard />
                <TrainerIntelligenceCard />
                <AutonomousOptimizationCard />
                <SkillGraphIntelligenceCard />
                <AdaptivePathOrchestrationCard />
                <CognitiveLoadIntelligenceCard />
                <TemporalIntelligenceCard />
                <PredictiveSimulationCard />
                <SeoJobHealthCard />
                <SeoGraphImpactCard />
                <SeoGraphReconCard />
                <SeoBridgeActivationCard />
                <HealAutomationControlCard />
                <NotificationDeliveryHealthCard />
                <AccessSsotHealthCard />
                <ArtifactCompletenessCard />
                <WorkerOutputBreakdownCard />
                <PackageHealLogViewerCard />
                <HealRunDrilldownCard />
                <AutoPulseImpactCard />
                <ControlLaneRequeueCard />
                <QualityCouncilDriftCard />
                <BlockedReasonDetailCard />
              </TabsContent>

              <TabsContent value="triage">
                <TriageCards />
              </TabsContent>

              <TabsContent value="recheck">
                <TargetedRecheckCard />
              </TabsContent>

              <TabsContent value="drilldown">
                <DrillDownCard filter={filter} onResetFilter={() => setFilter("ALL")} />
              </TabsContent>

              <TabsContent value="selector">
                <AutoSelectorCard />
              </TabsContent>

              <TabsContent value="reaper">
                <ReaperGovernanceCard />
              </TabsContent>

              <TabsContent value="strategy">
                <HealStrategyCard />
              </TabsContent>

              <TabsContent value="queue">
                <Tabs value={queueSubtab} onValueChange={setQueueSubtab} className="w-full">
                  <Card className="p-1">
                    <TabsList className="w-full flex flex-wrap h-auto gap-1 bg-transparent p-0">
                      {QUEUE_SUBTABS.map((t) => (
                        <TabsTrigger
                          key={t.value}
                          value={t.value}
                          title={t.hint}
                          className="flex-1 min-w-[7rem] gap-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
                        >
                          <t.icon className="h-3.5 w-3.5" />
                          {t.label}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Card>
                  <TabsContent value="live" className="mt-4">
                    <Suspense fallback={<LoadingFallback />}><QueueLiveTab /></Suspense>
                  </TabsContent>
                  <TabsContent value="heal" className="mt-4">
                    <Suspense fallback={<LoadingFallback />}><HealTab /></Suspense>
                  </TabsContent>
                  <TabsContent value="wizard" className="mt-4">
                    <Suspense fallback={<LoadingFallback />}><HealingWizardTab /></Suspense>
                  </TabsContent>
                  <TabsContent value="stuck" className="mt-4">
                    <Suspense fallback={<LoadingFallback />}><StuckTab /></Suspense>
                  </TabsContent>
                  <TabsContent value="repair" className="mt-4">
                    <Suspense fallback={<LoadingFallback />}><RepairTab /></Suspense>
                  </TabsContent>
                  <TabsContent value="stagnation" className="mt-4">
                    <Suspense fallback={<LoadingFallback />}><StagnationTab /></Suspense>
                  </TabsContent>
                  <TabsContent value="retry" className="mt-4">
                    <Suspense fallback={<LoadingFallback />}><RetryTab /></Suspense>
                  </TabsContent>
                  <TabsContent value="explain" className="mt-4">
                    <Suspense fallback={<LoadingFallback />}><ExplainTab /></Suspense>
                  </TabsContent>
                  <TabsContent value="audit" className="mt-4">
                    <Suspense fallback={<LoadingFallback />}><AuditTab /></Suspense>
                  </TabsContent>
                </Tabs>
              </TabsContent>
            </Tabs>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

const ADVANCED_TABS = [
  { value: "diagnostics", label: "Diagnostik", icon: AlertTriangle, hint: "Pending-Age, Cancel-Reasons, Council-Drift, Blocked-Detail" },
  { value: "triage", label: "Triage", icon: Crosshair, hint: "Failed-Cluster, Hollow, Track-Normalize" },
  { value: "recheck", label: "Recheck", icon: Stethoscope, hint: "Targeted Blocker Recheck" },
  { value: "drilldown", label: "Drill-down", icon: Filter, hint: "Pakete pro Blocker" },
  { value: "selector", label: "Selector", icon: Wand2, hint: "Exam-Pool Auto-Selector" },
  { value: "reaper", label: "Reaper", icon: Settings, hint: "Reaper-Governance + Audit" },
  { value: "strategy", label: "Strategien", icon: Shield, hint: "Auto-Repair Toggles" },
  { value: "queue", label: "Queue-Tabs", icon: ListChecks, hint: "Live/Heal/Stuck/Repair/Stagnation/Retry/Audit/Explain" },
] as const;

function QuickReapButton({
  lane,
  label,
  variant,
  pending,
  onConfirm,
}: {
  lane: "control" | "all";
  label: string;
  variant: "destructive" | "outline";
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant={variant} disabled={pending}>
          <Zap className="h-3.5 w-3.5 mr-1.5" /> {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Stale-Reap für{" "}
            <span className="font-mono">{lane === "all" ? "alle Lanes" : lane}</span> ausführen?
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2 text-sm">
            <span className="block">
              Cancelt bis zu <strong>100 processing-Jobs</strong>{" "}
              {lane === "all" ? "in allen Lanes" : `in Lane ${lane}`} ohne Heartbeat &gt; 5min.
            </span>
            <span className="block text-muted-foreground">
              Jobs mit attempts &lt; max werden requeued (run_after +60s), sonst terminal-failed.
              Audit in <span className="font-mono">admin_actions</span>.
            </span>
            {lane === "control" && (
              <span className="block rounded border border-destructive/40 bg-destructive-bg-subtle p-2 text-[11px]">
                ⚠️ Control-Lane: Council / Auto-Publish / Promote. Tail-Step-Defer-Trigger fängt
                blockierte Pakete idR auf.
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-destructive hover:bg-destructive/90">
            Reap ausführen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SectionTitle({
  icon: Icon, step, title, hint, tone,
}: {
  icon: any; step: number; title: string; hint: string; tone?: "destructive";
}) {
  return (
    <div className="flex items-center gap-3 flex-1 text-left">
      <Badge
        variant={tone === "destructive" ? "destructive" : "outline"}
        className="text-[10px] tabular-nums shrink-0 h-5 px-1.5"
      >
        {step}
      </Badge>
      <Icon className="h-4 w-4 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">{title}</div>
        <div className="text-[11px] text-muted-foreground font-normal truncate">{hint}</div>
      </div>
    </div>
  );
}
