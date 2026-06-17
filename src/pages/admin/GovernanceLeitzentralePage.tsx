import { TriageInboxCard } from "@/components/admin/governance-ui/TriageInboxCard";
import { CouncilDagCard } from "@/components/admin/governance-ui/CouncilDagCard";
import { QuarantineCockpitCard } from "@/components/admin/governance-ui/QuarantineCockpitCard";

export default function GovernanceLeitzentralePage() {
  return (
    <div className="container mx-auto p-4 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Governance-Leitzentrale — Bundle D</h1>
        <p className="text-sm text-muted-foreground">
          Triage-Inbox · Council-DAG · Quarantäne-Cockpit. Read-only Default, alle Mutationen über
          bestehende RPCs (admin-gated).
        </p>
      </header>
      <TriageInboxCard />
      <div className="grid gap-4 lg:grid-cols-2">
        <CouncilDagCard />
        <QuarantineCockpitCard />
      </div>
    </div>
  );
}
