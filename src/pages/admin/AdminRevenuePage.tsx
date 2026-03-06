import { AdminShell } from "@/components/admin/layout/AdminShell";
import { AdminSectionHeader } from "@/components/admin/layout/AdminSectionHeader";
import { KpiCard } from "@/components/admin/cards/KpiCard";
import { useAdminRevenue } from "@/components/admin/hooks/useAdminRevenue";
import { formatCurrency } from "@/components/admin/lib/admin-utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Euro, ShoppingCart, Users, AlertTriangle } from "lucide-react";

export default function AdminRevenuePage() {
  const { data, isLoading, error } = useAdminRevenue();

  return (
    <AdminShell>
      <AdminSectionHeader
        title="Revenue & Commerce"
        subtitle="Umsatz, Lizenzen, Claims"
      />
      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
          Fehler: {(error as Error).message}
        </div>
      ) : data ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard
            label="Umsatz heute"
            value={formatCurrency(data.revenue_today)}
            icon={<Euro className="h-4 w-4 text-emerald-400" />}
          />
          <KpiCard
            label="Umsatz 7d"
            value={formatCurrency(data.revenue_7d)}
            icon={<Euro className="h-4 w-4 text-muted-foreground" />}
          />
          <KpiCard
            label="Umsatz 30d"
            value={formatCurrency(data.revenue_30d)}
            icon={<Euro className="h-4 w-4 text-muted-foreground" />}
          />
          <KpiCard
            label="Orders heute"
            value={data.orders_today}
            icon={<ShoppingCart className="h-4 w-4 text-muted-foreground" />}
          />
          <KpiCard
            label="Claim Issues"
            value={data.open_claim_issues}
            icon={<AlertTriangle className="h-4 w-4 text-amber-400" />}
          />
          <KpiCard
            label="Corporate Seats"
            value={`${data.corporate_seats_claimed}/${data.corporate_seats_total}`}
            icon={<Users className="h-4 w-4 text-muted-foreground" />}
          />
          <KpiCard
            label="Checkout-Fehler 24h"
            value={data.checkout_failures_24h}
            icon={<AlertTriangle className="h-4 w-4 text-rose-400" />}
          />
        </div>
      ) : null}
    </AdminShell>
  );
}
