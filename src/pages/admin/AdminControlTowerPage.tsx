import { AdminTopHealthBar } from "@/components/admin/layout/AdminTopHealthBar";
import { AdminSectionHeader } from "@/components/admin/layout/AdminSectionHeader";
import { KpiCard } from "@/components/admin/cards/KpiCard";
import { AlertListCard } from "@/components/admin/cards/AlertListCard";
import { PipelineFlowCard } from "@/components/admin/cards/PipelineFlowCard";
import { CapacityCard } from "@/components/admin/cards/CapacityCard";
import { ReadinessSummaryCard } from "@/components/admin/cards/ReadinessSummaryCard";
import { ProblemPackagesCard } from "@/components/admin/cards/ProblemPackagesCard";
import { PipelineRepairCard } from "@/components/admin/cards/PipelineRepairCard";
import { ProgressDriftCard } from "@/components/admin/cards/ProgressDriftCard";
import { TelemetryIntegrityCard } from "@/components/admin/cards/TelemetryIntegrityCard";
import { useAdminControlTower } from "@/components/admin/hooks/useAdminControlTower";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Clock, CheckCircle, XCircle, Package, Cpu, Lock, ShieldAlert, Unplug } from "lucide-react";

export default function AdminControlTowerPage() {
  const { data, isLoading, error } = useAdminControlTower();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
        Fehler beim Laden der Leitwarte: {(error as Error).message}
      </div>
    );
  }

  if (!data) return null;

  return (
    <>
      <AdminTopHealthBar items={data.health} />
      <AdminSectionHeader
        title="Executive Control Tower"
        subtitle="SSOT-Systemlage in Echtzeit"
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Pending Jobs" value={data.kpis.pending_jobs} icon={<Clock className="h-4 w-4 text-muted-foreground" />} />
        <KpiCard label="Processing" value={data.kpis.processing_jobs} icon={<Cpu className="h-4 w-4 text-muted-foreground" />} />
        <KpiCard label="Completed 24h" value={data.kpis.completed_24h} icon={<CheckCircle className="h-4 w-4 text-emerald-400" />} />
        <KpiCard label="Failed 24h" value={data.kpis.failed_24h} icon={<XCircle className="h-4 w-4 text-rose-400" />} />
        <KpiCard label="Stalled Packages" value={data.kpis.stalled_packages} icon={<Package className="h-4 w-4 text-amber-400" />} />
        <KpiCard label="Provider Cooldowns" value={data.kpis.provider_cooldowns} icon={<AlertTriangle className="h-4 w-4 text-orange-400" />} />
        <KpiCard label="Blocked Publishables" value={data.kpis.blocked_publishables} icon={<Lock className="h-4 w-4 text-muted-foreground" />} />
        <KpiCard label="Claim Issues" value={data.kpis.open_claim_issues} icon={<ShieldAlert className="h-4 w-4 text-muted-foreground" />} />
        <KpiCard label="Content Starvation" value={data.kpis.lc_starvation} icon={<Unplug className="h-4 w-4 text-destructive" />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <AlertListCard alerts={data.alerts} />
        <PipelineFlowCard items={data.pipeline} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ReadinessSummaryCard />
        <ProgressDriftCard />
      </div>

      <div className="mt-6">
        <TelemetryIntegrityCard />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <CapacityCard />
        <ProblemPackagesCard />
      </div>
    </>
  );
}
