import { Helmet } from "react-helmet-async";
import { BypassAuditPanel } from "@/components/admin/heal/BypassAuditPanel";

export default function BypassAuditPage() {
  return (
    <div className="container mx-auto max-w-5xl space-y-4 p-4">
      <Helmet>
        <title>Bypass-Audit · Admin</title>
        <meta
          name="description"
          content="Verständliche Audit-Trail-Zusammenfassung für manuelle Bypass-Aktionen (admin_force_steps_done, force_run_job, unblock_package …) inkl. Step-Statuswechsel, betroffene Trigger und Reason."
        />
      </Helmet>
      <header>
        <h1 className="text-xl font-semibold">Bypass-Audit</h1>
        <p className="text-xs text-muted-foreground">
          Manuelle Heal-/Force-Aktionen mit Step-Statuswechsel, Trigger-Bypass und Reason.
        </p>
      </header>
      <BypassAuditPanel />
    </div>
  );
}
