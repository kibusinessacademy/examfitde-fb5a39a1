/**
 * CurriculumPickerGate — No-Dead-Ends Empty State (P0-A)
 * --------------------------------------------------------------
 * Generic empty-state shown wherever a learner reaches a surface
 * that needs a curriculum but has none yet. Replaces silent
 * "Kein Curriculum"-Sackgassen.
 *
 * Reality-Audit-Regel: Jede Empty State braucht Erklärung +
 * primäre Aktion + sekundäre Aktion.
 */
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, GraduationCap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { trackLearnerReality } from '@/lib/learnerInstrumentation';

interface Props {
  /** Logical surface that triggered the gate (e.g. 'daily-challenge'). */
  source: string;
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  /** Primary CTA target. Default: /berufe (Beruf auswählen). */
  primaryHref?: string;
  primaryLabel?: string;
  /** Optional secondary action override. */
  secondaryHref?: string;
  secondaryLabel?: string;
}

export function CurriculumPickerGate({
  source,
  title = 'Wähle deinen Beruf aus',
  description = 'Damit wir dir den passenden Lernpfad zeigen können, brauchst du zuerst einen Beruf. Das dauert weniger als 30 Sekunden.',
  icon,
  primaryHref = '/berufe',
  primaryLabel = 'Beruf auswählen',
  secondaryHref = '/courses',
  secondaryLabel = 'Alle Trainings ansehen',
}: Props) {
  const navigate = useNavigate();

  const goPrimary = () => {
    trackLearnerReality('curriculum_picker_opened', {
      source,
      target: primaryHref,
    });
    navigate(primaryHref);
  };

  const goSecondary = () => {
    trackLearnerReality('curriculum_picker_opened', {
      source,
      target: secondaryHref,
      reason: 'secondary',
    });
    navigate(secondaryHref);
  };

  return (
    <div className="flex items-center justify-center min-h-[60vh] bg-background p-6">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl gradient-primary text-text-on-gradient">
          {icon ?? <GraduationCap className="h-8 w-8" aria-hidden />}
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-display font-bold text-foreground">{title}</h1>
          <p className="text-muted-foreground">{description}</p>
        </div>
        <div className="flex flex-col gap-2">
          <Button onClick={goPrimary} className="w-full" size="lg">
            {primaryLabel}
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
          <Button variant="outline" onClick={goSecondary} className="w-full">
            {secondaryLabel}
          </Button>
          <Button variant="ghost" onClick={() => navigate(-1)} className="w-full">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Zurück
          </Button>
        </div>
      </div>
    </div>
  );
}
