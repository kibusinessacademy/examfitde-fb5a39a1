import { IntakeConsoleCard } from "@/components/admin/operations-visibility/IntakeConsoleCard";
import { FanOutProgressCard } from "@/components/admin/operations-visibility/FanOutProgressCard";
import { PoolHealthDashboard } from "@/components/admin/operations-visibility/PoolHealthDashboard";

export default function OperationsVisibilityPage() {
  return (
    <div className="container mx-auto p-4 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Operations Visibility — Bundle A</h1>
        <p className="text-sm text-muted-foreground">
          Leitstelle für die Factory: Intake-Status, Fan-Out-Progress, Pool-Health auf einen Blick.
        </p>
      </header>
      <PoolHealthDashboard />
      <FanOutProgressCard />
      <IntakeConsoleCard />
    </div>
  );
}
