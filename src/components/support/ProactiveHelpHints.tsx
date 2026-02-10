import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { X, Lightbulb, HelpCircle, Brain, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

type HintType = 'fail_streak' | 'time_pressure' | 'repeated_abort' | 'low_mastery';

interface HintConfig {
  type: HintType;
  icon: React.ElementType;
  title: string;
  message: string;
  action: string;
  color: string;
}

const HINT_CONFIGS: Record<HintType, HintConfig> = {
  fail_streak: {
    type: 'fail_streak',
    icon: HelpCircle,
    title: 'Kurze Erklärung?',
    message: 'Du hast mehrere Versuche hinter dir. Möchtest du eine kurze Erklärung ansehen?',
    action: 'Erklärung ansehen',
    color: 'border-blue-500/30 bg-blue-500/5',
  },
  time_pressure: {
    type: 'time_pressure',
    icon: Clock,
    title: 'Zeitspar-Tipp',
    message: 'Viele Prüflinge verlieren hier Zeit. Möchtest du einen Tipp sehen?',
    action: 'Tipp ansehen',
    color: 'border-amber-500/30 bg-amber-500/5',
  },
  repeated_abort: {
    type: 'repeated_abort',
    icon: Brain,
    title: 'Alternative Strategie?',
    message: 'Vielleicht hilft dir ein anderer Lernansatz. Sollen wir einen Vorschlag machen?',
    action: 'Strategie vorschlagen',
    color: 'border-purple-500/30 bg-purple-500/5',
  },
  low_mastery: {
    type: 'low_mastery',
    icon: Lightbulb,
    title: 'Grundlagen auffrischen?',
    message: 'Dieses Thema scheint noch nicht ganz zu sitzen. Wir haben passende Übungen für dich.',
    action: 'Übungen starten',
    color: 'border-green-500/30 bg-green-500/5',
  },
};

interface ProactiveHelpHintsProps {
  /** Number of consecutive wrong answers in current session */
  failCount?: number;
  /** Current lesson or competency ID for context */
  contextLessonId?: string;
  contextCompetencyId?: string;
  /** Whether user is in a timed exam */
  isTimedExam?: boolean;
  /** Time remaining in seconds (for time pressure detection) */
  timeRemaining?: number;
  /** Total time in seconds */
  totalTime?: number;
  /** Number of times user has left and returned */
  abortCount?: number;
  /** Mastery percentage for current competency */
  masteryPercent?: number;
  /** Callback when user accepts help */
  onAcceptHelp?: (hintType: HintType) => void;
  className?: string;
}

export default function ProactiveHelpHints({
  failCount = 0,
  contextLessonId,
  contextCompetencyId,
  isTimedExam = false,
  timeRemaining,
  totalTime,
  abortCount = 0,
  masteryPercent,
  onAcceptHelp,
  className,
}: ProactiveHelpHintsProps) {
  const { user } = useAuth();
  const [dismissedHints, setDismissedHints] = useState<Set<HintType>>(new Set());
  const [activeHint, setActiveHint] = useState<HintType | null>(null);

  // Determine which hint to show based on signals
  useEffect(() => {
    if (!user) return;

    // Priority 1: Multiple failures (after 2+ wrong answers)
    if (failCount >= 2 && !dismissedHints.has('fail_streak')) {
      setActiveHint('fail_streak');
      return;
    }

    // Priority 2: Time pressure (less than 25% time remaining in timed exam)
    if (isTimedExam && timeRemaining && totalTime && timeRemaining < totalTime * 0.25 && !dismissedHints.has('time_pressure')) {
      setActiveHint('time_pressure');
      return;
    }

    // Priority 3: Repeated aborts (3+ times)
    if (abortCount >= 3 && !dismissedHints.has('repeated_abort')) {
      setActiveHint('repeated_abort');
      return;
    }

    // Priority 4: Low mastery (below 40%)
    if (masteryPercent !== undefined && masteryPercent < 40 && !dismissedHints.has('low_mastery')) {
      setActiveHint('low_mastery');
      return;
    }

    setActiveHint(null);
  }, [failCount, isTimedExam, timeRemaining, totalTime, abortCount, masteryPercent, dismissedHints, user]);

  const handleDismiss = (type: HintType) => {
    setDismissedHints(prev => new Set(prev).add(type));
    setActiveHint(null);
  };

  const handleAccept = async (type: HintType) => {
    // Log the proactive help interaction
    if (user?.id) {
      await supabase.from('support_ai_responses').insert({
        user_id: user.id,
        question: `[proactive_hint:${type}]`,
        answer: HINT_CONFIGS[type].message,
        answer_type: 'proactive_hint',
        context_lesson_id: contextLessonId || null,
        context_competency_id: contextCompetencyId || null,
        model_used: 'system',
        tokens_used: 0,
        guardrail_flags: [`hint:${type}`],
      });
    }

    handleDismiss(type);
    onAcceptHelp?.(type);
  };

  if (!activeHint) return null;

  const config = HINT_CONFIGS[activeHint];
  const Icon = config.icon;

  return (
    <Card className={cn('animate-in slide-in-from-bottom-2 duration-300 border-2', config.color, className)}>
      <CardContent className="py-3 px-4">
        <div className="flex items-start gap-3">
          <div className="p-1.5 rounded-lg bg-muted/50 flex-shrink-0 mt-0.5">
            <Icon className="h-4 w-4 text-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm">{config.title}</div>
            <p className="text-xs text-muted-foreground mt-0.5">{config.message}</p>
            <div className="flex gap-2 mt-2">
              <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => handleAccept(activeHint)}>
                {config.action}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleDismiss(activeHint)}>
                Nein danke
              </Button>
            </div>
          </div>
          <button onClick={() => handleDismiss(activeHint)} className="text-muted-foreground hover:text-foreground p-1">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
