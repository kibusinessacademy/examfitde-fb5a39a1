import { Card, CardContent } from '@/components/ui/card';
import { useReadinessScore } from '@/hooks/useAdaptiveLearning';
import { useDashboardStats } from '@/hooks/useDashboardStats';
import { GraduationCap } from 'lucide-react';

interface CoachHintProps {
  curriculumId: string;
}

export function CoachHint({ curriculumId }: CoachHintProps) {
  const { data: readiness } = useReadinessScore(curriculumId);
  const { data: stats } = useDashboardStats();

  const score = readiness?.overall_readiness || 0;
  const streak = stats?.streak ?? 0;
  const successRate = stats?.success_rate ?? 0;
  const weakCount = readiness?.weak_areas?.length ?? 0;

  // Generate contextual, non-chatbot coach hints
  const getHint = (): string | null => {
    if (streak > 5 && weakCount > 2) {
      return 'Du lernst regelmäßig – aber zu linear. Für deine Prüfung wäre jetzt gezieltes Schwächen-Training effektiver.';
    }
    if (successRate > 80 && score < 70) {
      return 'Deine Trefferquote ist gut, aber die Prüfungsreife noch niedrig. Dir fehlen Wiederholungen in kritischen Bereichen.';
    }
    if (score >= 80) {
      return 'Du bist fast prüfungsreif. Konzentriere dich jetzt auf Simulationen unter Zeitdruck – das macht den Unterschied.';
    }
    if (weakCount >= 3) {
      return `Du hast ${weakCount} kritische Lücken. Schließe die 2 wichtigsten – das hebt deine Prüfungsreife um ~15%.`;
    }
    if (streak === 0) {
      return 'Tägliches Training von nur 10 Minuten verbessert dein Prüfungsergebnis messbar. Starte heute.';
    }
    return null;
  };

  const hint = getHint();
  if (!hint) return null;

  return (
    <Card className="glass-card border-primary/20 bg-primary/[0.03]">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-primary/10 flex-shrink-0">
            <GraduationCap className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-primary mb-1">
              Dein Prüfungscoach
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {hint}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
