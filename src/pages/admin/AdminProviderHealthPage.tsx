import { AdminShell } from "@/components/admin/layout/AdminShell";
import { AdminSectionHeader } from "@/components/admin/layout/AdminSectionHeader";
import { ProviderRadarCard } from "@/components/admin/cards/ProviderRadarCard";
import { useAdminProviderHealth } from "@/components/admin/hooks/useAdminProviderHealth";
import { Skeleton } from "@/components/ui/skeleton";

export default function AdminProviderHealthPage() {
  const { data, isLoading, error } = useAdminProviderHealth();

  return (
    <AdminShell>
      <AdminSectionHeader
        title="Provider Health Radar"
        subtitle="Cooldowns, Success Rates, Latenz pro AI-Provider"
      />
      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
          Fehler: {(error as Error).message}
        </div>
      ) : data ? (
        <ProviderRadarCard items={data} />
      ) : null}
    </AdminShell>
  );
}
