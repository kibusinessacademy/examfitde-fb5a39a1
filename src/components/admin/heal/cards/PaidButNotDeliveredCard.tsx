/**
 * PaidButNotDeliveredCard
 *
 * Operative Sichtbarkeit für Post-Purchase Delivery Assurance v1.
 * Zeigt alle bezahlten Orders, deren delivery_status != 'confirmed' ist
 * (SLA: 2 Minuten). Ermöglicht Per-Order-Repair via
 * admin_repair_purchase_delivery.
 *
 * Quelle: RPC admin_get_paid_but_not_delivered(p_limit).
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, Wrench, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Row {
  order_id: string;
  buyer_user_id: string | null;
  learner_user_id: string | null;
  billing_email: string | null;
  total_cents: number | null;
  paid_at: string | null;
  delivery_status: string | null;
  delivery_blocking_reasons: string[] | null;
  delivery_last_checked_at: string | null;
  age_minutes: number | null;
}

const statusVariant = (status: string | null): { label: string; tone: string } => {
  switch (status) {
    case "confirmed": return { label: "confirmed", tone: "bg-status-success-bg-subtle text-status-success-fg" };
    case "blocked":   return { label: "blocked",   tone: "bg-status-error-bg-subtle text-status-error-fg" };
    case "failed":    return { label: "failed",    tone: "bg-status-error-bg-subtle text-status-error-fg" };
    case "in_progress": return { label: "in_progress", tone: "bg-status-warning-bg-subtle text-status-warning-fg" };
    case "pending":   return { label: "pending",   tone: "bg-status-warning-bg-subtle text-status-warning-fg" };
    default:          return { label: status ?? "unknown", tone: "bg-surface-muted text-text-muted" };
  }
};

export function PaidButNotDeliveredCard() {
  const qc = useQueryClient();
  const [limit, setLimit] = useState(50);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin_paid_but_not_delivered", limit],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_paid_but_not_delivered", { p_limit: limit });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 30_000,
  });

  const repair = useMutation({
    mutationFn: async (orderId: string) => {
      const { data, error } = await supabase.rpc("admin_repair_purchase_delivery", { p_order_id: orderId });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Repair-Fanout enqueued (priority 80)");
      qc.invalidateQueries({ queryKey: ["admin_paid_but_not_delivered"] });
    },
    onError: (e: any) => toast.error(`Repair fehlgeschlagen: ${e.message}`),
  });

  const rows = data ?? [];
  const breached = rows.filter((r) => (r.age_minutes ?? 0) > 2);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-status-warning-fg" />
          <h3 className="text-sm font-semibold text-text">Paid but not delivered</h3>
          <Badge variant="outline" className="text-xs">SLA 2min</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={breached.length > 0 ? "destructive" : "secondary"} className="text-xs">
            {rows.length} offen · {breached.length} SLA-Bruch
          </Badge>
          <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <p className="text-xs text-text-muted">
        Bezahlte Orders ohne <code>delivery_status='confirmed'</code>. Akzeptanz: ≤2 min nach paid.
      </p>

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : rows.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-status-success-fg">
          <CheckCircle2 className="h-4 w-4" />
          Keine offenen Delivery-Cases. Alle bezahlten Orders bestätigt.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-text-muted">
              <tr className="border-b border-border">
                <th className="text-left py-2 pr-3">Order</th>
                <th className="text-left py-2 pr-3">Email</th>
                <th className="text-left py-2 pr-3">Status</th>
                <th className="text-left py-2 pr-3">Reasons</th>
                <th className="text-right py-2 pr-3">Age</th>
                <th className="text-right py-2">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const sv = statusVariant(r.delivery_status);
                const age = r.age_minutes ?? 0;
                const isBreach = age > 2;
                return (
                  <tr key={r.order_id} className="border-b border-border/50">
                    <td className="py-2 pr-3 font-mono text-[10px] text-text-muted">
                      {r.order_id.slice(0, 8)}…
                    </td>
                    <td className="py-2 pr-3 text-text">{r.billing_email ?? "—"}</td>
                    <td className="py-2 pr-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] ${sv.tone}`}>{sv.label}</span>
                    </td>
                    <td className="py-2 pr-3 text-text-muted">
                      {(r.delivery_blocking_reasons ?? []).join(", ") || "—"}
                    </td>
                    <td className={`py-2 pr-3 text-right tabular-nums ${isBreach ? "text-status-error-fg font-semibold" : "text-text-muted"}`}>
                      {age}m
                    </td>
                    <td className="py-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => repair.mutate(r.order_id)}
                        disabled={repair.isPending}
                      >
                        <Wrench className="h-3 w-3 mr-1" />
                        Repair
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 text-[10px] text-text-muted">
        <button onClick={() => setLimit(50)} className={limit === 50 ? "font-semibold" : ""}>50</button>
        <button onClick={() => setLimit(100)} className={limit === 100 ? "font-semibold" : ""}>100</button>
        <button onClick={() => setLimit(250)} className={limit === 250 ? "font-semibold" : ""}>250</button>
      </div>
    </Card>
  );
}
