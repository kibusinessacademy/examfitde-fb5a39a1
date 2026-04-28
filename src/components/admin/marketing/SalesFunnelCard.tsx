/**
 * SalesFunnelCard — Funnel-Schritte + Latenz pro Curriculum (30d).
 * Quelle: v_admin_sales_funnel_per_curriculum.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Loader2, TrendingUp } from 'lucide-react';

const FUNNEL_STEPS = [
  'shop_view',
  'product_search',
  'product_filter',
  'product_view',
  'product_select',
  'checkout_start',
  'checkout_complete',
] as const;

const STEP_LABEL: Record<string, string> = {
  shop_view: 'Shop-View',
  product_search: 'Suche',
  product_filter: 'Filter',
  product_view: 'Produkt-View',
  product_select: 'Auswahl',
  checkout_start: 'Checkout-Start',
  checkout_started: 'Checkout-Start',
  checkout_complete: 'Checkout abgeschlossen',
  checkout_completed: 'Checkout abgeschlossen',
};

interface FunnelRow {
  curriculum_id: string | null;
  event_type: string;
  event_count: number;
  sessions: number;
  median_step_latency_ms: number | null;
  last_event_at: string | null;
}

export default function SalesFunnelCard() {
  const { data: rows, isLoading } = useQuery({
    queryKey: ['admin-sales-funnel'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('v_admin_sales_funnel_per_curriculum')
        .select('*');
      if (error) throw error;
      return (data ?? []) as FunnelRow[];
    },
    refetchInterval: 60_000,
  });

  const { data: curricula } = useQuery({
    queryKey: ['curricula-titles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('curricula')
        .select('id, title');
      if (error) throw error;
      return data;
    },
  });

  // Group rows by curriculum_id
  const byCurriculum = new Map<string, FunnelRow[]>();
  (rows ?? []).forEach((r) => {
    const key = r.curriculum_id ?? '__none__';
    if (!byCurriculum.has(key)) byCurriculum.set(key, []);
    byCurriculum.get(key)!.push(r);
  });

  const titleFor = (id: string) => {
    if (id === '__none__') return 'Ohne Curriculum-Bindung';
    return curricula?.find((c) => c.id === id)?.title?.replace(/^Rahmenlehrplan\s+/i, '') ?? id.slice(0, 8);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4 text-petrol-600" />
          Sales-Funnel pro Curriculum (30d)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-text-secondary text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Lade Funnel-Daten…
          </div>
        ) : byCurriculum.size === 0 ? (
          <p className="text-sm text-text-secondary">
            Noch keine Funnel-Events erfasst. Sobald Nutzer den Shop besuchen, erscheinen hier
            Schrittzahlen und mediane Latenzen.
          </p>
        ) : (
          <div className="space-y-6">
            {Array.from(byCurriculum.entries()).map(([curriculumId, curriculumRows]) => {
              const byStep = new Map(curriculumRows.map((r) => [r.event_type, r]));
              return (
                <div key={curriculumId}>
                  <div className="text-sm font-medium text-text-primary mb-2">
                    {titleFor(curriculumId)}
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Schritt</TableHead>
                        <TableHead className="text-right">Events</TableHead>
                        <TableHead className="text-right">Sessions</TableHead>
                        <TableHead className="text-right">Median Latenz</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {FUNNEL_STEPS.map((step) => {
                        const r = byStep.get(step) ?? byStep.get(step + 'ed' as any);
                        return (
                          <TableRow key={step}>
                            <TableCell className="text-sm">
                              {STEP_LABEL[step] ?? step}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {r?.event_count ?? 0}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {r?.sessions ?? 0}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {r?.median_step_latency_ms != null ? (
                                <Badge variant="outline" className="text-[10px]">
                                  {r.median_step_latency_ms < 1000
                                    ? `${r.median_step_latency_ms} ms`
                                    : `${(r.median_step_latency_ms / 1000).toFixed(1)} s`}
                                </Badge>
                              ) : (
                                <span className="text-text-tertiary">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
