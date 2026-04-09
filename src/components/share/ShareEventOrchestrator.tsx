import { useEffect, useRef } from 'react';
import { usePendingShareEvents } from '@/hooks/usePendingShareEvents';
import { useShareTrigger } from '@/hooks/useShareTrigger';
import { ShareSuccessModal } from '@/components/share/ShareSuccessModal';
import type { ShareEvent, ShareEventType } from '@/types/share';

const SHARE_EVENT_PRIORITY: Record<ShareEventType, number> = {
  exam_session_completed_high_score: 100,
  exam_session_improvement_milestone: 90,
  hard_question_correct: 80,
  competency_mastered: 70,
  streak_milestone: 60,
};

function pickHighestPriority(events: ShareEvent[]): ShareEvent | null {
  if (!events.length) return null;
  return [...events].sort(
    (a, b) => (SHARE_EVENT_PRIORITY[b.event_type] ?? 0) - (SHARE_EVENT_PRIORITY[a.event_type] ?? 0)
  )[0];
}

/**
 * Global orchestrator — mount once in the authenticated layout.
 * Polls for eligible share events and shows the highest-priority one.
 * Only one modal at a time. Dismissed events won't reappear.
 */
export function ShareEventOrchestrator() {
  const { data: events } = usePendingShareEvents();
  const { activeEvent, open, triggerShare, setOpen } = useShareTrigger();
  const shownIds = useRef(new Set<string>());

  useEffect(() => {
    if (open || activeEvent) return; // already showing
    if (!events?.length) return;

    const best = pickHighestPriority(
      events.filter(e => !shownIds.current.has(e.id))
    );
    if (best) {
      shownIds.current.add(best.id);
      triggerShare(best);
    }
  }, [events, open, activeEvent, triggerShare]);

  return (
    <ShareSuccessModal
      open={open}
      onOpenChange={setOpen}
      event={activeEvent}
    />
  );
}
