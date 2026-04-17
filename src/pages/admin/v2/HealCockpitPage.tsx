/**
 * Heal-Cockpit v8.2 — Page entry
 * SSOT-aggregated automation hub for blocked-but-fixable packages.
 */
import { Helmet } from "react-helmet-async";
import { MorningBriefing } from "@/components/admin/heal/MorningBriefing";
import { HealWorklist } from "@/components/admin/heal/HealWorklist";
import { Stethoscope } from "lucide-react";

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

      <header className="flex items-center gap-3">
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
      </header>

      <MorningBriefing />
      <HealWorklist />
    </div>
  );
}
