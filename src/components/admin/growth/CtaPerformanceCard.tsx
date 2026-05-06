/**
 * CTA Performance Card — SSOT für Lead-Magnet-CTA A/B-Auswertung.
 *
 * Quelle: admin_get_cta_performance() → v_conversion_cta_performance (7 Tage).
 *
 * Entscheidungsregel (explizit):
 *   Gewinner = höchste quiz_start_rate_pct, NICHT höchste CTR.
 *   (CTR misst Klickreiz, quiz_started misst echten Funnel-Eintritt.)
 */
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trophy, Target, MousePointerClick } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Row {
  page_path: string;
  source: string;
  cta_location: string;
  variant: string;
  views: number;
  clicks: number;
  ctr_pct: number;
  quiz_started: number;
  quiz_start_rate_pct: number;
  checkout_started: number;
  checkout_rate_pct: number;
}

const LOCATIONS = ["hero", "mid", "contextual", "footer"] as const;

export default function CtaPerformanceCard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await (supabase as any).rpc("admin_get_cta_performance");
      if (cancelled) return;
      if (error) setError(error.message);
      else setRows((data ?? []) as Row[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Aggregat pro location/variant (über alle Pages)
  const perVariant = useMemo(() => {
    const acc = new Map<string, Row>();
    for (const r of rows) {
      const k = `${r.cta_location}::${r.variant}`;
      const cur = acc.get(k);
      if (!cur) {
        acc.set(k, { ...r, page_path: "*", source: "*" });
      } else {
        cur.views += r.views;
        cur.clicks += r.clicks;
        cur.quiz_started += r.quiz_started;
        cur.checkout_started += r.checkout_started;
        cur.ctr_pct = cur.views > 0 ? Math.round((cur.clicks / cur.views) * 10000) / 100 : 0;
        cur.quiz_start_rate_pct = cur.clicks > 0 ? Math.round((cur.quiz_started / cur.clicks) * 10000) / 100 : 0;
        cur.checkout_rate_pct = cur.clicks > 0 ? Math.round((cur.checkout_started / cur.clicks) * 10000) / 100 : 0;
      }
    }
    return Array.from(acc.values());
  }, [rows]);

  const winnerByQuizRate = (loc: string): string | null => {
    const candidates = perVariant.filter(r => r.cta_location === loc && r.clicks >= 5);
    if (candidates.length < 2) return null;
    candidates.sort((a, b) => b.quiz_start_rate_pct - a.quiz_start_rate_pct);
    if (candidates[0].quiz_start_rate_pct === candidates[1].quiz_start_rate_pct) return null;
    return candidates[0].variant;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="h-4 w-4 text-primary" />
          CTA Performance · A/B (7 Tage)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Gewinner = höchste <strong>quiz_start_rate_pct</strong> (nicht CTR).
          Mindestens 5 Klicks pro Variante nötig.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> lädt …
          </div>
        )}
        {error && <div className="text-sm text-destructive">Fehler: {error}</div>}
        {!loading && !error && perVariant.length === 0 && (
          <div className="text-sm text-muted-foreground">
            Noch keine CTA-Events in den letzten 7 Tagen.
          </div>
        )}

        {LOCATIONS.map((loc) => {
          const variants = perVariant.filter(r => r.cta_location === loc);
          if (variants.length === 0) return null;
          const winner = winnerByQuizRate(loc);
          return (
            <div key={loc} className="rounded-lg border border-border bg-surface-1 p-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold capitalize">{loc}</h4>
                {winner ? (
                  <Badge variant="default" className="gap-1">
                    <Trophy className="h-3 w-3" /> Gewinner: {winner}
                  </Badge>
                ) : (
                  <Badge variant="outline">Noch unklar</Badge>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="text-left">
                      <th className="py-1 pr-3">Var</th>
                      <th className="py-1 pr-3 text-right">Views</th>
                      <th className="py-1 pr-3 text-right">Clicks</th>
                      <th className="py-1 pr-3 text-right">CTR</th>
                      <th className="py-1 pr-3 text-right">Quiz-Starts</th>
                      <th className="py-1 pr-3 text-right">Quiz-Rate</th>
                      <th className="py-1 text-right">Checkout-Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variants.sort((a,b) => a.variant.localeCompare(b.variant)).map((r) => (
                      <tr key={r.variant} className={winner === r.variant ? "font-semibold" : ""}>
                        <td className="py-1 pr-3">
                          <Badge variant={winner === r.variant ? "default" : "outline"}>{r.variant}</Badge>
                        </td>
                        <td className="py-1 pr-3 text-right tabular-nums">{r.views}</td>
                        <td className="py-1 pr-3 text-right tabular-nums">
                          <MousePointerClick className="inline h-3 w-3 mr-0.5 text-muted-foreground" />
                          {r.clicks}
                        </td>
                        <td className="py-1 pr-3 text-right tabular-nums">{r.ctr_pct}%</td>
                        <td className="py-1 pr-3 text-right tabular-nums">{r.quiz_started}</td>
                        <td className="py-1 pr-3 text-right tabular-nums">{r.quiz_start_rate_pct}%</td>
                        <td className="py-1 text-right tabular-nums">{r.checkout_rate_pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}

        <p className="text-[11px] text-muted-foreground">
          Auto-Promotion der Gewinner-Variante: <strong>noch nicht aktiv</strong> —
          erst nach 24-48h stabilen Daten manuell als Default setzen.
        </p>
      </CardContent>
    </Card>
  );
}
