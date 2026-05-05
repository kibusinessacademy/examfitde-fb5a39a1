import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useTopGaps, type TopGap } from '@/hooks/useLearningIntelligence';
import { AlertTriangle, TrendingDown, Eye, Loader2 } from 'lucide-react';

const GAP_CONFIG: Record<string, { label: string; icon: typeof AlertTriangle; color: string }> = {
  acute: { label: 'Akut', icon: AlertTriangle, color: 'bg-destructive-bg-subtle text-destructive border-destructive-border' },
  unstable: { label: 'Instabil', icon: TrendingDown, color: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
  blind: { label: 'Blind Spot', icon: Eye, color: 'bg-blue-500/10 text-blue-600 border-blue-500/30' },
  none: { label: '', icon: AlertTriangle, color: '' },
};

export function TopGapsCard({ curriculumId }: { curriculumId: string }) {
  const { data: gaps, isLoading } = useTopGaps(curriculumId);

  if (isLoading) {
    return (
      <Card className="glass-card">
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!gaps || gaps.length === 0) {
    return (
      <Card className="glass-card border-emerald-500/20">
        <CardContent className="py-6 text-center">
          <p className="text-sm text-muted-foreground">Keine kritischen Schwächen erkannt 🎉</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-display flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          Kritische Schwächen
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {gaps.map((gap) => {
          const config = GAP_CONFIG[gap.gap_type] || GAP_CONFIG.none;
          const GapIcon = config.icon;

          return (
            <div key={gap.competency_id} className="flex items-center justify-between p-2.5 rounded-lg border bg-card/50">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-mono text-muted-foreground">{gap.learning_field_code}</span>
                  {config.label && (
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${config.color}`}>
                      <GapIcon className="h-2.5 w-2.5 mr-0.5" />
                      {config.label}
                    </Badge>
                  )}
                </div>
                <p className="text-sm font-medium truncate">{gap.competency_title}</p>
                <p className="text-xs text-muted-foreground">
                  {gap.correct_attempts}/{gap.total_attempts} richtig · {gap.accuracy_pct}%
                </p>
              </div>
              <div className="text-right ml-3">
                <div className="text-lg font-bold text-destructive">{gap.accuracy_pct}%</div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
