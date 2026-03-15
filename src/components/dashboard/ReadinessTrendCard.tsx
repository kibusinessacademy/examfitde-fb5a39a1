import { Card, CardContent } from '@/components/ui/card';
import { useReadinessTrend } from '@/hooks/useLearningIntelligence';
import { TrendingUp, TrendingDown, Minus, Loader2 } from 'lucide-react';

export function ReadinessTrendCard({ curriculumId }: { curriculumId: string }) {
  const { data: trend, isLoading } = useReadinessTrend(curriculumId);

  if (isLoading) {
    return (
      <Card className="glass-card">
        <CardContent className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!trend || trend.length < 2) {
    return (
      <Card className="glass-card">
        <CardContent className="py-6 text-center">
          <p className="text-xs text-muted-foreground">Noch nicht genug Daten für Trend</p>
        </CardContent>
      </Card>
    );
  }

  const latest = trend[0];
  const previous = trend[1];
  const delta = Math.round(latest.readiness_score - previous.readiness_score);
  const isPositive = delta > 0;
  const isNeutral = delta === 0;

  const daysBetween = Math.max(1, Math.round(
    (new Date(latest.calculated_at).getTime() - new Date(previous.calculated_at).getTime()) /
    (1000 * 60 * 60 * 24)
  ));

  return (
    <Card className="glass-card">
      <CardContent className="py-5 px-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Entwicklung</p>
            <div className="flex items-center gap-2">
              {isNeutral ? (
                <Minus className="h-5 w-5 text-muted-foreground" />
              ) : isPositive ? (
                <TrendingUp className="h-5 w-5 text-emerald-500" />
              ) : (
                <TrendingDown className="h-5 w-5 text-destructive" />
              )}
              <span className={`text-2xl font-bold ${
                isNeutral ? 'text-muted-foreground'
                : isPositive ? 'text-emerald-500'
                : 'text-destructive'
              }`}>
                {isPositive ? '+' : ''}{delta}%
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              in den letzten {daysBetween} {daysBetween === 1 ? 'Tag' : 'Tagen'}
            </p>
          </div>

          {/* Mini sparkline */}
          <div className="flex items-end gap-0.5 h-10">
            {[...trend].reverse().slice(-8).map((point, i) => {
              const maxScore = Math.max(...trend.map(t => t.readiness_score), 1);
              const h = (point.readiness_score / maxScore) * 100;
              return (
                <div
                  key={i}
                  className={`w-2 rounded-t ${
                    point.readiness_score >= 65 ? 'bg-emerald-500/60'
                    : point.readiness_score >= 40 ? 'bg-amber-500/60'
                    : 'bg-destructive/60'
                  }`}
                  style={{ height: `${Math.max(h, 10)}%` }}
                />
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
