import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, AlertTriangle, XCircle, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

interface EliteHealthData {
  curriculum_id: string;
  curriculum_title: string;
  approved_q: number;
  annotated_q: number;
  pct_annotated: number;
  elite_cnt: number;
  pct_elite: number;
  avg_score: number;
  stale_cnt: number;
  missing_cnt: number;
}

interface Props {
  curriculumId?: string;
  compact?: boolean;
}

export default function EliteHealthBadge({ curriculumId, compact = false }: Props) {
  const [data, setData] = useState<EliteHealthData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // Load from summary view (curriculum-level aggregation)
        let q = (supabase as any).from('curriculum_elite_summary_v')
          .select('*');
        if (curriculumId) q = q.eq('curriculum_id', curriculumId);
        const { data: coverage } = await q.limit(50);

        // Load curriculum titles
        const cIds = [...new Set((coverage || []).map((c: any) => c.curriculum_id))];
        const { data: curricula } = await (supabase as any).from('curricula')
          .select('id, title')
          .in('id', cIds);
        const titleMap = new Map((curricula || []).map((c: any) => [c.id, c.title]));

        // Load stale counts
        let sq = (supabase as any).from('stale_elite_annotations_v')
          .select('question_id, curriculum_id');
        if (curriculumId) sq = sq.eq('curriculum_id', curriculumId);
        const { data: stale } = await sq;

        const staleMap = new Map<string, number>();
        for (const s of (stale || [])) {
          staleMap.set(s.curriculum_id, (staleMap.get(s.curriculum_id) || 0) + 1);
        }

        const result: EliteHealthData[] = (coverage || []).map((c: any) => ({
          curriculum_id: c.curriculum_id,
          curriculum_title: titleMap.get(c.curriculum_id) || '–',
          approved_q: c.q_approved || 0,
          annotated_q: c.q_annotated || 0,
          pct_annotated: Number(c.pct_annotated) || 0,
          elite_cnt: c.elite_cnt || 0,
          pct_elite: Number(c.pct_elite) || 0,
          avg_score: Number(c.avg_score) || 0,
          stale_cnt: staleMap.get(c.curriculum_id) || 0,
          missing_cnt: Math.max(0, (c.q_approved || 0) - (c.q_annotated || 0)),
        }));

        setData(result);
      } catch (err) {
        console.error('[EliteHealthBadge] load error:', err);
      }
      setLoading(false);
    })();
  }, [curriculumId]);

  if (loading) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  if (!data.length) return <span className="text-xs text-muted-foreground">Keine Daten</span>;

  if (compact && data.length === 1) {
    const d = data[0];
    const status = d.pct_annotated >= 95 && d.avg_score >= 8.5 ? 'elite' : d.pct_annotated >= 50 ? 'partial' : 'missing';
    return (
      <Badge variant="outline" className={cn("text-[10px] gap-1", {
        'bg-success/15 text-success': status === 'elite',
        'bg-warning/15 text-warning': status === 'partial',
        'bg-destructive/15 text-destructive': status === 'missing',
      })}>
        {status === 'elite' ? <Sparkles className="h-3 w-3" /> : status === 'partial' ? <AlertTriangle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
        {d.pct_annotated}% | Ø{d.avg_score.toFixed(1)} | {d.elite_cnt}E
      </Badge>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {data.map(d => {
        const isElite = d.pct_annotated >= 95 && d.avg_score >= 8.5;
        const hasMissing = d.missing_cnt > 0 || d.stale_cnt > 0;
        return (
          <Card key={d.curriculum_id} className={cn("transition-colors", isElite && "border-success/30")}>
            <CardContent className="py-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground truncate max-w-[200px]">{d.curriculum_title}</p>
                {isElite ? (
                  <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
                ) : hasMissing ? (
                  <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0" />
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                <Progress value={d.pct_annotated} className="h-1.5 flex-1" />
                <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">{d.pct_annotated}%</span>
              </div>

              <div className="grid grid-cols-4 gap-1 text-center">
                <div>
                  <p className="text-[9px] uppercase text-muted-foreground">Ann.</p>
                  <p className="text-xs font-mono text-foreground">{d.annotated_q}/{d.approved_q}</p>
                </div>
                <div>
                  <p className="text-[9px] uppercase text-muted-foreground">Elite</p>
                  <p className="text-xs font-mono text-success">{d.pct_elite}%</p>
                </div>
                <div>
                  <p className="text-[9px] uppercase text-muted-foreground">Ø Score</p>
                  <p className={cn("text-xs font-mono", d.avg_score >= 8.5 ? "text-success" : d.avg_score >= 7 ? "text-warning" : "text-destructive")}>
                    {d.avg_score.toFixed(1)}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] uppercase text-muted-foreground">Stale</p>
                  <p className={cn("text-xs font-mono", d.stale_cnt > 0 ? "text-warning" : "text-muted-foreground")}>
                    {d.stale_cnt}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
