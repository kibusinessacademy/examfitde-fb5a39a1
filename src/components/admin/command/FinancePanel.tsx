import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  AdminSheet as Sheet, AdminSheetContent as SheetContent,
  AdminSheetHeader as SheetHeader, AdminSheetTitle as SheetTitle,
  AdminSheetDescription as SheetDescription,
} from '@/components/admin/AdminSheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DollarSign, TrendingUp, TrendingDown, AlertTriangle, Loader2,
  RefreshCw, Package, Zap, Users, CreditCard, ArrowRight,
  CheckCircle2, XCircle, ChevronDown, Eye
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';

/* ── Types ── */
interface OrderRow {
  id: string;
  user_id: string;
  status: string;
  total_amount: number;
  currency: string;
  created_at: string;
  payment_method?: string;
}

interface RefundRow {
  id: string;
  amount: number;
  status: string;
  created_at: string;
  reason?: string;
}

/* ── Revenue KPIs ── */
function useRevenueKpis() {
  return useQuery({
    queryKey: ['finance-revenue-kpis'],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.functions.invoke('admin-revenue-tower', { body: {} });
        if (error) throw error;
        return data;
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });
}

function useRecentOrders() {
  return useQuery({
    queryKey: ['finance-recent-orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders' as any)
        .select('id, user_id, status, total_amount, currency, created_at, payment_method')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) return [];
      return (data || []) as unknown as OrderRow[];
    },
    staleTime: 30_000,
  });
}

function useCostOverview() {
  return useQuery({
    queryKey: ['finance-cost-overview'],
    queryFn: async () => {
      const sb = supabase as any;
      const [costRes, econRes] = await Promise.all([
        sb.from('cost_intelligence').select('total_cost_eur, call_count').limit(50),
        sb.from('package_economics').select('cost_eur_30d, revenue_eur_30d, gross_margin_eur_30d, roi_30d').limit(100),
      ]);
      const costs = costRes.data || [];
      const econ = econRes.data || [];
      return {
        totalLlmCost: costs.reduce((s: number, c: any) => s + (c.total_cost_eur || 0), 0),
        totalCalls: costs.reduce((s: number, c: any) => s + (c.call_count || 0), 0),
        totalRevenue30d: econ.reduce((s: number, e: any) => s + (e.revenue_eur_30d || 0), 0),
        totalCost30d: econ.reduce((s: number, e: any) => s + (e.cost_eur_30d || 0), 0),
        totalMargin30d: econ.reduce((s: number, e: any) => s + (e.gross_margin_eur_30d || 0), 0),
        avgRoi: econ.length > 0 ? econ.reduce((s: number, e: any) => s + (e.roi_30d || 0), 0) / econ.length : 0,
        negativeMargePkgs: econ.filter((e: any) => (e.gross_margin_eur_30d || 0) < 0).length,
      };
    },
    staleTime: 60_000,
  });
}

/* ── Sub-Sheets ── */
function OrderDetailSheet({ order, open, onOpenChange }: { order: OrderRow | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  if (!order) return null;
  const statusTone: Record<string, string> = {
    completed: 'border-success/40 text-success bg-success/5',
    paid: 'border-success/40 text-success bg-success/5',
    pending: 'border-warning/40 text-warning bg-warning/5',
    failed: 'border-destructive/40 text-destructive bg-destructive/5',
    refunded: 'border-destructive/40 text-destructive bg-destructive/5',
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md ">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            Bestellung {order.id.slice(0, 8)}
          </SheetTitle>
          <SheetDescription>Details & Status</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 mt-4">
          <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", statusTone[order.status] || '')}>{order.status}</Badge>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border p-2">
              <div className="text-[9px] text-muted-foreground uppercase">Betrag</div>
              <div className="text-sm font-bold text-foreground">€{order.total_amount?.toFixed(2)}</div>
            </div>
            <div className="rounded-lg border border-border p-2">
              <div className="text-[9px] text-muted-foreground uppercase">Zahlungsart</div>
              <div className="text-sm font-medium text-foreground">{order.payment_method || '—'}</div>
            </div>
            <div className="rounded-lg border border-border p-2">
              <div className="text-[9px] text-muted-foreground uppercase">User</div>
              <div className="text-xs font-mono text-foreground">{order.user_id?.slice(0, 12)}</div>
            </div>
            <div className="rounded-lg border border-border p-2">
              <div className="text-[9px] text-muted-foreground uppercase">Erstellt</div>
              <div className="text-xs text-foreground">{new Date(order.created_at).toLocaleString('de-DE')}</div>
            </div>
          </div>
          {order.status === 'failed' && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2">
              <div className="text-[10px] text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Zahlung fehlgeschlagen – Checkout-Flow und Zahlungsanbieter prüfen.
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ── Main Component ── */
export default function FinancePanel({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const { data: revData, isLoading: revLoading } = useRevenueKpis();
  const { data: orders = [], isLoading: ordLoading } = useRecentOrders();
  const { data: costData, isLoading: costLoading } = useCostOverview();
  const [selectedOrder, setSelectedOrder] = useState<OrderRow | null>(null);
  const [orderSheetOpen, setOrderSheetOpen] = useState(false);

  const isLoading = revLoading || ordLoading || costLoading;
  const revenue = revData?.revenue;
  const refunds = revData?.refunds;

  const failedOrders = orders.filter(o => o.status === 'failed');
  const pendingOrders = orders.filter(o => o.status === 'pending');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl ">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            Finanzen & Revenue
          </SheetTitle>
          <SheetDescription>Umsatz, Kosten, ROI & Bestellungen</SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div className="space-y-3 mt-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : (
          <div className="space-y-5 mt-4">
            {/* Revenue KPIs */}
            {revenue && (
              <div>
                <div className="text-xs font-semibold text-foreground mb-2">Revenue</div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-border p-2 text-center">
                    <div className="text-lg font-bold text-foreground">€{revenue.today?.toFixed(0)}</div>
                    <div className="text-[10px] text-muted-foreground">Heute</div>
                  </div>
                  <div className="rounded-lg border border-border p-2 text-center">
                    <div className="text-lg font-bold text-foreground">€{revenue.week?.toFixed(0)}</div>
                    <div className="text-[10px] text-muted-foreground">7 Tage</div>
                  </div>
                  <div className="rounded-lg border border-border p-2 text-center">
                    <div className="text-lg font-bold text-foreground">€{revenue.month?.toFixed(0)}</div>
                    <div className="text-[10px] text-muted-foreground">30 Tage</div>
                  </div>
                </div>
              </div>
            )}

            {/* Cost overview */}
            {costData && (
              <div>
                <div className="text-xs font-semibold text-foreground mb-2">Kosten & ROI</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-border p-2">
                    <div className="text-[9px] text-muted-foreground uppercase">LLM Kosten</div>
                    <div className="text-sm font-bold text-foreground">€{costData.totalLlmCost.toFixed(2)}</div>
                    <div className="text-[10px] text-muted-foreground">{costData.totalCalls.toLocaleString()} Calls</div>
                  </div>
                  <div className={cn("rounded-lg border p-2", costData.totalMargin30d >= 0 ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5")}>
                    <div className="text-[9px] text-muted-foreground uppercase">Marge 30d</div>
                    <div className="text-sm font-bold text-foreground">€{costData.totalMargin30d.toFixed(0)}</div>
                    <div className="text-[10px] text-muted-foreground">Ø ROI {costData.avgRoi.toFixed(1)}x</div>
                  </div>
                </div>
                {costData.negativeMargePkgs > 0 && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2 mt-2 flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
                    <div className="text-[10px] text-destructive">
                      {costData.negativeMargePkgs} Paket(e) mit negativer Marge – Kosten prüfen oder Preis anpassen.
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Refunds */}
            {refunds && refunds.count > 0 && (
              <div className={cn("rounded-lg border p-3", refunds.count > 5 ? "border-destructive/30 bg-destructive/5" : "border-warning/30 bg-warning/5")}>
                <div className="flex items-center gap-2 mb-1">
                  <TrendingDown className="h-4 w-4 text-destructive" />
                  <span className="text-xs font-semibold text-foreground">{refunds.count} Refund(s) · €{refunds.total_eur?.toFixed(0)}</span>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Refund-Rate prüfen – bei mehr als 5% der Bestellungen ggf. Produkt oder Onboarding anpassen.
                </div>
              </div>
            )}

            {/* Alerts for failed orders */}
            {failedOrders.length > 0 && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <XCircle className="h-4 w-4 text-destructive" />
                  <span className="text-xs font-semibold text-foreground">{failedOrders.length} fehlgeschlagene Bestellung(en)</span>
                </div>
                <div className="space-y-1">
                  {failedOrders.slice(0, 5).map(o => (
                    <Button
                      key={o.id}
                      size="sm"
                      variant="outline"
                      className="w-full justify-between h-7 text-[10px]"
                      onClick={() => { setSelectedOrder(o); setOrderSheetOpen(true); }}
                    >
                      <span className="font-mono">{o.id.slice(0, 8)}</span>
                      <span>€{o.total_amount?.toFixed(2)} · {new Date(o.created_at).toLocaleDateString('de-DE')}</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Recent orders */}
            <div>
              <div className="text-xs font-semibold text-foreground mb-2">Letzte Bestellungen</div>
              <div className="space-y-1.5 max-h-64 ">
                {orders.slice(0, 15).map(o => {
                  const statusCls: Record<string, string> = {
                    completed: 'text-success', paid: 'text-success',
                    pending: 'text-warning', failed: 'text-destructive',
                  };
                  return (
                    <div
                      key={o.id}
                      className="rounded-lg border border-border p-2 flex items-center justify-between gap-2 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => { setSelectedOrder(o); setOrderSheetOpen(true); }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-[10px] text-muted-foreground">{o.id.slice(0, 8)}</span>
                        <span className={cn("text-[10px] font-medium", statusCls[o.status] || 'text-muted-foreground')}>{o.status}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-foreground">€{o.total_amount?.toFixed(2)}</span>
                        <span className="text-[9px] text-muted-foreground">{new Date(o.created_at).toLocaleDateString('de-DE')}</span>
                      </div>
                    </div>
                  );
                })}
                {orders.length === 0 && (
                  <div className="text-sm text-muted-foreground text-center py-4">Keine Bestellungen</div>
                )}
              </div>
            </div>
          </div>
        )}

        <OrderDetailSheet order={selectedOrder} open={orderSheetOpen} onOpenChange={setOrderSheetOpen} />
      </SheetContent>
    </Sheet>
  );
}
