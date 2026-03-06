import { AdminShell } from "@/components/admin/layout/AdminShell";
import { AdminSectionHeader } from "@/components/admin/layout/AdminSectionHeader";
import { OpsJobsTable } from "@/components/admin/tables/OpsJobsTable";
import { useAdminOpsQueue } from "@/components/admin/hooks/useAdminOpsQueue";
import { Skeleton } from "@/components/ui/skeleton";

export default function AdminOpsQueuePage() {
  const { data, isLoading, error } = useAdminOpsQueue();

  return (
    <AdminShell>
      <AdminSectionHeader
        title="Queue & Auto-Heal"
        subtitle="Live-Übersicht aller Pipeline-Jobs"
      />
      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
          Fehler: {(error as Error).message}
        </div>
      ) : data ? (
        <OpsJobsTable items={data} />
      ) : null}
    </AdminShell>
  );
}
