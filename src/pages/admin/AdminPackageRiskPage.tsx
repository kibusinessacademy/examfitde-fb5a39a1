import { AdminShell } from "@/components/admin/layout/AdminShell";
import { AdminSectionHeader } from "@/components/admin/layout/AdminSectionHeader";
import { PackageRiskTable } from "@/components/admin/tables/PackageRiskTable";
import { useAdminPackageRisk } from "@/components/admin/hooks/useAdminPackageRisk";
import { Skeleton } from "@/components/ui/skeleton";

export default function AdminPackageRiskPage() {
  const { data, isLoading, error } = useAdminPackageRisk();

  return (
    <AdminShell>
      <AdminSectionHeader
        title="Package Risk Board"
        subtitle="Blockierte & stalled Pakete, priorisiert nach Business Impact"
      />
      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
          Fehler: {(error as Error).message}
        </div>
      ) : data ? (
        <PackageRiskTable items={data} />
      ) : null}
    </AdminShell>
  );
}
