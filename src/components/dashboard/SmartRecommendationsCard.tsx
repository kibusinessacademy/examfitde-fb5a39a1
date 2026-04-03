import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useActiveRecommendations, type UserRecommendation } from '@/hooks/useLearningIntelligence';
import { Lightbulb, BookOpen, Target, Brain, Loader2, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { recordLearningEvent } from '@/lib/learning-telemetry';
import { useTerminology } from '@/hooks/useProgramType';

const TYPE_ICONS: Record<string, typeof BookOpen> = {
  lesson: BookOpen,
  exam_sim: Target,
  review: Brain,
  minicheck: Target,
  tutor_mode: Lightbulb,
};

const getReasonLabels = (isAcademic: boolean): Record<string, string> => ({
  LOW_MASTERY_HIGH_WEIGHT: isAcademic ? '🔴 Niedrige Mastery, hohe Klausurrelevanz' : '🔴 Niedrige Mastery, hohe Prüfungsrelevanz',
  WEAKNESS_CLUSTER_DETECTED: '⚠️ Schwächencluster erkannt',
  PRE_EXAM_SIM_REQUIRED: '🎯 Simulation empfohlen',
  NO_RECENT_ACTIVITY: '⏰ Keine aktuelle Aktivität',
  REVIEW_DUE: '🔄 Wiederholung fällig',
});

export function SmartRecommendationsCard({ curriculumId }: { curriculumId: string }) {
  const { data: recs, isLoading } = useActiveRecommendations(curriculumId);

  const handleClick = async (rec: UserRecommendation) => {
    // Track recommendation click
    await recordLearningEvent({
      event_type: 'recommendation_clicked',
      curriculum_id: curriculumId,
      competency_id: rec.target_id || undefined,
      payload: { recommendation_id: rec.id, reason_code: rec.reason_code },
    });

    // Mark as clicked
    await (supabase as any)
      .from('user_recommendations')
      .update({ clicked_at: new Date().toISOString() })
      .eq('id', rec.id);
  };

  if (isLoading) {
    return (
      <Card className="glass-card">
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!recs || recs.length === 0) return null;

  return (
    <Card className="glass-card border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-display flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-primary" />
          Dein nächster Schritt
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {recs.map((rec) => {
          const Icon = TYPE_ICONS[rec.recommendation_type] || Lightbulb;
          const meta = rec.target_meta as Record<string, unknown>;
          const reasonLabel = REASON_LABELS[rec.reason_code] || rec.reason_code;

          const linkTo = rec.recommendation_type === 'exam_sim'
            ? '/exam-simulation'
            : rec.recommendation_type === 'lesson' && rec.target_id
              ? `/exam-trainer`
              : '/dashboard';

          return (
            <Link
              key={rec.id}
              to={linkTo}
              onClick={() => handleClick(rec)}
              className="block"
            >
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-card/50 hover:border-primary/30 transition-colors group">
                <div className="p-2 rounded-lg bg-primary/10 flex-shrink-0">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{rec.reason_text}</p>
                  <p className="text-xs text-muted-foreground">{reasonLabel}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
              </div>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}
