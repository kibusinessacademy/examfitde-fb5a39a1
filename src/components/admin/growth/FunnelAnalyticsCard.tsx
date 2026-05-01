/**
 * FunnelAnalyticsCard — SSOT-Funnel-Analytics pro package_id × persona × source_page.
 * Quelle: SECURITY DEFINER RPC `admin_get_funnel_conversion(p_window)`.
 * Admin-only (RPC prüft has_role intern).
 *
 * Sektionen:
 *  1) Top-Funnel nach Conversion-Rate
 *  2) Größte Drop-Offs
 *  3) Persona-Vergleich
 *  4) Pakete mit Traffic aber 0 Checkout
 *  5) Orphan-Event-Warnung (Tracking-Lücken)
 */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Loader2, TrendingUp, AlertTriangle, Users, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

type Window = '24h' | '7d' | '30d';

interface FunnelRow {
  package_id: string;
  package_key: string | null;
  package_title: string | null;
  persona_type: string;
  source_page: string;
  landing_views: number;
  lead_magnet_views: number;
  lead_gate_shown: number;
  lead_gate_start_diagnosis: number;
  lead_gate_skip_to_checkout: number;
  quiz_starts: number;
  quiz_completions: number;
  result_views: number;
  result_cta_clicks: number;
  checkout_starts: number;
  checkouts_completed: number;
  orphan_events_count: number;
  landing_to_quiz_rate: number | null;
  quiz_completion_rate: number | null;
  quiz_to_result_rate: number | null;
  result_to_checkout_rate: number | null;
  checkout_completion_rate: number | null;
  full_funnel_conversion_rate: number | null;
  traffic_light: 'green' | 'yellow' | 'red' | 'gray';
}

interface OrphanRow {
  event_type: string;
  orphan_count: number;
  first_seen: string;
  last_seen: string;
}

const LIGHT_BADGE: Record<FunnelRow['traffic_light'], string> = {
  green: 'bg-status-success-bg-subtle text-status-success-text border-status-success-border',
  yellow: 'bg-status-warning-bg-subtle text-status-warning-text border-status-warning-border',
  red: 'bg-status-error-bg-subtle text-status-error-text border-status-error-border',
  gray: 'bg-surface-2 text-text-tertiary border-border-subtle',
};

function pct(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${Number(v).toFixed(1)}%`;
}

function shortTitle(r: FunnelRow): string {
  return r.package_title?.slice(0, 48) ?? r.package_key ?? r.package_id.slice(0, 8);
}

export default function FunnelAnalyticsCard() {
  const [window, setWindow] = useState<Window>('7d');

  const { data: rows, isLoading, error } = useQuery({
    queryKey: ['admin-funnel-conversion', window],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('admin_get_funnel_conversion', {
        p_window: window,
        p_limit: 200,
      });
      if (error) throw error;
      return (data ?? []) as FunnelRow[];
    },
    refetchInterval: 60_000,
  });

  const { data: orphans } = useQuery({
    queryKey: ['admin-funnel-orphans', window],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('admin_get_funnel_orphan_summary', {
        p_window: window,
      });
      if (error) throw error;
      return (data ?? []) as OrphanRow[];
    },
    refetchInterval: 60_000,
  });

  const sections = useMemo(() => {
    const safe = rows ?? [];
    const withTraffic = safe.filter((r) => (r.landing_views ?? 0) >= 5);

    const topConversion = [...withTraffic]
      .filter((r) => (r.full_funnel_conversion_rate ?? 0) > 0)
      .sort((a, b) =>
        (b.full_funnel_conversion_rate ?? 0) - (a.full_funnel_conversion_rate ?? 0)
      )
      .slice(0, 5);

    // Größter Drop-Off: kleinste rate-Stufe ermitteln
    const dropoffs = [...withTraffic]
      .map((r) => {
        const stages: Array<{ name: string; rate: number | null }> = [
          { name: 'Landing→Quiz', rate: r.landing_to_quiz_rate },
          { name: 'Quiz→Done', rate: r.quiz_completion_rate },
          { name: 'Quiz→Result', rate: r.quiz_to_result_rate },
          { name: 'Result→Checkout', rate: r.result_to_checkout_rate },
          { name: 'Checkout→Paid', rate: r.checkout_completion_rate },
        ].filter((s) => s.rate != null);
        if (stages.length === 0) return null;
        const worst = stages.reduce((a, b) => ((a.rate ?? 100) <= (b.rate ?? 100) ? a : b));
        return { row: r, worst };
      })
      .filter((x): x is { row: FunnelRow; worst: { name: string; rate: number | null } } => x != null)
      .sort((a, b) => (a.worst.rate ?? 100) - (b.worst.rate ?? 100))
      .slice(0, 5);

    const personaAgg = new Map<string, { views: number; checkouts: number }>();
    for (const r of safe) {
      const cur = personaAgg.get(r.persona_type) ?? { views: 0, checkouts: 0 };
      cur.views += r.landing_views ?? 0;
      cur.checkouts += r.checkouts_completed ?? 0;
      personaAgg.set(r.persona_type, cur);
    }
    const personaRows = Array.from(personaAgg.entries())
      .map(([persona, v]) => ({
        persona,
        views: v.views,
        checkouts: v.checkouts,
        rate: v.views > 0 ? (v.checkouts / v.views) * 100 : 0,
      }))
      .sort((a, b) => b.views - a.views);

    const trafficNoCheckout = safe
      .filter((r) => (r.landing_views ?? 0) >= 20 && (r.checkouts_completed ?? 0) === 0)
      .sort((a, b) => (b.landing_views ?? 0) - (a.landing_views ?? 0))
      .slice(0, 10);

    return { topConversion, dropoffs, personaRows, trafficNoCheckout };
  }, [rows]);

  const totalOrphans = (orphans ?? []).reduce((s, o) => s + (o.orphan_count ?? 0), 0);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4 text-petrol-600" />
          Funnel-Analytics ({window})
        </CardTitle>
        <div className="flex gap-1">
          {(['24h', '7d', '30d'] as const).map((w) => (
            <Button
              key={w}
              size="sm"
              variant={w === window ? 'default' : 'outline'}
              onClick={() => setWindow(w)}
              className="h-7 px-2 text-xs"
            >
              {w}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="flex items-center gap-2 text-text-secondary text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Lade Funnel-Daten…
          </div>
        ) : error ? (
          <div className="text-sm text-status-error-text">
            Fehler beim Laden: {(error as Error).message}
          </div>
        ) : (rows ?? []).length === 0 ? (
          <p className="text-sm text-text-secondary">
            Noch keine Funnel-Events im Zeitfenster. Sobald Persona-Landingpages besucht werden,
            erscheinen hier Conversion-Raten pro Paket × Persona.
          </p>
        ) : (
          <>
            {/* 5) Orphan-Warning oben */}
            {totalOrphans > 0 && (
              <div className="rounded-lg border border-status-warning-border bg-status-warning-bg-subtle p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-status-warning-text">
                  <AlertTriangle className="h-4 w-4" />
                  {totalOrphans} Tracking-Events ohne package_id ({window})
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(orphans ?? []).slice(0, 8).map((o) => (
                    <Badge key={o.event_type} variant="outline" className="text-[10px]">
                      {o.event_type}: {o.orphan_count}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* 1) Top-Conversion */}
            <Section title="Top-Funnel nach Conversion-Rate" icon={<TrendingUp className="h-3.5 w-3.5" />}>
              {sections.topConversion.length === 0 ? (
                <Empty msg="Noch keine abgeschlossenen Funnels." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Paket</TableHead>
                      <TableHead>Persona</TableHead>
                      <TableHead className="text-right">Views</TableHead>
                      <TableHead className="text-right">Käufe</TableHead>
                      <TableHead className="text-right">Conv.</TableHead>
                      <TableHead className="text-right">Ampel</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sections.topConversion.map((r) => (
                      <TableRow key={`${r.package_id}-${r.persona_type}-${r.source_page}`}>
                        <TableCell className="text-sm">{shortTitle(r)}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{r.persona_type}</Badge></TableCell>
                        <TableCell className="text-right tabular-nums">{r.landing_views}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.checkouts_completed}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {pct(r.full_funnel_conversion_rate)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline" className={cn('text-[10px]', LIGHT_BADGE[r.traffic_light])}>
                            {r.traffic_light}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Section>

            {/* 2) Drop-Offs */}
            <Section title="Größte Drop-Offs" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
              {sections.dropoffs.length === 0 ? (
                <Empty msg="Keine relevanten Drop-Offs (mind. 5 Landings nötig)." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Paket</TableHead>
                      <TableHead>Persona</TableHead>
                      <TableHead>Schwächster Schritt</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sections.dropoffs.map(({ row, worst }) => (
                      <TableRow key={`do-${row.package_id}-${row.persona_type}-${row.source_page}`}>
                        <TableCell className="text-sm">{shortTitle(row)}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{row.persona_type}</Badge></TableCell>
                        <TableCell className="text-sm">{worst.name}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium text-status-error-text">
                          {pct(worst.rate)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Section>

            {/* 3) Persona-Vergleich */}
            <Section title="Persona-Vergleich" icon={<Users className="h-3.5 w-3.5" />}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Persona</TableHead>
                    <TableHead className="text-right">Landings</TableHead>
                    <TableHead className="text-right">Käufe</TableHead>
                    <TableHead className="text-right">Conv.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sections.personaRows.map((p) => (
                    <TableRow key={p.persona}>
                      <TableCell><Badge variant="outline" className="text-[10px]">{p.persona}</Badge></TableCell>
                      <TableCell className="text-right tabular-nums">{p.views}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.checkouts}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {p.views > 0 ? `${p.rate.toFixed(1)}%` : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>

            {/* 4) Traffic ohne Checkout */}
            <Section title="Pakete mit Traffic, aber 0 Checkout (≥20 Views)" icon={<Activity className="h-3.5 w-3.5" />}>
              {sections.trafficNoCheckout.length === 0 ? (
                <Empty msg="Alle Pakete mit Traffic konvertieren mindestens minimal." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Paket</TableHead>
                      <TableHead>Persona</TableHead>
                      <TableHead className="text-right">Landings</TableHead>
                      <TableHead className="text-right">Quiz</TableHead>
                      <TableHead className="text-right">Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sections.trafficNoCheckout.map((r) => (
                      <TableRow key={`tnc-${r.package_id}-${r.persona_type}-${r.source_page}`}>
                        <TableCell className="text-sm">{shortTitle(r)}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{r.persona_type}</Badge></TableCell>
                        <TableCell className="text-right tabular-nums">{r.landing_views}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.quiz_starts}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.result_views}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Section>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-text-primary">
        {icon} {title}
      </div>
      {children}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <p className="text-xs text-text-tertiary py-2">{msg}</p>;
}
