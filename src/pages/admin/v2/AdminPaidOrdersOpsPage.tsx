import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, RefreshCw, Wrench, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

type OpsStatus = 'paid_no_grant' | 'granted' | 'paid_not_fulfillable' | 'paid';

type OrderRow = {
  order_id: string;
  created_at: string;
  paid_at: string | null;
  status: string;
  buyer_user_id: string | null;
  learner_user_id: string | null;
  effective_user_id: string | null;
  billing_email: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  total_cents: number;
  currency: string;
  item_count: number;
  fulfillable_item_count: number;
  has_grant: boolean;
  items: Array<{
    product_id: string | null;
    product_slug: string | null;
    product_title: string | null;
    product_type: string | null;
    curriculum_id: string | null;
    has_grant: boolean;
    grant_status: string | null;
  }> | null;
  ops_status: OpsStatus;
};

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'Alle (paid)' },
  { value: 'paid_no_grant', label: 'paid_no_grant ⚠️' },
  { value: 'granted', label: 'granted ✅' },
  { value: 'paid_not_fulfillable', label: 'paid_not_fulfillable' },
];

function fmtMoney(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: currency.toUpperCase() })
      .format((cents ?? 0) / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function statusBadge(status: OpsStatus) {
  const map: Record<OpsStatus, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
    paid_no_grant: { variant: 'destructive', label: 'paid_no_grant' },
    granted: { variant: 'default', label: 'granted' },
    paid_not_fulfillable: { variant: 'secondary', label: 'paid_not_fulfillable' },
    paid: { variant: 'outline', label: 'paid' },
  };
  const cfg = map[status] ?? { variant: 'outline', label: status };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

export default function AdminPaidOrdersOpsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>('all');

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['admin-paid-orders-ops', status],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('admin_get_paid_orders_ops', {
        p_status: status === 'all' ? null : status,
        p_limit: 200,
      });
      if (error) throw error;
      return (data ?? []) as OrderRow[];
    },
  });

  const rows = data ?? [];
  const counts = useMemo(() => ({
    paid_no_grant: rows.filter((r) => r.ops_status === 'paid_no_grant').length,
    granted: rows.filter((r) => r.ops_status === 'granted').length,
    paid_not_fulfillable: rows.filter((r) => r.ops_status === 'paid_not_fulfillable').length,
  }), [rows]);

  const [lastError, setLastError] = useState<{ orderId: string; message: string } | null>(null);

  const repair = useMutation({
    mutationFn: async (orderId: string | null) => {
      if (orderId) {
        const { data, error } = await (supabase.rpc as any)('admin_repair_order_with_audit', {
          p_order_id: orderId,
        });
        if (error) throw error;
        return data;
      }
      const { data, error } = await (supabase.rpc as any)('admin_repair_paid_orders_without_grant', {
        p_caller_id: null,
        p_dry_run: false,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any, orderId) => {
      if (orderId) {
        const before = Array.isArray(data?.grants_before) ? data.grants_before.length : 0;
        const after = Array.isArray(data?.grants_after) ? data.grants_after.length : 0;
        const ok = data?.status === 'success';
        if (ok) {
          setLastError(null);
          toast.success(`Repariert: grants ${before} → ${after}`, {
            description: `run_id ${String(data?.run_id).slice(0, 8)} · order ${String(orderId).slice(0, 8)}`,
          });
        } else {
          setLastError({ orderId, message: data?.error ?? 'unknown' });
          toast.error('Repair fehlgeschlagen', { description: data?.error ?? 'unknown' });
        }
      } else {
        toast.success('Bulk-Repair abgeschlossen', {
          description: `repariert: ${data?.repaired ?? 0} · failed: ${data?.failed ?? 0}`,
        });
      }
      qc.invalidateQueries({ queryKey: ['admin-paid-orders-ops'] });
    },
    onError: (e: any, orderId) => {
      if (typeof orderId === 'string') setLastError({ orderId, message: e?.message ?? 'unknown' });
      toast.error('Repair fehlgeschlagen', { description: e?.message });
    },
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text-primary">Paid Orders Ops</h1>
        <p className="text-sm text-text-secondary mt-1">
          Echte bezahlte Orders mit Grant-Status. Synthetische Test-Sessions sind ausgeschlossen.
          Zeigt SSOT aus <code>v_admin_paid_orders_ops</code>.
        </p>
      </header>

      <Card>
        <CardContent className="pt-6 flex flex-wrap items-end gap-3">
          <div className="space-y-1 w-64">
            <label className="text-xs text-text-muted">Filter</label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <Badge variant="destructive">paid_no_grant: {counts.paid_no_grant}</Badge>
            <Badge variant="default">granted: {counts.granted}</Badge>
            <Badge variant="secondary">not fulfillable: {counts.paid_not_fulfillable}</Badge>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
            </Button>
            <Button
              size="sm"
              variant="default"
              disabled={repair.isPending || counts.paid_no_grant === 0}
              onClick={() => repair.mutate(null)}
              title="Repariert alle paid_no_grant Orders"
            >
              <Wrench className="h-4 w-4 mr-1" /> Bulk Repair
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Orders ({rows.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
            </div>
          ) : !rows.length ? (
            <p className="py-10 text-center text-text-muted">Keine Orders im Filter.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-text-muted bg-surface-sunken">
                  <tr className="border-b border-border">
                    <th className="text-left p-2">Paid at</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Käufer / Lernender</th>
                    <th className="text-left p-2">Produkte</th>
                    <th className="text-right p-2">Betrag</th>
                    <th className="text-left p-2">Stripe</th>
                    <th className="text-right p-2">Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.order_id} className="border-b border-border/60 hover:bg-surface-sunken/50 align-top">
                      <td className="p-2 whitespace-nowrap text-text-secondary">
                        {r.paid_at ? new Date(r.paid_at).toLocaleString('de-DE') : '—'}
                      </td>
                      <td className="p-2">{statusBadge(r.ops_status)}</td>
                      <td className="p-2">
                        <div className="text-text-primary">{r.billing_email ?? '—'}</div>
                        <div className="font-mono text-[10px] text-text-muted truncate max-w-[14rem]">
                          buyer: {r.buyer_user_id ?? '—'}
                        </div>
                        {r.learner_user_id && r.learner_user_id !== r.buyer_user_id && (
                          <div className="font-mono text-[10px] text-text-muted truncate max-w-[14rem]">
                            learner: {r.learner_user_id}
                          </div>
                        )}
                      </td>
                      <td className="p-2">
                        <div className="space-y-1">
                          {(r.items ?? []).map((it, i) => (
                            <div key={i} className="text-xs">
                              <span className="text-text-primary">{it.product_title ?? it.product_slug ?? it.product_id?.slice(0, 8)}</span>
                              <span className="text-text-muted"> · {it.product_type ?? '?'}</span>
                              {it.has_grant ? (
                                <Badge variant="default" className="ml-2">grant {it.grant_status}</Badge>
                              ) : it.curriculum_id ? (
                                <Badge variant="destructive" className="ml-2">no grant</Badge>
                              ) : (
                                <Badge variant="secondary" className="ml-2">no curriculum</Badge>
                              )}
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="p-2 text-right whitespace-nowrap text-text-primary">
                        {fmtMoney(r.total_cents, r.currency)}
                      </td>
                      <td className="p-2">
                        {r.stripe_checkout_session_id ? (
                          <a
                            className="font-mono text-[10px] text-primary inline-flex items-center gap-1 hover:underline"
                            href={`https://dashboard.stripe.com/payments/${r.stripe_payment_intent_id ?? ''}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {r.stripe_checkout_session_id.slice(0, 14)}…
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : '—'}
                      </td>
                      <td className="p-2 text-right">
                        {r.ops_status === 'paid_no_grant' && (
                          <div className="flex flex-col items-end gap-1">
                            <Button
                              size="sm"
                              variant={lastError?.orderId === r.order_id ? 'destructive' : 'outline'}
                              disabled={repair.isPending}
                              onClick={() => repair.mutate(r.order_id)}
                            >
                              <Wrench className="h-3 w-3 mr-1" />
                              {lastError?.orderId === r.order_id ? 'Retry' : 'Repair'}
                            </Button>
                            {lastError?.orderId === r.order_id && (
                              <span
                                className="text-[10px] text-status-error max-w-[12rem] truncate"
                                title={lastError.message}
                              >
                                {lastError.message}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
