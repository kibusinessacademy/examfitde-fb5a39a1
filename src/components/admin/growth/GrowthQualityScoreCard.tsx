import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Loader2, RefreshCw, Gauge, AlertTriangle, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

type Summary = {
  total_published: number;
  avg_score: number;
  green_count: number;
  yellow_count: number;
  red_count: number;
  avg_subscores: Record<string, number>;
  computed_at: string;
};

type DetailRow = {
  package_id: string;
  title: string;
  package_key: string;
  published_at: string;
  growth_quality_score: number;
  score_blog_quality: number;
  score_seo_meta: number;
  score_internal_links: number;
  score_cta: number;
  score_funnel_events: number;
  score_email_sequence: number;
  score_distribution: number;
  score_og_image: number;
};

const SUBSCORE_ROWS: { key: keyof Summary['avg_subscores']; label: string }[] = [
  { key: 'blog_quality', label: 'Blog Quality' },
  { key: 'seo_meta', label: 'SEO Meta' },
  { key: 'internal_links', label: 'Internal Links' },
  { key: 'cta', label: 'CTA' },
  { key: 'funnel_events', label: 'Funnel Events (30d)' },
  { key: 'email_sequence', label: 'Email Sequence' },
  { key: 'distribution', label: 'Distribution' },
  { key: 'og_image', label: 'OG Image' },
];

function tone(pct: number) {
  if (pct >= 80) return 'success';
  if (pct >= 50) return 'warning';
  return 'error';
}

function gateBadge(avg: number) {
  if (avg >= 80)
    return (
      <Badge className="bg-status-success-bg-subtle text-status-success-text border-status-success-border">
        <CheckCircle2 className="mr-1 h-3 w-3" />Green
      </Badge>
    );
  if (avg >= 50)
    return (
      <Badge className="bg-status-warning-bg-subtle text-status-warning-text border-status-warning-border">
        <AlertTriangle className="mr-1 h-3 w-3" />Yellow
      </Badge>
    );
  return (
    <Badge className="bg-status-error-bg-subtle text-status-error-text border-status-error-border">
      <AlertCircle className="mr-1 h-3 w-3" />Red
    </Badge>
  );
}

export default function GrowthQualityScoreCard() {
  const [maxScore, setMaxScore] = useState(60);

  const summary = useQuery({
    queryKey: ['growth-quality-summary'],
    queryFn: async (): Promise<Summary> => {
      const { data, error } = await supabase.rpc('admin_get_growth_quality_summary' as any);
      if (error) throw error;
      return data as Summary;
    },
    staleTime: 60_000,
    refetchInterval: 300_000,
  });

  const details = useQuery({
    queryKey: ['growth-quality-details', maxScore],
    queryFn: async (): Promise<DetailRow[]> => {
      const { data, error } = await supabase.rpc('admin_get_growth_quality_details' as any, {
        p_limit: 25,
        p_min: 0,
        p_max: maxScore,
      });
      if (error) throw error;
      return (data ?? []) as DetailRow[];
    },
    staleTime: 60_000,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Gauge className="h-4 w-4" /> Growth Quality Score
            {summary.data && gateBadge(summary.data.avg_score)}
          </CardTitle>
          <CardDescription>
            8-Dimensionen Quality-Gate für published packages · Score 0–100
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            summary.refetch();
            details.refetch();
          }}
          disabled={summary.isFetching || details.isFetching}
        >
          <RefreshCw
            className={`h-3 w-3 mr-1 ${summary.isFetching || details.isFetching ? 'animate-spin' : ''}`}
          />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {summary.isLoading && (
          <div className="flex items-center gap-2 text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" />Lade Quality-Summary…
          </div>
        )}
        {summary.error && (
          <div className="text-sm text-status-error-text">
            Fehler: {(summary.error as Error).message}
          </div>
        )}
        {summary.data && (
          <>
            <div className="grid grid-cols-4 gap-3 text-xs">
              <div className="rounded-md border border-border-subtle bg-surface-sunken p-2">
                <div className="text-text-secondary">Avg Score</div>
                <div className="font-mono text-lg text-text-primary">{summary.data.avg_score}</div>
              </div>
              <div className="rounded-md border border-border-subtle bg-status-success-bg-subtle p-2">
                <div className="text-text-secondary">Green ≥80</div>
                <div className="font-mono text-lg text-status-success-text">{summary.data.green_count}</div>
              </div>
              <div className="rounded-md border border-border-subtle bg-status-warning-bg-subtle p-2">
                <div className="text-text-secondary">Yellow 50–79</div>
                <div className="font-mono text-lg text-status-warning-text">{summary.data.yellow_count}</div>
              </div>
              <div className="rounded-md border border-border-subtle bg-status-error-bg-subtle p-2">
                <div className="text-text-secondary">Red &lt;50</div>
                <div className="font-mono text-lg text-status-error-text">{summary.data.red_count}</div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-text-primary">Avg Subscores</div>
              {SUBSCORE_ROWS.map(({ key, label }) => {
                const pct = Number(summary.data!.avg_subscores?.[key] ?? 0);
                return (
                  <div key={key} className="grid grid-cols-12 items-center gap-2 text-xs">
                    <div className="col-span-4 text-text-secondary">{label}</div>
                    <div className="col-span-7"><Progress value={pct} className="h-2" /></div>
                    <div className={`col-span-1 text-right font-mono text-status-${tone(pct)}-text`}>
                      {pct.toFixed(0)}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-md border border-border-subtle bg-surface-sunken p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-text-primary">Worst Packages (Score ≤ {maxScore})</div>
                <div className="flex gap-1">
                  {[40, 60, 80, 100].map((m) => (
                    <Button
                      key={m}
                      size="sm"
                      variant={maxScore === m ? 'default' : 'outline'}
                      onClick={() => setMaxScore(m)}
                      className="h-6 text-[10px] px-2"
                    >
                      ≤{m}
                    </Button>
                  ))}
                </div>
              </div>

              {details.isLoading && (
                <div className="flex items-center gap-2 text-xs text-text-secondary">
                  <Loader2 className="h-3 w-3 animate-spin" />Lade Pakete…
                </div>
              )}
              {details.data && details.data.length === 0 && (
                <div className="text-xs text-text-secondary">Keine Pakete in diesem Score-Bereich.</div>
              )}
              {details.data && details.data.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead className="text-text-secondary">
                      <tr>
                        <th className="text-left py-1 pr-2">Paket</th>
                        <th className="text-right px-1">Score</th>
                        <th className="text-right px-1" title="Blog Quality">BQ</th>
                        <th className="text-right px-1" title="SEO Meta">SEO</th>
                        <th className="text-right px-1" title="Internal Links">IL</th>
                        <th className="text-right px-1" title="CTA">CTA</th>
                        <th className="text-right px-1" title="Funnel Events">FE</th>
                        <th className="text-right px-1" title="Email Sequence">ES</th>
                        <th className="text-right px-1" title="Distribution">D</th>
                        <th className="text-right px-1" title="OG Image">OG</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.data.map((r) => (
                        <tr key={r.package_id} className="border-t border-border-subtle">
                          <td className="py-1 pr-2 text-text-primary">
                            <div className="truncate max-w-[260px]">{r.title}</div>
                            <div className="text-text-secondary font-mono text-[9px]">{r.package_key}</div>
                          </td>
                          <td className={`text-right font-mono px-1 text-status-${tone(r.growth_quality_score)}-text`}>
                            {r.growth_quality_score}
                          </td>
                          <td className="text-right font-mono px-1">{r.score_blog_quality}</td>
                          <td className="text-right font-mono px-1">{r.score_seo_meta}</td>
                          <td className="text-right font-mono px-1">{r.score_internal_links}</td>
                          <td className="text-right font-mono px-1">{r.score_cta}</td>
                          <td className="text-right font-mono px-1">{r.score_funnel_events}</td>
                          <td className="text-right font-mono px-1">{r.score_email_sequence}</td>
                          <td className="text-right font-mono px-1">{r.score_distribution}</td>
                          <td className="text-right font-mono px-1">{r.score_og_image}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="text-[10px] text-text-secondary">
              Total published: {summary.data.total_published} · Berechnet:{' '}
              {new Date(summary.data.computed_at).toLocaleString('de-DE')}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
