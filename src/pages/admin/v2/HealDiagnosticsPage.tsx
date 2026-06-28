/**
 * Heal Diagnostics — /admin/heal/diagnostics
 *
 * Verschoben aus HealCockpitPage (Hard-Trim 2026-06-28).
 * Sammlung aller tieferen Forensik-/KPI-/Intelligence-Cards, gruppiert
 * in 6 Tabs. Das Haupt-Cockpit zeigt nur noch die ~10 kritischen Cards;
 * alles andere lebt hier.
 */
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { AdminPageHeader } from "@/components/admin/v2/AdminPageHeader";
import {
  Activity, Bell, Layers, TrendingUp, Search, Brain,
} from "lucide-react";

// Worker / Lane forensics
import { WorkerThroughputForensicsCard } from "@/components/admin/heal/cards/WorkerThroughputForensicsCard";
import { WorkerOutputBreakdownCard } from "@/components/admin/heal/cards/WorkerOutputBreakdownCard";
import { PendingAgeHistogramCard } from "@/components/admin/heal/cards/PendingAgeHistogramCard";
import { CancelReasonBreakdownCard } from "@/components/admin/heal/cards/CancelReasonBreakdownCard";
import { CancelHotspotsCard } from "@/components/admin/heal/cards/CancelHotspotsCard";
import { PreHeartbeatKillRiskCard } from "@/components/admin/heal/cards/PreHeartbeatKillRiskCard";
import { PreHeartbeatKillForensicsCard } from "@/components/admin/heal/cards/PreHeartbeatKillForensicsCard";
import { AggregateStateDiffCard } from "@/components/admin/heal/cards/AggregateStateDiffCard";
import { OpsCancelSkipRiseCard } from "@/components/admin/heal/cards/OpsCancelSkipRiseCard";
import { ControlLaneRequeueCard } from "@/components/admin/heal/cards/ControlLaneRequeueCard";
import { BlockedReasonDetailCard } from "@/components/admin/heal/cards/BlockedReasonDetailCard";
import { JobTypeWorkerAuditCard } from "@/components/admin/heal/cards/JobTypeWorkerAuditCard";
import { DrainOrchestratorCard } from "@/components/admin/heal/cards/DrainOrchestratorCard";
import { RecoveryPulseHistoryCard } from "@/components/admin/heal/cards/RecoveryPulseHistoryCard";

// Notifications
import NotificationKpiCard from "@/components/admin/heal/cards/NotificationKpiCard";
import NotificationAttributionCard from "@/components/admin/heal/cards/NotificationAttributionCard";
import NotificationHealthCard from "@/components/admin/heal/cards/NotificationHealthCard";
import NotificationActionFunnelCard from "@/components/admin/heal/cards/NotificationActionFunnelCard";
import NotificationSuppressionGovernanceCard from "@/components/admin/heal/cards/NotificationSuppressionGovernanceCard";
import NotificationRecoveryRoutingCard from "@/components/admin/heal/cards/NotificationRecoveryRoutingCard";
import NotificationEffectivenessCard from "@/components/admin/heal/cards/NotificationEffectivenessCard";
import NotificationFinalizationCard from "@/components/admin/heal/cards/NotificationFinalizationCard";
import NotificationRevenueAttributionCard from "@/components/admin/heal/cards/NotificationRevenueAttributionCard";
import AdaptivePolicyCard from "@/components/admin/heal/cards/AdaptivePolicyCard";
import PolicyImpactFunnelCard from "@/components/admin/heal/cards/PolicyImpactFunnelCard";
import { NotificationDeliveryHealthCard } from "@/components/admin/heal/cards/NotificationDeliveryHealthCard";

// Tracks
import { TrackM4StatusCard } from "@/components/admin/heal/cards/TrackM4StatusCard";
import { TrackM5StatusCard } from "@/components/admin/heal/cards/TrackM5StatusCard";
import { TrackM6StatusCard } from "@/components/admin/heal/cards/TrackM6StatusCard";
import { TrackM7StatusCard } from "@/components/admin/heal/cards/TrackM7StatusCard";
import { TrackM8StatusCard } from "@/components/admin/heal/cards/TrackM8StatusCard";
import { TrackM9StatusCard } from "@/components/admin/heal/cards/TrackM9StatusCard";

// Growth / Commerce
import B2bRenewalPipelineCard from "@/components/admin/heal/cards/B2bRenewalPipelineCard";
import UpsellDiscoveryCard from "@/components/admin/heal/cards/UpsellDiscoveryCard";
import { GrowthSignalsCard } from "@/components/admin/heal/cards/GrowthSignalsCard";
import { GrowthClassificationCard } from "@/components/admin/heal/cards/GrowthClassificationCard";
import { AttributionAuditCard } from "@/components/admin/heal/cards/AttributionAuditCard";
import { ActivationFunnelCard } from "@/components/admin/heal/cards/ActivationFunnelCard";
import { CommerceReadinessCard } from "@/components/admin/heal/cards/CommerceReadinessCard";
import { DriftOverviewCard } from "@/components/admin/heal/cards/DriftOverviewCard";
import { SnapshotDriftCard } from "@/components/admin/heal/cards/SnapshotDriftCard";
import { RepairEligibilityCard } from "@/components/admin/heal/cards/RepairEligibilityCard";

// SEO
import { SeoJobHealthCard } from "@/components/admin/heal/cards/SeoJobHealthCard";
import { SeoGraphImpactCard } from "@/components/admin/heal/cards/SeoGraphImpactCard";
import { SeoGraphReconCard } from "@/components/admin/heal/cards/SeoGraphReconCard";
import { SeoBridgeActivationCard } from "@/components/admin/heal/cards/SeoBridgeActivationCard";
import { SeoBridgeOutcomeCard } from "@/components/admin/heal/cards/SeoBridgeOutcomeCard";
import { SeoCornerstoneEnrichmentCard } from "@/components/admin/heal/cards/SeoCornerstoneEnrichmentCard";
import { SeoBridgePromotionCard } from "@/components/admin/heal/cards/SeoBridgePromotionCard";
import { SeoPublishDriftCard } from "@/components/admin/heal/cards/SeoPublishDriftCard";
import { CanonicalDriftRunbookCard } from "@/components/admin/heal/cards/CanonicalDriftRunbookCard";

// Intelligence / Adaptive
import { ExamReadinessDistributionCard } from "@/components/admin/heal/cards/ExamReadinessDistributionCard";
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
import { ContentFeedbackPipelineCard } from "@/components/admin/heal/cards/ContentFeedbackPipelineCard";

// Quality / Misc
import { QualityGateDecisionsCard } from "@/components/admin/heal/cards/QualityGateDecisionsCard";
import { QualityCouncilDriftCard } from "@/components/admin/heal/cards/QualityCouncilDriftCard";
import { LessonJoinParityCard } from "@/components/admin/heal/cards/LessonJoinParityCard";
import { PostPublishOrchestratorCard } from "@/components/admin/heal/cards/PostPublishOrchestratorCard";
import { ArtifactCompletenessCard } from "@/components/admin/heal/cards/ArtifactCompletenessCard";
import { AutoPublishErrorOverviewCard } from "@/components/admin/heal/cards/AutoPublishErrorOverviewCard";
import { StaleLockEscalationsCard } from "@/components/admin/heal/cards/StaleLockEscalationsCard";
import { HealAutomationControlCard } from "@/components/admin/heal/cards/HealAutomationControlCard";
import { AccessSsotHealthCard } from "@/components/admin/heal/cards/AccessSsotHealthCard";
import { PackageHealLogViewerCard } from "@/components/admin/heal/cards/PackageHealLogViewerCard";
import { HealRunDrilldownCard } from "@/components/admin/heal/cards/HealRunDrilldownCard";
import { AutoPulseImpactCard } from "@/components/admin/heal/cards/AutoPulseImpactCard";

const TABS = [
  { value: "worker", label: "Worker & Lane", icon: Activity },
  { value: "notifications", label: "Notifications", icon: Bell },
  { value: "tracks", label: "Tracks", icon: Layers },
  { value: "growth", label: "Growth & Drift", icon: TrendingUp },
  { value: "seo", label: "SEO", icon: Search },
  { value: "intelligence", label: "Intelligence", icon: Brain },
] as const;

export default function HealDiagnosticsPage() {
  return (
    <div className="space-y-4 max-w-[1500px] mx-auto pb-12">
      <AdminPageHeader
        icon={Activity}
        title="Heal Diagnostics"
        description="Tiefe Forensik-, KPI- und Intelligence-Cards (aus Cockpit ausgelagert)."
        documentTitle="Heal Diagnostics · Admin"
        metaDescription="Erweiterte Diagnose-Cards für Worker-Forensik, Notifications, Tracks, Growth, SEO und Adaptive Intelligence."
      />

      <Tabs defaultValue="worker" className="w-full">
        <Card className="p-1">
          <TabsList className="w-full flex flex-wrap h-auto gap-1 bg-transparent p-0">
            {TABS.map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className="flex-1 min-w-[7rem] gap-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Card>

        <TabsContent value="worker" className="space-y-3 mt-4">
          <DrainOrchestratorCard />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <WorkerThroughputForensicsCard />
            <RecoveryPulseHistoryCard />
          </div>
          <WorkerOutputBreakdownCard />
          <JobTypeWorkerAuditCard />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <PendingAgeHistogramCard />
            <CancelReasonBreakdownCard />
          </div>
          <CancelHotspotsCard />
          <PreHeartbeatKillRiskCard />
          <PreHeartbeatKillForensicsCard />
          <AggregateStateDiffCard />
          <OpsCancelSkipRiseCard />
          <ControlLaneRequeueCard />
          <BlockedReasonDetailCard />
        </TabsContent>

        <TabsContent value="notifications" className="space-y-3 mt-4">
          <NotificationKpiCard />
          <NotificationHealthCard />
          <NotificationDeliveryHealthCard />
          <NotificationActionFunnelCard />
          <NotificationEffectivenessCard />
          <NotificationAttributionCard />
          <NotificationRevenueAttributionCard />
          <NotificationFinalizationCard />
          <NotificationSuppressionGovernanceCard />
          <NotificationRecoveryRoutingCard />
          <AdaptivePolicyCard />
          <PolicyImpactFunnelCard />
        </TabsContent>

        <TabsContent value="tracks" className="space-y-3 mt-4">
          <TrackM4StatusCard />
          <TrackM5StatusCard />
          <TrackM6StatusCard />
          <TrackM7StatusCard />
          <TrackM8StatusCard />
          <TrackM9StatusCard />
        </TabsContent>

        <TabsContent value="growth" className="space-y-3 mt-4">
          <CommerceReadinessCard />
          <ActivationFunnelCard />
          <GrowthSignalsCard />
          <GrowthClassificationCard />
          <AttributionAuditCard />
          <B2bRenewalPipelineCard />
          <UpsellDiscoveryCard />
          <DriftOverviewCard />
          <SnapshotDriftCard />
          <RepairEligibilityCard />
          <AutoPublishErrorOverviewCard />
          <StaleLockEscalationsCard />
          <HealAutomationControlCard />
        </TabsContent>

        <TabsContent value="seo" className="space-y-3 mt-4">
          <SeoJobHealthCard />
          <SeoPublishDriftCard />
          <CanonicalDriftRunbookCard />
          <SeoGraphImpactCard />
          <SeoGraphReconCard />
          <SeoBridgeActivationCard />
          <SeoBridgeOutcomeCard />
          <SeoCornerstoneEnrichmentCard />
          <SeoBridgePromotionCard />
        </TabsContent>

        <TabsContent value="intelligence" className="space-y-3 mt-4">
          <ExamReadinessDistributionCard />
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
          <ContentFeedbackPipelineCard />
          <QualityGateDecisionsCard />
          <QualityCouncilDriftCard />
          <LessonJoinParityCard />
          <PostPublishOrchestratorCard />
          <ArtifactCompletenessCard />
          <AccessSsotHealthCard />
          <PackageHealLogViewerCard />
          <HealRunDrilldownCard />
          <AutoPulseImpactCard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
