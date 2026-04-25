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
      <HealClusterExplanationPanel />
      <BlockedPackagesCard
        detailHrefBuilder={(id) => `/admin/studio/${id}`}
      />
      <HealWorklist />
    </div>
  );
}
