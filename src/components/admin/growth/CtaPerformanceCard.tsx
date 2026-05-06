/**
 * CTA Performance Card — SSOT für Lead-Magnet-CTA A/B-Auswertung.
 *
 * Quelle:
 *   - admin_get_cta_performance() → v_conversion_cta_performance (7 Tage)
 *   - admin_get_cta_winners()     → cta_winner_decisions (Auto-48h)
 *
 * Entscheidungsregel:
 *   Gewinner = höchste quiz_start_per_visible_pct (echte Funnel-Conversion ab Sichtkontakt),
 *   nicht CTR. Mindestens 30 Klicks pro Variante, ≥ 1pp Abstand.
 *   Aggregation erfolgt PRO page_path × cta_location.
 */
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trophy, Target, MousePointerClick, Bot } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface PerfRow {
  page_path: string;
  source: string;
  cta_location: string;
  variant: string;
  views: number;
  clicks: number;
  ctr_pct: number;
  quiz_started: number;
  quiz_start_rate_pct: number;
  quiz_start_per_visible_pct: number;
  checkout_started: number;
  checkout_rate_pct: number;
  first_seen_at: string | null;
}

interface WinnerRow {
  page_path: string;
  cta_location: string;
  winner_variant: "A" | "B";
  winner_quiz_start_per_visible_pct: number;
  loser_quiz_start_per_visible_pct: number;
  decided_at: string;
  decided_by: string;
}

const MIN_CLICKS = 30;
const MIN_DELTA = 1.0;

export default function CtaPerformanceCard() {
  const [rows, setRows] = useState<PerfRow[]>([]);
  const [winners, setWinners] = useState<WinnerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [perf, win] = await Promise.all([
        (supabase as any).rpc("admin_get_cta_performance"),
        (supabase as any).rpc("admin_get_cta_winners"),
      ]);
      if (cancelled) return;
      if (perf.error) setError(perf.error.message);
      else setRows((perf.data ?? []) as PerfRow[]);
      if (!win.error) setWinners((win.data ?? []) as WinnerRow[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Group rows by page_path × cta_location → variants
  type Group = {
    page_path: string;
    cta_location: string;
    variants: PerfRow[];
  };
  const groups: Group[] = useMemo(() => {
    const m = new Map<string, Group>();
    for (const r of rows) {
      const k = `${r.page_path}::${r.cta_location}`;
      if (!m.has(k))
        m.set(k, { page_path: r.page_path, cta_location: r.cta_location, variants: [] });
      m.get(k)!.variants.push(r);
    }
    return Array.from(m.values()).sort(
      (a, b) =>
        a.cta_location.localeCompare(b.cta_location) ||
        a.page_path.localeCompare(b.page_path)
    );
  }, [rows]);

  const liveWinner = (g: Group): { variant: string; reason: string } | null => {
    const eligible = g.variants.filter((r) => r.clicks >= MIN_CLICKS);
    if (eligible.length < 2) return null;
    eligible.sort((a, b) => b.quiz_start_per_visible_pct - a.quiz_start_per_visible_pct);
    const delta =
      eligible[0].quiz_start_per_visible_pct - eligible[1].quiz_start_per_visible_pct;
    if (delta < MIN_DELTA) return null;
    return { variant: eligible[0].variant, reason: `Δ ${delta.toFixed(2)}pp` };
  };

  const promotedWinner = (g: Group): WinnerRow | undefined =>
    winners.find((w) => w.page_path === g.page_path && w.cta_location === g.cta_location);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="h-4 w-4 text-primary" />
          CTA Performance · A/B (7 Tage, pro Page × Location)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Gewinner = höchste <strong>quiz_start_per_visible_pct</strong>.
          Auto-Promote nach 48h, ≥ {MIN_CLICKS} Klicks/Variante, ≥ {MIN_DELTA}pp Abstand.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> lädt …
          </div>
        )}
        {error && <div className="text-sm text-destructive">Fehler: {error}</div>}
        {!loading && !error && groups.length === 0 && (
          <div className="text-sm text-muted-foreground">
            Noch keine CTA-Events in den letzten 7 Tagen.
          </div>
        )}

        {groups.map((g) => {
          const live = liveWinner(g);
          const promoted = promotedWinner(g);
          return (
            <div
              key={`${g.page_path}::${g.cta_location}`}
              className="rounded-lg border border-border bg-surface-1 p-3"
            >
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold capitalize truncate">
                    {g.cta_location}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {g.page_path}
                    </span>
                  </h4>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {promoted ? (
                    <Badge variant="default" className="gap-1">
                      <Bot className="h-3 w-3" /> Auto-Promoted: {promoted.winner_variant}
                    </Badge>
                  ) : live ? (
                    <Badge variant="default" className="gap-1">
                      <Trophy className="h-3 w-3" /> Live-Lead: {live.variant} ({live.reason})
                    </Badge>
                  ) : (
                    <Badge variant="outline">Sammelt Daten</Badge>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="text-left">
                      <th className="py-1 pr-3">Var</th>
                      <th className="py-1 pr-3 text-right">Visible</th>
                      <th className="py-1 pr-3 text-right">Clicks</th>
                      <th className="py-1 pr-3 text-right">CTR</th>
                      <th className="py-1 pr-3 text-right">Quiz/Visible</th>
                      <th className="py-1 pr-3 text-right">Quiz/Click</th>
                      <th className="py-1 text-right">Checkout-Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.variants
                      .sort((a, b) => a.variant.localeCompare(b.variant))
                      .map((r) => {
                        const isWinner =
                          (promoted?.winner_variant ?? live?.variant) === r.variant;
                        return (
                          <tr key={r.variant} className={isWinner ? "font-semibold" : ""}>
                            <td className="py-1 pr-3">
                              <Badge variant={isWinner ? "default" : "outline"}>
                                {r.variant}
                              </Badge>
                            </td>
                            <td className="py-1 pr-3 text-right tabular-nums">{r.views}</td>
                            <td className="py-1 pr-3 text-right tabular-nums">
                              <MousePointerClick className="inline h-3 w-3 mr-0.5 text-muted-foreground" />
                              {r.clicks}
                            </td>
                            <td className="py-1 pr-3 text-right tabular-nums">{r.ctr_pct}%</td>
                            <td className="py-1 pr-3 text-right tabular-nums">
                              {r.quiz_start_per_visible_pct}%
                            </td>
                            <td className="py-1 pr-3 text-right tabular-nums">
                              {r.quiz_start_rate_pct}%
                            </td>
                            <td className="py-1 text-right tabular-nums">
                              {r.checkout_rate_pct}%
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}

        <p className="text-[11px] text-muted-foreground">
          Auto-Promotion läuft stündlich (Cron <code>cta-auto-promote-hourly</code>).
          Gewinner werden in <code>cta_winner_decisions</code> persistiert.
        </p>
      </CardContent>
    </Card>
  );
}
