import { useCallback } from 'react';
import { Lock, RotateCcw, BookOpenText, ShieldAlert, Sparkles } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { SectionKey } from './sections/extractSections';
import type {
  MiniCheckTutorContext,
  MiniCheckTutorResult,
} from './MiniCheckTutorFeedback';

/**
 * Learning Recovery Loop v1
 *
 * Nach failed/partial MiniCheck bekommt der Lerner einen konkreten
 * Wiederholungsweg statt nur Feedback. Verlinkung zurück zu bestehenden
 * Lesson-Sections (data-section anchors) — keine neue Mastery-Logik,
 * kein Auto-Unlock, kein freier Tutor-Prompt.
 */

export type RecoveryVerdict = 'passed' | 'partial' | 'failed';

export interface RecoveryRecommendation {
  /** True wenn der Recovery-Loop überhaupt sinnvoll ist (failed/partial + Kontext ok). */
  shouldShow: boolean;
  verdict: RecoveryVerdict;
  /** Fail-closed Grund, falls shouldShow=false trotz nicht-passed Score. */
  blockedReason?: 'passed' | 'missing_context';
  /** Fixe didaktische Reihenfolge der zu wiederholenden Sections. */
  focusSections: SectionKey[];
  wrongCount: number;
}

const RECOVERY_SECTIONS: SectionKey[] = ['shortExplanation', 'examPitfall', 'example'];

const SECTION_LABELS: Record<SectionKey, { label: string; helper: string; icon: typeof BookOpenText }> = {
  shortExplanation: {
    label: 'Kurz erklärt',
    helper: 'Worum es im Kern geht.',
    icon: BookOpenText,
  },
  examPitfall: {
    label: 'Prüfungsfalle',
    helper: 'Wo die meisten Punkte verlieren.',
    icon: ShieldAlert,
  },
  example: {
    label: 'Beispiel anwenden',
    helper: 'So sieht es in der Praxis aus.',
    icon: Sparkles,
  },
  // not used in recovery v1 — kept for type completeness
  keyTakeaway: { label: 'Merksatz', helper: '', icon: BookOpenText },
  counterExample: { label: 'Gegenbeispiel', helper: '', icon: BookOpenText },
  selfCheck: { label: 'Selbstcheck', helper: '', icon: BookOpenText },
};

/**
 * Pure helper — exported for tests.
 * Leitet den Wiederholungsweg aus Verdict + Kontext ab.
 * - passed → no recovery
 * - partial/failed + voller Kontext → 3 fixe Sections in didaktischer Reihenfolge
 * - missing context → fail-closed
 */
export function buildRecoveryRecommendation(
  context: MiniCheckTutorContext,
  result: MiniCheckTutorResult,
): RecoveryRecommendation {
  const verdict: RecoveryVerdict = result.passed
    ? 'passed'
    : result.scorePercent > 0
      ? 'partial'
      : 'failed';
  const wrongCount = result.wrongItems.length;

  if (verdict === 'passed') {
    return {
      shouldShow: false,
      verdict,
      blockedReason: 'passed',
      focusSections: [],
      wrongCount,
    };
  }

  const hasContext = Boolean(context.lessonId && context.curriculumId && context.competencyId);
  if (!hasContext) {
    return {
      shouldShow: false,
      verdict,
      blockedReason: 'missing_context',
      focusSections: [],
      wrongCount,
    };
  }

  return {
    shouldShow: true,
    verdict,
    focusSections: RECOVERY_SECTIONS,
    wrongCount,
  };
}

interface LearningRecoveryLoopProps {
  context: MiniCheckTutorContext;
  result: MiniCheckTutorResult;
  className?: string;
  /**
   * Optional override (z. B. für Tests). Default: scrollt zur ersten
   * vorhandenen Lesson-Section per [data-section="…"] anchor.
   */
  onRepeat?: (firstSection: SectionKey) => void;
}

export default function LearningRecoveryLoop({
  context,
  result,
  className,
  onRepeat,
}: LearningRecoveryLoopProps) {
  const rec = buildRecoveryRecommendation(context, result);

  const handleRepeat = useCallback(() => {
    const target = rec.focusSections[0];
    if (!target) return;
    if (onRepeat) {
      onRepeat(target);
      return;
    }
    if (typeof document === 'undefined') return;
    const el = document.querySelector(`[data-section="${target}"]`);
    if (el && 'scrollIntoView' in el) {
      (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [rec.focusSections, onRepeat]);

  // passed → never render — Recovery-Loop ist nur für failed/partial
  if (rec.blockedReason === 'passed') return null;

  if (rec.blockedReason === 'missing_context') {
    return (
      <Card
        className={cn('glass-card border-warning/30', className)}
        data-testid="learning-recovery-loop"
        data-state="missing-context"
      >
        <CardContent className="p-5">
          <div
            className="flex items-start gap-3 rounded-md border border-warning/30 bg-warning-bg-subtle p-4 text-sm"
            role="status"
          >
            <Lock className="h-4 w-4 mt-0.5 shrink-0 text-warning" />
            <p className="text-foreground">
              Wiederholungsweg gerade nicht verfügbar — der Lesson-Kontext fehlt.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const verdictLabel =
    rec.verdict === 'failed' ? 'Noch nicht bestanden' : 'Teilweise korrekt';

  return (
    <Card
      className={cn('glass-card border-primary/15', className)}
      data-testid="learning-recovery-loop"
      data-state="ready"
      data-verdict={rec.verdict}
    >
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <span
            className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0"
            aria-hidden="true"
          >
            <RotateCcw className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Du solltest wiederholen:</p>
            <p className="text-xs text-muted-foreground">
              {verdictLabel} · {result.correct}/{result.total} richtig
              {context.competencyCode ? ` · ${context.competencyCode}` : ''}
            </p>
          </div>
        </div>

        <ul
          className="space-y-2"
          data-testid="recovery-focus-list"
          aria-label="Empfohlene Wiederholungspunkte"
        >
          {rec.focusSections.map((key) => {
            const meta = SECTION_LABELS[key];
            const Icon = meta.icon;
            return (
              <li
                key={key}
                data-section-target={key}
                className="flex items-start gap-3 rounded-md border border-border bg-surface-raised p-3"
              >
                <span
                  className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0"
                  aria-hidden="true"
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{meta.label}</p>
                  <p className="text-xs text-muted-foreground">{meta.helper}</p>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={handleRepeat}
            className="gap-2"
            data-testid="recovery-cta-repeat"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Jetzt gezielt wiederholen
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
