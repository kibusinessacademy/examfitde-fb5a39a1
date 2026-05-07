/**
 * HealCockpitTabContent — Inhalt für Queue-Cockpit Tab "Heal"
 * ────────────────────────────────────────────────────────────
 * Reine Inhalts-Komponente ohne eigenen Helmet/Container.
 * Wird vom UnifiedQueueCockpit konsumiert.
 */
import { Link } from "react-router-dom";
import { Wrench, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MorningBriefing } from "@/components/admin/heal/MorningBriefing";
import { HealWorklist } from "@/components/admin/heal/HealWorklist";
import { BlockedPackagesCard } from "@/components/admin/heal/BlockedPackagesCard";
import { HealClusterExplanationPanel } from "@/components/admin/heal/HealClusterExplanationPanel";
import { CouplingHealV4Card } from "@/components/admin/heal/cards/CouplingHealV4Card";
import { BronzeReviewCard } from "@/components/admin/heal/cards/BronzeReviewCard";
import { ProducerNoiseTrendCard } from "@/components/admin/heal/cards/ProducerNoiseTrendCard";
import { LxiPublishBlockMonitorCard } from "@/components/admin/heal/cards/LxiPublishBlockMonitorCard";
import { LxiQueuedNoLessonsReinitCard } from "@/components/admin/heal/cards/LxiQueuedNoLessonsReinitCard";
import { PricingHealAuditCard } from "@/components/admin/heal/cards/PricingHealAuditCard";

export function HealCockpitTabContent() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end gap-2 flex-wrap">
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/ops/heal-settings">
            <Settings className="h-4 w-4 mr-1.5" />
            Strategie
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/queue?tab=repair">
            <Wrench className="h-4 w-4 mr-1.5" />
            Repair-Tab
          </Link>
        </Button>
      </div>
      <MorningBriefing />
      <LxiPublishBlockMonitorCard />
      <PricingHealAuditCard />
      <ProducerNoiseTrendCard />
      <BronzeReviewCard />
      <CouplingHealV4Card />
      <HealClusterExplanationPanel />
      <BlockedPackagesCard
        detailHrefBuilder={(id) => `/admin/studio/${id}`}
      />
      <HealWorklist />
    </div>
  );
}
