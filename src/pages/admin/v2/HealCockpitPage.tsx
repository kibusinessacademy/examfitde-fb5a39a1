/**
 * Heal-Cockpit v8.2 — Page entry
 * SSOT-aggregated automation hub for blocked-but-fixable packages.
 */
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { MorningBriefing } from "@/components/admin/heal/MorningBriefing";
import { HealWorklist } from "@/components/admin/heal/HealWorklist";
import { BlockedPackagesCard } from "@/components/admin/heal/BlockedPackagesCard";
import { HealClusterExplanationPanel } from "@/components/admin/heal/HealClusterExplanationPanel";
import { Stethoscope, Wrench, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function HealCockpitPage() {
  return (
    <div className="space-y-5 p-4 md:p-6">
      <Helmet>
        <title>Heal-Cockpit · Admin</title>
        <meta
          name="description"
          content="Integrierter Admin-Workflow für Guided Recovery, Bulk-Smart-Heal und Morning Briefing."
        />
      </Helmet>

      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-primary/10 p-2 text-primary">
            <Stethoscope className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Heal-Cockpit</h1>
            <p className="text-sm text-muted-foreground">
              Konsolidierte Recovery- und Publish-Steuerung über alle Pakete
              (v8.2 SSOT)
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/ops/heal-settings">
              <Settings className="h-4 w-4 mr-2" />
              Strategy Settings
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/ops/repair-queue">
              <Wrench className="h-4 w-4 mr-2" />
              Repair-Queue Dashboard
            </Link>
          </Button>
        </div>
      </header>

      <MorningBriefing />
      <HealClusterExplanationPanel />
      <BlockedPackagesCard detailHrefBuilder={(id) => `/admin/heal-cockpit/package/${id}`} />
      <HealWorklist />
    </div>
  );
}
